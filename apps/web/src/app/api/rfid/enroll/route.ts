import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
// POST /api/rfid/enroll { student_id }
// Buka jendela tempel kartu 15 dtk di firmware (satu board dengan R503).
// Penulisan rfid_cards TIDAK di sini, melainkan saat polling status -> /rfid/enroll/status.
export const dynamic = "force-dynamic";

const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8000";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { student_id?: unknown };
    const studentId = typeof body.student_id === "string" ? body.student_id.trim() : "";
    if (!studentId) {
      return NextResponse.json({ error: "student_id wajib diisi" }, { status: 400 });
    }

    const stu = await supabaseServer
      .from("students")
      .select("student_id")
      .eq("student_id", studentId)
      .maybeSingle();
    if (stu.error) throw stu.error;
    if (!stu.data) {
      return NextResponse.json(
        { error: `student_id '${studentId}' tidak ada di tabel students. Tambah siswa dulu.` },
        { status: 404 }
      );
    }

    const res = await fetch(`${FACE_URL}/rfid/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ student_id: studentId }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: (data as { detail?: string }).detail ?? `face-service HTTP ${res.status}` },
        { status: res.status === 503 ? 503 : 502 }
      );
    }
    return NextResponse.json({ started: true, student_id: studentId }, { status: 202 });
  } catch (err: unknown) {
    return NextResponse.json(
      { started: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
