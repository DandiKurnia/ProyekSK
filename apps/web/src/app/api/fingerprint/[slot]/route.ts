import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
// DELETE /api/fingerprint/[slot]?student_id=..
// Hapus template dari sensor fisik + setel fingerprint_status='not_enrolled' & slot=NULL di DB.
export const dynamic = "force-dynamic";

const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8200";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ slot: string }> }
) {
  try {
    const { slot: slotParam } = await context.params;
    const slot = Number(slotParam);
    if (!slot || slot < 1 || slot > 200) {
      return NextResponse.json({ error: "slot harus 1..200" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const student_id = (searchParams.get("student_id") ?? "").trim();

    // Hapus dari sensor via face-service
    const res = await fetch(`${FACE_URL}/fingerprint/${slot}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string };
      return NextResponse.json(
        { error: body.detail ?? `Gagal hapus di sensor (HTTP ${res.status})` },
        { status: res.status }
      );
    }

    // Perbarui Supabase jika student_id diberikan / dicari berdasarkan slot
    let q = supabaseServer.from("students").update({
      fingerprint_status: "not_enrolled",
      fingerprint_slot: null,
    });
    q = student_id ? q.eq("student_id", student_id) : q.eq("fingerprint_slot", slot);
    const { error: dbError } = await q;
    if (dbError) throw dbError;

    return NextResponse.json({ slot, deleted: true, supabase_synced: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { deleted: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
