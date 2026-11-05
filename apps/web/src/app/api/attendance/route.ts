import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
export const dynamic = "force-dynamic";

// GET /api/attendance?class_id=...&date=YYYY-MM-DD&search=...&page=1&limit=20
// Sumber: tabel attendance + join students/classes (prd-attendance.md §3).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam =
      searchParams.get("date") ||
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(
        new Date()
      );
    const classIdParam = searchParams.get("class_id");
    const search = (searchParams.get("search") ?? "").trim().toLowerCase();
    const statusFilter = (searchParams.get("status") ?? "").trim().toLowerCase();
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number(searchParams.get("limit")) || 20)
    );

    const classesRes = await supabaseServer
      .from("classes")
      .select("class_id, name")
      .eq("is_active", true)
      .order("name");
    if (classesRes.error) throw classesRes.error;
    const classes = classesRes.data ?? [];
    const activeClassId = classIdParam || classes[0]?.class_id;

    if (!activeClassId) {
      return NextResponse.json({
        date: dateParam,
        class_id: "",
        classes: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        rows: [],
      });
    }

    let q = supabaseServer
      .from("attendance")
      .select(
        "attendance_id, student_id, status, check_in_at, face_confidence, fingerprint_slot, students(full_name), classes(name)",
        { count: "exact" }
      )
      .eq("class_id", activeClassId)
      .eq("date", dateParam);
    if (["present", "late", "failed", "expired"].includes(statusFilter)) q = q.eq("status", statusFilter);
    const { data, error, count } = await q
      .order("check_in_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;

    type Row = {
      attendance_id: string;
      student_id: string;
      status: string;
      check_in_at: string;
      face_confidence: number | null;
      fingerprint_slot: number | null;
      students: { full_name: string } | Array<{ full_name: string }> | null;
      classes: { name: string } | Array<{ name: string }> | null;
    };

    const pick = <T,>(v: T | T[] | null, k: keyof T): string | null => {
      if (!v) return null;
      const o = Array.isArray(v) ? v[0] : v;
      const val = o?.[k];
      return typeof val === "string" ? val : null;
    };

    let rows = ((data ?? []) as Row[]).map((r) => ({
      id: `sess-${r.attendance_id.slice(0, 4)}`,
      time: r.check_in_at,
      student_id: r.student_id,
      full_name: pick(r.students, "full_name") ?? r.student_id,
      class_name: pick(r.classes, "name") ?? activeClassId,
      face_confidence: r.face_confidence,
      fingerprint_slot: r.fingerprint_slot,
      status: r.status,
    }));

    if (search) {
      rows = rows.filter(
        (r) =>
          r.student_id.toLowerCase().includes(search) ||
          r.full_name.toLowerCase().includes(search) ||
          r.id.toLowerCase().includes(search)
      );
    }

    const total = count ?? rows.length;
    return NextResponse.json({
      date: dateParam,
      class_id: activeClassId,
      classes,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      rows,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
// POST /api/attendance { student_id }
// Otak penentu absensi (prd-attendance.md §3 langkah 5): BUKAN browser yang dipercaya,
// melainkan sesi 2FA di face-service. Urutan: cek siswa -> cek sesi verified/fresh ->
// hitung present/late -> upsert idempoten -> konsumsi sesi -> LED (best-effort).
const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8200";
const SESSION_MAX_AGE_S = 120; // bukti verified kedaluwarsa setelah 2 menit (anti-replay)

async function faceFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${FACE_URL}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** `app_config.late_threshold` boleh `"07:15"` atau `{"time":"07:15"}`; format lain -> null (fallback present). */
function parseLateTime(v: unknown): string | null {
  const raw = typeof v === "string" ? v : v && typeof v === "object" && "time" in v ? v.time : null;
  return typeof raw === "string" && /^\d{2}:\d{2}$/.test(raw) ? raw : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { student_id?: unknown } | null;
    const studentId = typeof body?.student_id === "string" ? body.student_id.trim() : "";
    if (!studentId) return NextResponse.json({ error: "student_id wajib diisi" }, { status: 400 });

    // 1. Identitas siswa + slot terdaftar (sumber kebenaran pemetaan wajah<->jari)
    const stu = await supabaseServer
      .from("students")
      .select("student_id, class_id, full_name, fingerprint_slot")
      .eq("student_id", studentId)
      .eq("is_active", true)
      .maybeSingle();
    if (stu.error) throw stu.error;
    if (!stu.data?.class_id) return NextResponse.json({ error: "siswa tidak dikenal/aktif" }, { status: 404 });
    if (!stu.data.fingerprint_slot)
      return NextResponse.json({ error: "siswa belum enroll sidik jari" }, { status: 403 });

    // 2. Bukti 2FA: sesi di face-service harus verified untuk siswa ini + slot cocok + masih segar
    const sess = await faceFetch("/fingerprint/session");
    if (sess.status !== 200 || !sess.data || typeof sess.data !== "object")
      return NextResponse.json({ error: "face-service tidak terjangkau" }, { status: 502 });
    const s: Record<string, unknown> = sess.data; // batas jaringan: field divalidasi satu per satu di bawah
    const sState = typeof s.state === "string" ? s.state : "";
    const isAudit = sState === "failed" || sState === "expired";
    if (sState !== "verified" && !isAudit)
      return NextResponse.json({ error: `sesi belum verified (state: ${sState})` }, { status: 409 });
    if (s.student_id !== studentId)
      return NextResponse.json({ error: "bukti 2FA bukan milik siswa ini" }, { status: 403 });
    if (!isAudit) {
      // bukti sah hanya jika slot cocok + masih segar
      if (Number(s.matched_slot) !== Number(stu.data.fingerprint_slot))
        return NextResponse.json({ error: "bukti 2FA bukan milik siswa ini" }, { status: 403 });
      const verifiedAt = Number(s.verified_at ?? 0);
      if (!verifiedAt || Date.now() / 1000 - verifiedAt > SESSION_MAX_AGE_S)
        return NextResponse.json({ error: "bukti 2FA kedaluwarsa, ulangi scan wajah" }, { status: 409 });
    }
    // 3. Status present/late dari app_config.late_threshold {"time":"HH:MM"} WIB
    const nowDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const nowHm = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
    const cfg = await supabaseServer.from("app_config").select("value").eq("key", "late_threshold").maybeSingle();
    const lateTime = cfg.data && "value" in cfg.data ? parseLateTime(cfg.data.value) : null;
    // 4. Tulis idempoten. Verified -> upsert (boleh menimpa baris audit hari itu);
    //    audit failed/expired -> insert-only supaya tidak menurunkan baris present/late.
    const finalStatus = isAudit ? sState : lateTime && nowHm > lateTime ? "late" : "present";
    const faceConfidence = s.face_confidence;
    const row = {
      student_id: studentId,
      class_id: stu.data.class_id,
      date: nowDate,
      check_in_at: new Date().toISOString(),
      face_confidence: typeof faceConfidence === "number" ? faceConfidence : null,
      fingerprint_slot: Number(stu.data.fingerprint_slot),
      status: finalStatus,
    };
    const write = isAudit
      ? supabaseServer.from("attendance").upsert(row, { onConflict: "student_id,class_id,date", ignoreDuplicates: true })
      : supabaseServer.from("attendance").upsert(row, { onConflict: "student_id,class_id,date" });
    const saved = await write.select("attendance_id, status, check_in_at").single();
    if (saved.error && !(isAudit && saved.error.code === "23505"))
      throw saved.error;
    // audit yang menabrak baris existing = tidak mencatat apa-apa; baca state terkini untuk respons
    const current =
      saved.data ??
      (await supabaseServer
        .from("attendance")
        .select("attendance_id, status, check_in_at")
        .match({ student_id: studentId, class_id: stu.data.class_id, date: nowDate })
        .single()).data;
    if (!current) throw new Error("gagal membaca baris absensi");

    // 5. Konsumsi bukti (sekali pakai). LED hijau hanya untuk absensi yang benar-benar sah.
    void faceFetch("/fingerprint/session", { method: "DELETE" });
    if (!isAudit)
      void faceFetch("/fingerprint/led", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });

    return NextResponse.json(
      {
        attendance_id: current.attendance_id,
        student_id: studentId,
        full_name: stu.data.full_name,
        status: current.status,
        check_in_at: current.check_in_at,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
