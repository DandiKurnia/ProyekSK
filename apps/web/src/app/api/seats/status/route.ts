import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const STATUSES = ["occupied", "empty", "unknown"] as const;
type Status = (typeof STATUSES)[number];

function toKg(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("class_id");

    const seatQuery = supabaseServer
      .from("seats")
      .select(
        "seat_id, class_id, device_id, row_no, col_no, is_monitored, " +
          "seat_status(status, weight_kg, updated_at)"
      );
    const { data, error } = classId
      ? await seatQuery.eq("class_id", classId).order("seat_id")
      : await seatQuery.order("seat_id");
    if (error) throw error;

    // Ambang stale = app_config.device_offline_seconds (default 60).
    const cfg = await supabaseServer
      .from("app_config")
      .select("value")
      .eq("key", "device_offline_seconds")
      .maybeSingle();
    const offlineSec =
      typeof cfg.data?.value === "number" ? cfg.data.value : 60;
    const now = Date.now();

    // Detail perangkat pelapor (tanpa menebak nama FK — 1 query tambahan).
    const deviceIds = [
      ...new Set(
        (data ?? [])
          .map((s) => (s as { device_id?: string | null }).device_id)
          .filter((d): d is string => !!d)
      ),
    ];
    const devMap = new Map<string, unknown>();
    if (deviceIds.length) {
      const devs = await supabaseServer
        .from("devices")
        .select("device_id, name, status, last_seen_at, last_data_at")
        .in("device_id", deviceIds);
      if (devs.error) throw devs.error;
      for (const d of devs.data ?? []) devMap.set(d.device_id, d);
    }

    type SeatRow = {
      seat_id: string;
      class_id: string;
      device_id: string | null;
      row_no: number | null;
      col_no: number | null;
      is_monitored: boolean;
      seat_status:
        | { status: string; weight_kg: number | null; updated_at: string | null }
        | Array<{
            status: string;
            weight_kg: number | null;
            updated_at: string | null;
          }>
        | null;
    };

    const seats = ((data ?? []) as unknown as SeatRow[]).map((s) => {
      const st = Array.isArray(s.seat_status)
        ? (s.seat_status[0] ?? null)
        : (s.seat_status ?? null);
      const updatedAt = st?.updated_at ?? null;
      return {
        seat_id: s.seat_id,
        class_id: s.class_id,
        device_id: s.device_id,
        row_no: s.row_no,
        col_no: s.col_no,
        is_monitored: s.is_monitored,
        status: st?.status ?? "unknown",
        weight_kg: st?.weight_kg ?? null,
        updated_at: updatedAt,
        stale:
          updatedAt != null
            ? now - new Date(updatedAt).getTime() > offlineSec * 1000
            : true,
        stale_after_seconds: offlineSec,
        device: s.device_id ? (devMap.get(s.device_id) ?? null) : null,
      };
    });
    return NextResponse.json({ seats });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : JSON.stringify(err) },
      { status: 500 }
    );
  }
}

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
