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

// DELETE /api/students?student_id=X — hapus permanen (bukan nonaktif).
// Urutan: purge embedding .npz -> hapus riwayat attendance -> hapus baris induk.
// Bila face-service tidak bisa memastikan embedding terhapus, batalkan supaya
// tidak ada wajah yatim yang masih ikut dicocokkan oleh /recognize.
const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8000";

export async function DELETE(request: Request) {
  try {
    const student_id = (
      new URL(request.url).searchParams.get("student_id") ?? ""
    ).trim();
    if (!student_id) {
      return NextResponse.json({ error: "student_id wajib diisi" }, { status: 400 });
    }

    // 1. Purge embedding lokal. 404 = memang tidak pernah enroll (aman dilanjut).
    let facePurged = false;
    try {
      const res = await fetch(
        `${FACE_URL}/enroll/${encodeURIComponent(student_id)}`,
        { method: "DELETE", signal: AbortSignal.timeout(15000) }
      );
      if (res.ok) facePurged = true;
      else if (res.status !== 404) {
        return NextResponse.json(
          { error: `face-service menolak hapus embedding (${res.status}). Dibatalkan.` },
          { status: 502 }
        );
      }
    } catch (err: unknown) {
      return NextResponse.json(
        {
          error: `face-service tidak terjangkau (${
            err instanceof Error ? err.message : String(err)
          }). Dibatalkan agar tidak ada embedding yatim.`,
        },
        { status: 502 }
      );
    }

    // 2. Riwayat absensi menahan FK student_id -> hapus dulu.
    const att = await supabaseServer
      .from("attendance")
      .delete()
      .eq("student_id", student_id);
    if (att.error) throw att.error;

    // 3. Baris induk.
    const { data, error } = await supabaseServer
      .from("students")
      .delete()
      .eq("student_id", student_id)
      .select("student_id");
    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: `Student ID "${student_id}" tidak ditemukan` },
        { status: 404 }
      );
    }

    return NextResponse.json({ student_id, deleted: true, face_purged: facePurged });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
