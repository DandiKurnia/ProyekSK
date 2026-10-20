import { NextResponse } from "next/server";

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
