import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
// POST /api/fingerprint/session { student_id, ttl? }
// Buka jendela verifikasi lokal saat wajah terkunci. Faktor kedua = sidik jari
// ATAU kartu RFID: Route Handler yang membaca slot + UID terikat dari Supabase,
// face-service tidak pernah memegang kredensial database.
export const dynamic = "force-dynamic";

const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8000";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      student_id?: unknown;
      ttl?: unknown;
    };
    const studentId = typeof body.student_id === "string" ? body.student_id.trim() : "";
    if (!studentId) return NextResponse.json({ detail: "student_id wajib diisi" }, { status: 400 });

    const [stu, cards] = await Promise.all([
      supabaseServer
        .from("students")
        .select("fingerprint_slot")
        .eq("student_id", studentId)
        .maybeSingle(),
      supabaseServer.from("rfid_cards").select("uid").eq("student_id", studentId),
    ]);
    if (stu.error) throw stu.error;
    if (cards.error) throw cards.error;
    const slot = stu.data?.fingerprint_slot ?? null;
    const uids = (cards.data ?? []).map((c) => c.uid as string);
    if (!slot && uids.length === 0) {
      return NextResponse.json(
        { detail: "siswa belum enroll sidik jari maupun kartu RFID" },
        { status: 400 }
      );
    }

    const res = await fetch(`${FACE_URL}/fingerprint/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ student_id: studentId, slot, uids, ttl: body.ttl }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function GET() {
  try {
    const res = await fetch(`${FACE_URL}/fingerprint/session`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    return NextResponse.json(
      { state: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function DELETE() {
  try {
    const res = await fetch(`${FACE_URL}/fingerprint/session`, {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err: unknown) {
    return NextResponse.json(
      { state: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
