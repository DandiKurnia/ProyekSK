# Sisi Next.js — penerima `POST /api/seats/status`

Salinan verbatim kode cloud yang menerima kiriman firmware kursi. Ditempatkan di folder ini supaya kedua ujung kabel (ESP32 ↔ Route Handler) terbaca dalam satu tempat saat debug `POST ... -> 409`.

Sumber asli (jangan edit salinan ini; perbaiki di sana):
- `apps/web/src/app/api/seats/status/route.ts` — 252 baris
- `apps/web/src/lib/supabase-server.ts` — 18 baris

Terkait: [komunikasi.md](komunikasi.md) (sisi firmware: `API_URL`, `postStatus()`, retry, heartbeat), [../ObsidianAllProgramSK/docs/gerbang-ino-database.md](../ObsidianAllProgramSK/docs/gerbang-ino-database.md) (rantai ke tabel).

---

## 1. Peta alur `POST`

Route Handler ini **tidak menghitung ulang** status — nilai dari firmware disimpan apa adanya setelah lolos validasi, sekaligus menulis heartbeat perangkat.

| Baris | Langkah |
|---|---|
| `:4` | `export const dynamic = "force-dynamic"` — respons tidak di-cache |
| `:6–7` | `STATUSES = occupied/empty/unknown` — satu-satunya nilai sah |
| `:9–13` | `toKg()` membulatkan `weight_kg` ke 3 desimal |
| `:108–122` | Baca body JSON: `device_id`, `seat_id`, `status`, `weight_kg`, `firmware_version`, `read_at` |
| `:124–144` | `400` bila field wajib kurang, status tak dikenal, atau berat bukan angka |
| `:146–167` | Perangkat wajib terdaftar (`404`), aktif (`403`), `type = seat_esp32` (`403`) |
| `:169–187` | Kursi wajib ada (`404`) dan `seats.device_id` harus sama dengan pelapor (`409`) |
| `:189–205` | `upsert` `seat_status` (1 baris per kursi, `updated_at` dari `read_at` bila ada) |
| `:207–224` | Status berubah → `insert` `seat_events`; tabel belum dibuat (`PGRST205`) → `history:false` |
| `:226–237` | Heartbeat: `devices.status='online'`, `last_seen_at`, `last_data_at`, `firmware_version` |
| `:239–245` | Balasan `200 { seat_id, status, weight_kg, changed, history }` |

## 2. Klien Supabase server-only

`apps/web/src/lib/supabase-server.ts` — service role melewati RLS; secret tidak pernah sampai ke browser.

```ts
import { createClient } from "@supabase/supabase-js";

// Server-only. Service role melewati RLS — aman dipakai di Route Handler
// karena secret tidak pernah dikirim ke browser. RLS per-role dikunci
// belakangan setelah UI stabil (lihat docs/database.md § Catatan Implementasi).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

if (!url || !secret) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY belum di-set");
}

export const supabaseServer = createClient(url, secret, {
  auth: { persistSession: false },
});
```

## 3. Handler `POST` (`route.ts:108–252`)

