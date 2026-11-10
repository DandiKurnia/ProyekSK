import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
// POST /api/fingerprint/enroll { student_id, slot? }
// Alur (A2/A3): alokasikan slot dulu -> tandai DB pending -> kirim ENROLL.
// Balik { started, slot, re_enroll } agar polling status tahu apakah slot baru/total menimpa.
export const dynamic = "force-dynamic";

const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8000";
const MAX_SLOT = 200;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { student_id?: string; slot?: number };
    const student_id = (body.student_id ?? "").trim();
    if (!student_id) {
      return NextResponse.json({ error: "student_id wajib diisi" }, { status: 400 });
    }

    const { data: row, error: rowError } = await supabaseServer
      .from("students")
      .select("student_id, fingerprint_slot, fingerprint_status")
      .eq("student_id", student_id)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) {
      return NextResponse.json(
        { error: `student_id '${student_id}' tidak ada di tabel students. Tambah siswa dulu.` },
        { status: 404 }
      );
    }

    let slot = body.slot ?? row.fingerprint_slot;
    let re_enroll = true;
    if (!slot) {
      // Alokasi: slot terkecil belum dipakai (mapping 1:1 permanen, bukan rotasi)
      const { data: used, error: usedError } = await supabaseServer
        .from("students")
        .select("fingerprint_slot")
        .not("fingerprint_slot", "is", null);
      if (usedError) throw usedError;
      const taken = new Set((used ?? []).map((r) => r.fingerprint_slot as number));
      slot = null;
      for (let s = 1; s <= MAX_SLOT; s++) {
        if (!taken.has(s)) {
          slot = s;
          break;
        }
      }
      if (!slot) {
        return NextResponse.json({ error: "semua 200 slot sensor sudah terpakai" }, { status: 409 });
      }
      re_enroll = false;
    }

    const { error: pendError } = await supabaseServer
      .from("students")
      .update({ fingerprint_status: "pending", fingerprint_slot: slot })
      .eq("student_id", student_id);
    if (pendError) throw pendError;

    const res = await fetch(`${FACE_URL}/fingerprint/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot }),
      signal: AbortSignal.timeout(5000), // hanya kirim perintah; polling via /enroll/status
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { detail?: string };
      return NextResponse.json(
        { error: detail.detail ?? `face-service HTTP ${res.status}` },
        { status: res.status === 409 ? 409 : 502 }
      );
    }
    return NextResponse.json({ started: true, slot, re_enroll });
  } catch (err: unknown) {
    return NextResponse.json(
      { started: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
