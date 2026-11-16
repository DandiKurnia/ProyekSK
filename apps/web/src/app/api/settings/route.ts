import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
export const dynamic = "force-dynamic";

// GET /api/settings — seluruh app_config sebagai { key: value }.
// POST /api/settings { key, value } — tulis 1 key (whitelist + validasi).
// Sesuai prd-settings.md §3 (Route Handler satu-satunya penulis).

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validate(
  key: string,
  value: unknown
): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (key) {
    case "late_threshold":
    case "checkout_after":
      if (typeof value === "string" && TIME.test(value))
        return { ok: true, value };
      return { ok: false, error: `${key} harus "HH:MM" (00:00–23:59)` };
    case "verification_timeout":
    case "device_offline_seconds":
    case "seat_hysteresis_seconds": {
      const n = Number(value);
      if (Number.isInteger(n) && n > 0) return { ok: true, value: n };
      return { ok: false, error: `${key} harus bilangan bulat > 0 (detik)` };
    }
    case "seat_occupied_kg": {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return { ok: true, value: n };
      return { ok: false, error: `${key} harus angka > 0 (kg)` };
    }
    case "attendance_window":
      if (
        typeof value === "object" &&
        value !== null &&
        TIME.test((value as { start?: unknown }).start as string) &&
        TIME.test((value as { end?: unknown }).end as string) &&
        (value as { start: string }).start < (value as { end: string }).end
      )
        return { ok: true, value };
      return {
        ok: false,
        error: "attendance_window harus {start,end} HH:MM dengan start < end",
      };
    case "timezone":
      if (typeof value === "string" && value.length > 0 && value.length <= 64)
        return { ok: true, value };
      return { ok: false, error: "timezone tidak valid" };
    default:
      return { ok: false, error: `key tidak dikenal: ${key}` };
  }
}

export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from("app_config")
      .select("key, value");
    if (error) throw error;
    return NextResponse.json(
      Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      key?: unknown;
      value?: unknown;
    } | null;
    if (!body || typeof body.key !== "string")
      return NextResponse.json({ error: "key wajib diisi" }, { status: 400 });

    const v = validate(body.key, body.value);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

    const { data, error } = await supabaseServer
      .from("app_config")
      .update({ value: v.value })
      .eq("key", body.key)
      .select("key, value")
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
