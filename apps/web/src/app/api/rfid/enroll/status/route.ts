import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
// GET /api/rfid/enroll/status?student_id=X
// Polling jendela daftar kartu. Saat firmware melaporkan CARD_OK, UID diikat ke
// siswa di sini (service role) - face-service tidak memegang kredensial database.
export const dynamic = "force-dynamic";

const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8000";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const studentId = (searchParams.get("student_id") ?? "").trim();
    if (!studentId) {
      return NextResponse.json({ error: "student_id wajib diisi" }, { status: 400 });
    }

    const res = await fetch(`${FACE_URL}/rfid/enroll/status`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      stage?: string;
      ok?: boolean | null;
      uid?: string | null;
      student_id?: string;
      detail?: string;
    };
    if (!res.ok) {
      return NextResponse.json({ error: data.detail ?? `face-service HTTP ${res.status}` }, { status: 502 });
    }

    if (data.stage !== "done" || !data.ok || !data.uid) {
      return NextResponse.json({ stage: data.stage ?? "idle", ok: data.ok ?? null, uid: null });
    }
    if (data.student_id && data.student_id !== studentId) {
      return NextResponse.json(
        { error: `jendela daftar milik siswa ${data.student_id}, bukan ${studentId}` },
        { status: 409 }
      );
    }

    const uid = data.uid.toUpperCase();
    // Satu kartu hanya boleh menunjuk satu siswa: jangan menimpa diam-diam.
    const own = await supabaseServer
      .from("rfid_cards")
      .select("student_id")
      .eq("uid", uid)
      .maybeSingle();
    if (own.error) throw own.error;
    if (own.data && own.data.student_id !== studentId) {
      return NextResponse.json(
        { error: `kartu ${uid} sudah terdaftar untuk siswa ${own.data.student_id}` },
        { status: 409 }
      );
    }

    const saved = await supabaseServer
      .from("rfid_cards")
      .upsert({ uid, student_id: studentId }, { onConflict: "uid" });
    if (saved.error) throw saved.error;

    return NextResponse.json({ stage: "done", ok: true, uid, saved: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
