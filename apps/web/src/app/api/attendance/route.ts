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

    const { data, error, count } = await supabaseServer
      .from("attendance")
      .select(
        "attendance_id, student_id, status, check_in_at, face_confidence, fingerprint_slot, students(full_name), classes(name)",
        { count: "exact" }
      )
      .eq("class_id", activeClassId)
      .eq("date", dateParam)
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
