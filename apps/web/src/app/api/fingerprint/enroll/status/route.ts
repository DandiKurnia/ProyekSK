import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
// GET /api/fingerprint/enroll/status?student_id=..&slot=..&re_enroll=0|1
// Polling UI: menyelesaikan transaksi DB saat firmware melapor ENROLL_OK/ENROLL_FAIL.
// re_enroll=0 -> slot dialokasikan request ini, jadi bila gagal slot dibersihkan (rollback A3).
export const dynamic = "force-dynamic";

const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8000";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const student_id = (searchParams.get("student_id") ?? "").trim();
    const slot = Number(searchParams.get("slot"));
    const re_enroll = searchParams.get("re_enroll") !== "0";

    const res = await fetch(`${FACE_URL}/fingerprint/enroll/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`face-service HTTP ${res.status}`);
    const job = (await res.json()) as {
      active: boolean;
      slot: number | null;
      ok: boolean | null;
      code: number | null;
      detail: string | null;
      stage: string | null;
    };

    // Pekerja masih berjalan / belum ada hasil -> UI lanjut polling
    if (!student_id || job.active || job.ok === null) {
      return NextResponse.json({ ...job, done: false });
    }

    if (job.ok) {
      const { error } = await supabaseServer
        .from("students")
        .update({ fingerprint_status: "enrolled", fingerprint_slot: slot || job.slot })
        .eq("student_id", student_id);
      if (error) throw error;
      return NextResponse.json({ ...job, done: true, supabase_synced: true });
    }

    // Gagal: kembalikan status DB. Slot baru -> hapus sisa template di sensor.
    if (!re_enroll) {
      await fetch(`${FACE_URL}/fingerprint/${slot}`, { method: "DELETE" }).catch(() => {});
      await supabaseServer
        .from("students")
        .update({ fingerprint_status: "not_enrolled", fingerprint_slot: null })
        .eq("student_id", student_id);
    } else {
      await supabaseServer
        .from("students")
        .update({ fingerprint_status: "enrolled" })
        .eq("student_id", student_id);
    }
    return NextResponse.json({ ...job, done: true, supabase_synced: false });
  } catch (err: unknown) {
    return NextResponse.json(
      { done: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
