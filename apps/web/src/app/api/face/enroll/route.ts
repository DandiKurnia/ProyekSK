import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
// POST /api/face/enroll { student_id, images_base64[] }
// Operasi DESTUKTIF (re-enroll menimpa data lama) — hanya untuk operator.
// Diteruskan ke POST :8200/enroll (contract: prd-students.md §3).
export const dynamic = "force-dynamic";

const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8200";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      student_id?: string;
      images_base64?: string[];
    };
    const student_id = (body.student_id ?? "").trim();
    if (!student_id) {
      return NextResponse.json(
        { error: "student_id wajib diisi" },
        { status: 400 }
      );
    }
    if (!body.images_base64 || body.images_base64.length === 0) {
      return NextResponse.json(
        { error: "images_base64 wajib berisi minimal 1 sampel" },
        { status: 400 }
      );
    }
    const res = await fetch(`${FACE_URL}/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        student_id,
        images_base64: body.images_base64,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json();
    if (res.ok && data.enrolled) {
      // Sinkron: wajah tersimpan di .npz lokal -> tandai baris induk di Supabase.
      const { data: updated, error: dbError } = await supabaseServer
        .from("students")
        .update({ face_status: "enrolled", face_enrolled_at: new Date().toISOString() })
        .eq("student_id", student_id)
        .select("student_id");
      const syncOk = !dbError && updated && updated.length > 0;
      if (!syncOk) {
        // Rollback (A3): hapus embedding yatim dari .npz agar tidak ada wajah tanpa induk.
        await fetch(`${FACE_URL}/enroll/${encodeURIComponent(student_id)}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(15000),
        }).catch(() => {});
        return NextResponse.json(
          {
            enrolled: false,
            supabase_synced: false,
            error: dbError
              ? `Supabase error: ${dbError.message} — embedding lokal dibatalkan (rollback).`
              : `Wajah ${student_id} dibatalkan (rollback): student_id tidak ada di tabel students. Tambah data siswa dulu via /students.`,
          },
          { status: 422 }
        );
      }
      return NextResponse.json({ ...data, supabase_synced: true }, { status: res.status });
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        enrolled: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
