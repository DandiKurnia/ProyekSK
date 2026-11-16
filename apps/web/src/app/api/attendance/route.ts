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
        "attendance_id, student_id, status, check_in_at, check_out_at, face_confidence, fingerprint_slot, students(full_name), classes(name)",
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
      check_out_at: string | null;
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
      check_out_at: r.check_out_at,
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
const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8000";
const SESSION_MAX_AGE_S = 120; // bukti verified kedaluwarsa setelah 2 menit (anti-replay)

async function faceFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${FACE_URL}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** PostgrestError bukan `Error` (objek biasa), jadi `String(err)` jadi "[object Object]". */
function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return String(err);
}

/** Nilai jam di `app_config` boleh `"07:15"` atau `{"time":"07:15"}`; format lain -> null. */
function parseHm(v: unknown): string | null {
  const raw = typeof v === "string" ? v : v && typeof v === "object" && "time" in v ? v.time : null;
  return typeof raw === "string" && /^\d{2}:\d{2}$/.test(raw) ? raw : null;
}

/** `app_config.checkout_after` kosong/rusak -> jam ini (WIB), supaya absen pulang tetap bisa dicatat. */
const DEFAULT_CHECKOUT_AFTER = "12:00";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { student_id?: unknown } | null;
    const studentId = typeof body?.student_id === "string" ? body.student_id.trim() : "";
    if (!studentId) return NextResponse.json({ error: "student_id wajib diisi" }, { status: 400 });

    // 1. Identitas siswa + faktor kedua terdaftar (jari ATAU kartu)
    const [stu, cards] = await Promise.all([
      supabaseServer
        .from("students")
        .select("student_id, class_id, full_name, fingerprint_slot")
        .eq("student_id", studentId)
        .eq("is_active", true)
        .maybeSingle(),
      supabaseServer.from("rfid_cards").select("uid").eq("student_id", studentId),
    ]);
    if (stu.error) throw stu.error;
    if (cards.error) throw cards.error;
    if (!stu.data?.class_id) return NextResponse.json({ error: "siswa tidak dikenal/aktif" }, { status: 404 });
    const boundUids = (cards.data ?? []).map((c) => String(c.uid).toUpperCase());
    if (!stu.data.fingerprint_slot && boundUids.length === 0)
      return NextResponse.json({ error: "siswa belum enroll sidik jari maupun kartu" }, { status: 403 });

    // 2. Bukti 2FA: sesi di face-service harus verified untuk siswa ini + masih segar.
    //    Faktor cocok = slot cocok (jari) ATAU UID terikat (kartu).
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
    const matchedUid =
      typeof s.matched_uid === "string" ? s.matched_uid.toUpperCase() : null;
    const factorOk =
      (stu.data.fingerprint_slot != null &&
        Number(s.matched_slot) === Number(stu.data.fingerprint_slot)) ||
      (matchedUid != null && boundUids.includes(matchedUid));
    if (!isAudit) {
      // bukti sah hanya jika salah satu faktor cocok + masih segar
      if (!factorOk)
        return NextResponse.json({ error: "bukti 2FA bukan milik siswa ini" }, { status: 403 });
      const verifiedAt = Number(s.verified_at ?? 0);
      if (!verifiedAt || Date.now() / 1000 - verifiedAt > SESSION_MAX_AGE_S)
        return NextResponse.json({ error: "bukti 2FA kedaluwarsa, ulangi scan wajah" }, { status: 409 });
    }
    // 3. Ambang dari app_config (WIB): late_threshold {"time":"HH:MM"} + checkout_after
    const nowDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const nowHm = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
    const cfg = await supabaseServer
      .from("app_config")
      .select("key, value")
      .in("key", ["late_threshold", "checkout_after"]);
    if (cfg.error) throw cfg.error;
    const cfgMap = new Map((cfg.data ?? []).map((r) => [String(r.key), r.value as unknown]));
    const lateTime = parseHm(cfgMap.get("late_threshold"));
    const checkoutAfter = parseHm(cfgMap.get("checkout_after")) ?? DEFAULT_CHECKOUT_AFTER;

    type SavedRow = {
      attendance_id: string;
      status: string;
      check_in_at: string;
      check_out_at: string | null;
    };

    // 4. Baris hari ini menentukan masuk vs pulang (unik: student_id+class_id+date).
    const found = await supabaseServer
      .from("attendance")
      .select("attendance_id, status, check_in_at, check_out_at")
      .match({ student_id: studentId, class_id: stu.data.class_id, date: nowDate })
      .maybeSingle();
    if (found.error) throw found.error;
    const today = (found.data as SavedRow | null) ?? null;
    const counted = !!today && (today.status === "present" || today.status === "late");

    let current: SavedRow | null = null;
    let action: "check_in" | "check_out" = "check_in";

    if (counted && today) {
      if (nowHm >= checkoutAfter) {
        // Scan setelah jam pulang: catat jam pulang, jam masuk TIDAK bergeser.
        action = "check_out";
        if (today.check_out_at) {
          current = today; // sudah pernah pulang: idempoten
        } else {
          const upd = await supabaseServer
            .from("attendance")
            .update({ check_out_at: new Date().toISOString() })
            .eq("attendance_id", today.attendance_id)
            .select("attendance_id, status, check_in_at, check_out_at")
            .single();
          if (upd.error) throw upd.error;
          current = upd.data as SavedRow;
        }
      } else {
        // Scan ulang sebelum jam pulang: idempoten, jam masuk pertama dipertahankan.
        current = today;
      }
    }

    // 5. Belum ada baris sah hari ini (atau baris audit failed/expired): tulis sebagai masuk.
    if (!current) {
      const finalStatus = isAudit ? sState : lateTime && nowHm > lateTime ? "late" : "present";
      const faceConfidence = s.face_confidence;
      // Bukti yang benar-benar dipakai: kartu (kalau cocok) didahulukan, sisanya slot jari.
      // Skema `attendance` tidak punya kolom rfid_uid; kartu terekam sebagai fingerprint_slot NULL.
      const usedUid = factorOk && matchedUid && boundUids.includes(matchedUid) ? matchedUid : null;
      const row = {
        student_id: studentId,
        class_id: stu.data.class_id,
        date: nowDate,
        check_in_at: new Date().toISOString(),
        face_confidence: typeof faceConfidence === "number" ? faceConfidence : null,
        fingerprint_slot: usedUid ? null : stu.data.fingerprint_slot,
        // tidak ada kolom rfid_uid di attendance - JANGAN tambahkan tanpa migrasi
        status: finalStatus,
      };
      const write = isAudit
        ? supabaseServer.from("attendance").upsert(row, { onConflict: "student_id,class_id,date", ignoreDuplicates: true })
        : supabaseServer.from("attendance").upsert(row, { onConflict: "student_id,class_id,date" });
      const saved = await write.select("attendance_id, status, check_in_at, check_out_at").single();
      // Audit (failed/expired) yang menabrak baris existing mengembalikan 0 baris -> PGRST116,
      // itu bukan kegagalan: langkah di bawah membaca baris yang sudah ada.
      if (
        saved.error &&
        !(isAudit && (saved.error.code === "23505" || saved.error.code === "PGRST116"))
      )
        throw saved.error;
      // audit yang menabrak baris existing = tidak mencatat apa-apa; baca state terkini untuk respons
      current =
        (saved.data as SavedRow | null) ??
        ((await supabaseServer
          .from("attendance")
          .select("attendance_id, status, check_in_at, check_out_at")
          .match({ student_id: studentId, class_id: stu.data.class_id, date: nowDate })
          .single()).data as SavedRow | null);
    }
    if (!current) throw new Error("gagal membaca baris absensi");

    // 6. Konsumsi bukti (sekali pakai). LED hijau hanya untuk absensi yang benar-benar sah.
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
        action,
        status: current.status,
        check_in_at: current.check_in_at,
        check_out_at: current.check_out_at,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { error: errText(err) },
      { status: 500 }
    );
  }
}
