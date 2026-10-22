import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// GET /api/students?class_id=&q=  — daftar siswa untuk tabel menu Students.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("class_id");

    let query = supabaseServer
      .from("students")
      .select(
        "student_id, full_name, class_id, face_status, fingerprint_status, fingerprint_slot, is_active, classes ( name )"
      )
      .order("full_name")
      .limit(500);

    if (classId) query = query.eq("class_id", classId);

    const { data, error } = await query;
    if (error) throw error;

    const students = (data ?? []).map(
      (s: {
        student_id: string;
        full_name: string;
        class_id: string;
        classes: { name: string } | Array<{ name: string }> | null;
        face_status: string;
        fingerprint_status: string;
        fingerprint_slot: number | null;
        is_active: boolean;
      }) => ({
        student_id: s.student_id,
        full_name: s.full_name,
        class_id: s.class_id,
        class_name:
          (Array.isArray(s.classes) ? s.classes[0]?.name : s.classes?.name) ??
          s.class_id,
        face_status: s.face_status,
        fingerprint_status: s.fingerprint_status,
        fingerprint_slot: s.fingerprint_slot,
        is_active: s.is_active,
      })
    );

    return NextResponse.json({ students });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/students { student_id, full_name, class_id, gender?, guardian_contact? }
// Insert baris induk baru (face_status/fingerprint_status default not_enrolled).
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      student_id?: string;
      full_name?: string;
      class_id?: string;
      gender?: string;
      guardian_contact?: string;
    };
    const student_id = (body.student_id ?? "").trim();
    const full_name = (body.full_name ?? "").trim();
    const class_id = (body.class_id ?? "").trim();
    if (!student_id || !full_name || !class_id) {
      return NextResponse.json(
        { error: "student_id, full_name, dan class_id wajib diisi" },
        { status: 400 }
      );
    }
    const { data, error } = await supabaseServer
      .from("students")
      .insert({
        student_id,
        full_name,
        class_id,
        gender: body.gender || null,
        guardian_contact: body.guardian_contact || null,
      })
      .select("student_id")
      .single();
    if (error) {
      // 23505 = duplikat primary key student_id
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `Student ID "${student_id}" sudah terdaftar` },
          { status: 409 }
        );
      }
      throw error;
    }
    return NextResponse.json({ student_id: data.student_id }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
