import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
export const dynamic = "force-dynamic";

// GET /api/dashboard/overview-summary?class_id=...&date=YYYY-MM-DD
// Sesuai prd-overview.md §3 + docs/dashboard.md.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam =
      searchParams.get("date") ||
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(
        new Date()
      );
    const classIdParam = searchParams.get("class_id");

    const [classesRes, configRes] = await Promise.all([
      supabaseServer
        .from("classes")
        .select("class_id, name")
        .eq("is_active", true)
        .order("name"),
      supabaseServer.from("app_config").select("key, value"),
    ]);

    if (classesRes.error) throw classesRes.error;

    const classes = classesRes.data ?? [];
    const activeClassId = classIdParam || classes[0]?.class_id;

    if (!activeClassId) {
      return NextResponse.json({
        date: dateParam,
        class_id: "",
        classes: [],
        total: 0,
        present: 0,
        late: 0,
        absent: 0,
        failed: 0,
        expired: 0,
        seats: { total: 0, occupied: 0, empty: 0, unknown: 0 },
        devices: [],
        recent: [],
        device_offline_seconds: 60,
      });
    }

    const configs = Object.fromEntries(
      (configRes.data ?? []).map((r: { key: string; value: unknown }) => [
        r.key,
        r.value,
      ])
    );
    const offlineSec = Number(configs["device_offline_seconds"]) || 60;

    const [studentsRes, attendanceRes, seatsRes, devicesRes, recentRes] =
      await Promise.all([
        supabaseServer
          .from("students")
          .select("student_id", { count: "exact", head: true })
          .eq("class_id", activeClassId)
          .eq("is_active", true),
        supabaseServer
          .from("attendance")
          .select("status")
          .eq("class_id", activeClassId)
          .eq("date", dateParam),
        supabaseServer
          .from("seats")
          .select("seat_id, seat_status(status)")
          .eq("class_id", activeClassId)
          .eq("is_monitored", true),
        supabaseServer
          .from("devices")
          .select("device_id, name, type, status, last_seen_at")
          .eq("class_id", activeClassId)
          .eq("is_active", true),
        supabaseServer
          .from("attendance")
          .select(
            "attendance_id, student_id, status, check_in_at, face_confidence, fingerprint_slot, students(full_name)"
          )
          .eq("class_id", activeClassId)
          .eq("date", dateParam)
          .order("check_in_at", { ascending: false })
          .limit(10),
      ]);

    const totalStudents = studentsRes.count ?? 0;
    const attRows = attendanceRes.data ?? [];
    let present = 0;
    let late = 0;
    let failed = 0;
    let expired = 0;

    for (const row of attRows) {
      if (row.status === "present") present++;
      else if (row.status === "late") late++;
      else if (row.status === "failed") failed++;
      else if (row.status === "expired") expired++;
    }

    // Status 'absent': siswa tanpa baris attendance (docs/database.md § Keputusan Skema)
    const recorded = present + late + failed + expired;
    const absent = Math.max(0, totalStudents - recorded);

    const seatBuckets = { total: 0, occupied: 0, empty: 0, unknown: 0 };
    for (const s of (seatsRes.data ?? []) as Array<{
      seat_status: { status: string } | Array<{ status: string }> | null;
    }>) {
      seatBuckets.total++;
      const raw = s.seat_status;
      const st = (Array.isArray(raw) ? raw[0]?.status : raw?.status) ?? null;
      if (st === "occupied") seatBuckets.occupied++;
      else if (st === "empty") seatBuckets.empty++;
      else seatBuckets.unknown++;
    }

    const now = Date.now();
    const devices = (devicesRes.data ?? []).map((d) => {
      const lastSeen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0;
      const isStale = !lastSeen || (now - lastSeen) / 1000 > offlineSec;
      return {
        device_id: d.device_id,
        name: d.name,
        type: d.type,
        status: isStale ? "offline" : d.status,
        last_seen_at: d.last_seen_at,
        stale: isStale,
      };
    });

    const recent = (recentRes.data ?? []).map(
      (r: {
        attendance_id: string;
        student_id: string;
        status: string;
        check_in_at: string;
        face_confidence: number | null;
        fingerprint_slot: number | null;
        students: { full_name: string } | Array<{ full_name: string }> | null;
      }) => ({
        attendance_id: r.attendance_id,
        student_id: r.student_id,
        student_name: (Array.isArray(r.students) ? r.students[0]?.full_name : r.students?.full_name) ?? null,
        status: r.status,
        check_in_at: r.check_in_at,
        face_confidence: r.face_confidence,
        fingerprint_slot: r.fingerprint_slot,
      })
    );

    return NextResponse.json({
      date: dateParam,
      class_id: activeClassId,
      classes: classes.map((c) => ({ class_id: c.class_id, name: c.name })),
      total: totalStudents,
      present,
      late,
      absent,
      failed,
      expired,
      seats: seatBuckets,
      devices,
      recent,
      device_offline_seconds: offlineSec,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