```ts
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const device_id = body?.device_id;
    const seat_id = body?.seat_id;
    const status = body?.status as Status | undefined;
    const read_at =
      typeof body?.read_at === "string" ? body.read_at : undefined;
    const firmware =
      typeof body?.firmware_version === "string"
        ? body.firmware_version
        : undefined;

    if (
      typeof device_id !== "string" ||
      typeof seat_id !== "string" ||
      !status ||
      !STATUSES.includes(status)
    )
      return NextResponse.json(
        {
          error:
            "device_id, seat_id, dan status (occupied/empty/unknown) wajib diisi",
        },
        { status: 400 }
      );

    const weight_kg =
      body?.weight_kg !== undefined ? toKg(body.weight_kg) : null;
    if (body?.weight_kg !== undefined && weight_kg === null)
      return NextResponse.json(
        { error: "weight_kg harus angka (kg)" },
        { status: 400 }
      );

    // 1. Perangkat harus terdaftar, aktif, dan bertipe seat_esp32.
    const dev = await supabaseServer
      .from("devices")
      .select("device_id, type, is_active")
      .eq("device_id", device_id)
      .maybeSingle();
    if (dev.error) throw dev.error;
    if (!dev.data)
      return NextResponse.json(
        { error: `perangkat tidak terdaftar: ${device_id}` },
        { status: 404 }
      );
    if (!dev.data.is_active)
      return NextResponse.json(
        { error: `perangkat dinonaktifkan: ${device_id}` },
        { status: 403 }
      );
    if (dev.data.type !== "seat_esp32")
      return NextResponse.json(
        { error: `perangkat ${device_id} bukan sensor kursi` },
        { status: 403 }
      );

    // 2. Kursi harus ada dan ter-assign ke perangkat pelapor.
    const seat = await supabaseServer
      .from("seats")
      .select("seat_id, device_id, class_id")
      .eq("seat_id", seat_id)
      .maybeSingle();
    if (seat.error) throw seat.error;
    if (!seat.data)
      return NextResponse.json(
        { error: `kursi tidak terdaftar: ${seat_id}` },
        { status: 404 }
      );
    if (seat.data.device_id !== device_id)
      return NextResponse.json(
        {
          error: `kursi ${seat_id} ter-assign ke ${seat.data.device_id ?? "tidak ada perangkat"}, bukan ${device_id}`,
        },
        { status: 409 }
      );

    // 3. Tulis status terkini + riwayat bila berubah.
    const prev = await supabaseServer
      .from("seat_status")
      .select("status")
      .eq("seat_id", seat_id)
      .maybeSingle();
    if (prev.error) throw prev.error;

    const stamp =
      read_at && !Number.isNaN(Date.parse(read_at))
        ? new Date(read_at).toISOString()
        : new Date().toISOString();
    const up = await supabaseServer.from("seat_status").upsert(
      { seat_id, status, weight_kg, updated_at: stamp },
      { onConflict: "seat_id" }
    );
    if (up.error) throw up.error;

    let changed = false;
    let history = true;
    if (!prev.data || prev.data.status !== status) {
      changed = true;
      const ev = await supabaseServer.from("seat_events").insert({
        seat_id,
        old_status: prev.data?.status ?? null,
        new_status: status,
        weight_kg,
      });
      // Tabel belum dibuat (lihat supabase/2026-11-16_seat_events.sql):
      // telemetri status tetap tersimpan, riwayat dilewati.
      if (ev.error && (ev.error as { code?: string }).code === "PGRST205") {
        history = false;
      } else if (ev.error) {
        throw ev.error;
      }
    }

    // 4. Heartbeat perangkat.
    const hb: Record<string, unknown> = {
      status: "online",
      last_seen_at: new Date().toISOString(),
      last_data_at: new Date().toISOString(),
    };
    if (firmware) hb.firmware_version = firmware;
    const hbRes = await supabaseServer
      .from("devices")
      .update(hb)
      .eq("device_id", device_id);
    if (hbRes.error) throw hbRes.error;

    return NextResponse.json({
      seat_id,
      status,
      weight_kg,
      changed,
      history,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : JSON.stringify(err) },
      { status: 500 }
    );
  }
}
```

## 4. Catatan

- Firmware tidak memegang kunci Supabase; `SUPABASE_SECRET_KEY` hanya ada di `.env.local` Next.js.
- `read_at` opsional: bila firmware mengirim jam pembacaan, `seat_status.updated_at` memakai nilai itu; bila tidak, waktu server.
- `GET /api/seats/status?class_id=...` (`:15–106`) membaca balik `seats` + `seat_status` + `devices`, menandai `stale` bila `updated_at` lebih tua dari `app_config.device_offline_seconds` (default 60 dtk).
- `PGRST205` = tabel `seat_events` belum ada; status kursi tetap tersimpan, hanya riwayat yang dilewati.
