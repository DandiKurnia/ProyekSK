import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
// DELETE /api/rfid/cards?uid=XX  atau  ?student_id=X (hapus semua kartu siswa)
// Melepas ikatan kartu->siswa. Baris di rfid_cards yang dihapus, bukan students.
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const uid = (searchParams.get("uid") ?? "").trim().toUpperCase();
    const studentId = (searchParams.get("student_id") ?? "").trim();
    if (!uid && !studentId) {
      return NextResponse.json({ error: "uid atau student_id wajib diisi" }, { status: 400 });
    }

    let query = supabaseServer.from("rfid_cards").delete();
    query = uid ? query.eq("uid", uid) : query.eq("student_id", studentId);
    const { error, count } = await query.select("uid");
    if (error) throw error;

    return NextResponse.json({ deleted: (count ?? 0) > 0, uid: uid || null, student_id: studentId || null });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}