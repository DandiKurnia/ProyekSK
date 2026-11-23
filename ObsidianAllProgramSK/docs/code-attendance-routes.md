# Sisi Next.js (jalur kios R503) — proxy sesi + penulis `attendance`

Kios berkomunikasi dengan FastAPI via USB; browser tidak bisa membuka port COM. Route Handler Next.js bertindak sebagai **proxy** (`FACE_SERVICE_URL`, default `http://127.0.0.1:8000`) + **penulis tunggal** `attendance`, dan **memvalidasi ulang** bukti 2FA dari face-service (slot/UID + umur bukti 120 dtk) — jangan percaya sepihak.

Sumber asli (jangan edit salinan ini; perbaiki di sana):
- `apps/web/src/app/api/fingerprint/session/route.ts` — 83 baris
- `apps/web/src/app/api/attendance/route.ts` — 325 baris
- `apps/web/src/lib/supabase-server.ts` — 18 baris (service role, server-only)

Terkait: [code-komunikasi-r503.md](code-komunikasi-r503.md) (firmware + Python), wajah: `apps/face-service/server.py` `POST /recognize`.

---

## 1. Proxy sesi: `fingerprint/session/route.ts` (penuh)

Dibuka saat wajah terkunci; Route Handler yang membaca slot + UID terikat dari Supabase — face-service tidak pernah memegang kredensial database.

```ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
// POST /api/fingerprint/session { student_id, ttl? }
// Buka jendela verifikasi lokal saat wajah terkunci. Faktor kedua = sidik jari
// ATAU kartu RFID: Route Handler yang membaca slot + UID terikat dari Supabase,
// face-service tidak pernah memegang kredensial database.
export const dynamic = "force-dynamic";

const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8000";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      student_id?: unknown;
      ttl?: unknown;
    };
    const studentId = typeof body.student_id === "string" ? body.student_id.trim() : "";
    if (!studentId) return NextResponse.json({ detail: "student_id wajib diisi" }, { status: 400 });

    const [stu, cards] = await Promise.all([
      supabaseServer
        .from("students")
        .select("fingerprint_slot")
        .eq("student_id", studentId)
        .maybeSingle(),
      supabaseServer.from("rfid_cards").select("uid").eq("student_id", studentId),
    ]);
    if (stu.error) throw stu.error;
    if (cards.error) throw cards.error;
    const slot = stu.data?.fingerprint_slot ?? null;
    const uids = (cards.data ?? []).map((c) => c.uid as string);
    if (!slot && uids.length === 0) {
      return NextResponse.json(
        { detail: "siswa belum enroll sidik jari maupun kartu RFID" },
        { status: 400 }
      );
    }

    const res = await fetch(`${FACE_URL}/fingerprint/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ student_id: studentId, slot, uids, ttl: body.ttl }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function GET() {
  try {
    const res = await fetch(`${FACE_URL}/fingerprint/session`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    return NextResponse.json(
      { state: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function DELETE() {
  try {
    const res = await fetch(`${FACE_URL}/fingerprint/session`, {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err: unknown) {
    return NextResponse.json(
      { state: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
```

## 2. Penulis absensi: `attendance/route.ts` (bukti 2FA, `:123–199`)

```ts
// Otak penentu absensi (prd-attendance.md §3 langkah 5): BUKAN browser yang dipercaya,
// melainkan sesi 2FA di face-service. Urutan: cek siswa -> cek sesi verified/fresh ->
// hitung present/late -> upsert idempoten -> konsumsi sesi -> LED (best-effort).
const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8000";
const SESSION_MAX_AGE_S = 120; // bukti verified kedaluwarsa setelah 2 menit (anti-replay)

async function faceFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${FACE_URL}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
```

Langkah 1 — siswa + faktor kedua terdaftar (`:157–172`):

```ts
    // 1. Identitas siswa + faktor kedua terdaftar (jari ATAU kartu)
    const [stu, cards] = await Promise.all([
      supabaseServer
        .from("students")
        .select("student_id, class_id, full_name, fingerprint_slot")
        .eq("student_id", studentId)
        .eq("is_active", true)
        .maybeSingle(),
      supabaseServer.from("rfid_cards").select("uid").eq("student_id", studentId),
    ]);
    if (stu.error) throw stu.error;
    if (cards.error) throw cards.error;
    if (!stu.data?.class_id) return NextResponse.json({ error: "siswa tidak dikenal/aktif" }, { status: 404 });
    const boundUids = (cards.data ?? []).map((c) => String(c.uid).toUpperCase());
    if (!stu.data.fingerprint_slot && boundUids.length === 0)
      return NextResponse.json({ error: "siswa belum enroll sidik jari maupun kartu" }, { status: 403 });
```

Langkah 2 — bukti 2FA harus `verified` milik siswa ini + masih segar (`:175–200`):

```ts
    const sess = await faceFetch("/fingerprint/session");
    if (sess.status !== 200 || !sess.data || typeof sess.data !== "object")
      return NextResponse.json({ error: "face-service tidak terjangkau" }, { status: 502 });
    const s: Record<string, unknown> = sess.data; // batas jaringan: field divalidasi satu per satu di bawah
    const sState = typeof s.state === "string" ? s.state : "";
    const isAudit = sState === "failed" || sState === "expired";
    if (sState !== "verified" && !isAudit)
      return NextResponse.json({ error: `sesi belum verified (state: ${sState})` }, { status: 409 });
    if (s.student_id !== studentId)
      return NextResponse.json({ error: "bukti 2FA bukan milik siswa ini" }, { status: 403 });
    const matchedUid =
      typeof s.matched_uid === "string" ? s.matched_uid.toUpperCase() : null;
    const factorOk =
      (stu.data.fingerprint_slot != null &&
        Number(s.matched_slot) === Number(stu.data.fingerprint_slot)) ||
      (matchedUid != null && boundUids.includes(matchedUid));
    if (!isAudit) {
      // bukti sah hanya jika salah satu faktor cocok + masih segar
      if (!factorOk)
        return NextResponse.json({ error: "bukti 2FA bukan milik siswa ini" }, { status: 403 });
      const verifiedAt = Number(s.verified_at ?? 0);
      if (!verifiedAt || Date.now() / 1000 - verifiedAt > SESSION_MAX_AGE_S)
        return NextResponse.json({ error: "bukti 2FA kedaluwarsa, ulangi scan wajah" }, { status: 409 });
    }
```

Langkah 5–6 — tulis masuk (`:261–279`), konsumsi bukti, LED best-effort (`:299–305`):

```ts
      const write = isAudit
        ? supabaseServer.from("attendance").upsert(row, { onConflict: "student_id,class_id,date", ignoreDuplicates: true })
        : supabaseServer.from("attendance").upsert(row, { onConflict: "student_id,class_id,date" });
      const saved = await write.select("attendance_id, status, check_in_at, check_out_at").single();
```

```ts
    // 6. Konsumsi bukti (sekali pakai). LED hijau hanya untuk absensi yang benar-benar sah.
    void faceFetch("/fingerprint/session", { method: "DELETE" });
    if (!isAudit)
      void faceFetch("/fingerprint/led", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
```

## 3. Catatan

- Sesi 2FA adalah satu-satunya bukti yang dipercaya; `matched_slot`/`matched_uid` harus cocok dengan baris yang terdaftar di Supabase (`403` bila milik orang lain), dan `verified_at` ≤ 120 dtk (`409` bila basi, anti-replay).
- `failed`/`expired` tetap bisa ditulis sebagai baris audit (`ignoreDuplicates: true`), bukan absensi sah.
- Konsumsi sesi (`DELETE`, bukti sekali pakai) dan `LED_OK` dikirim best-effort (`void`, tidak ditunggu).
- Kartu terekam sebagai `fingerprint_slot: null` — skema `attendance` tidak punya kolom `rfid_uid`; jangan tambah tanpa migrasi.
- Proksi FastAPI lain: `/api/face/recognize`, `/api/face/enroll`, `/api/fingerprint/enroll`, `/api/rfid/enroll`, `/api/fingerprint/[slot]`, `/api/rfid/cards` — pola sama (`FACE_URL` + timeout 5 dtk + passthrough status).
