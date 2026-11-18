import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
export const dynamic = "force-dynamic";

// GET /api/reports/summary?class_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD
// Agregasi server-side (prd-reports.md §3 §4.2): klien hanya menampilkan hasil.
const wibToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const isDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00+07:00`));
const MAX_DAYS = 92;

function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  while (t <= end && out.length < MAX_DAYS) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const to = searchParams.get("to") || wibToday();
    const from = searchParams.get("from") || to;
    if (!isDate(from) || !isDate(to) || from > to) {
      return NextResponse.json(
        { error: "Rentang tanggal tidak valid (format YYYY-MM-DD, from <= to)" },
        { status: 400 }
      );
    }
    const days = dayList(from, to);

    const classesRes = await supabaseServer
      .from("classes")
      .select("class_id, name")
      .eq("is_active", true)
      .order("name");
    if (classesRes.error) throw classesRes.error;
    const classes = classesRes.data ?? [];
    const classId = searchParams.get("class_id") || classes[0]?.class_id;
    if (!classId) {
      return NextResponse.json({
        from, to, class_id: "", classes, students: 0, days: days.length,
        summary: { present: 0, late: 0, failed: 0, expired: 0, absent: 0, attendance_rate: 0 },
        daily: [], seats: { available: true, seats_monitored: 0, average_ratio: null, daily: [] },
        devices: [],
      });
    }

    const studentsRes = await supabaseServer
      .from("students")
      .select("student_id")
      .eq("class_id", classId)
      .eq("is_active", true);
    if (studentsRes.error) throw studentsRes.error;
    const studentCount = (studentsRes.data ?? []).length;

    const attRes = await supabaseServer
      .from("attendance")
      .select("student_id, status, date")
      .eq("class_id", classId)
      .gte("date", from)
      .lte("date", to);
    if (attRes.error) throw attRes.error;

    type Att = { student_id: string; status: string; date: string };
    const rows = (attRes.data ?? []) as Att[];
    // Absent = siswa aktif tanpa baris present/late pada hari itu.
    // Baris gagal (failed/expired) tidak dihitung hadir maupun absennya sendiri.
    const count: Record<string, { present: number; late: number; failed: number; expired: number; attended: Set<string> }> = {};
    for (const d of days) count[d] = { present: 0, late: 0, failed: 0, expired: 0, attended: new Set() };
    for (const r of rows) {
      const b = count[r.date];
      if (!b) continue;
      if (r.status === "present") { b.present++; b.attended.add(r.student_id); }
      else if (r.status === "late") { b.late++; b.attended.add(r.student_id); }
      else if (r.status === "failed") b.failed++;
      else if (r.status === "expired") b.expired++;
    }

    const daily = days.map((d) => {
      const b = count[d];
      const absent = Math.max(0, studentCount - b.attended.size);
      const rate = studentCount > 0 ? ((b.present + b.late) / studentCount) * 100 : 0;
      return {
        date: d,
        present: b.present,
        late: b.late,
        failed: b.failed,
        expired: b.expired,
        absent,
        rate: Math.round(rate * 10) / 10,
      };
    });
    const tot = (k: "present" | "late" | "failed" | "expired") =>
      daily.reduce((a, d) => a + d[k], 0);
    const absentTotal = daily.reduce((a, d) => a + d.absent, 0);
    const slots = studentCount * days.length;
    const summary = {
      present: tot("present"),
      late: tot("late"),
      failed: tot("failed"),
      expired: tot("expired"),
      absent: absentTotal,
      attendance_rate: slots > 0 ? Math.round(((tot("present") + tot("late")) / slots) * 1000) / 10 : 0,
    };

    // Okupansi: kursi berbeda yang sempat berstatus occupied per hari (distinct),
    // dinormalisasi terhadap jumlah kursi terpantau. Kursi yang tetap terisi dari
    // hari sebelumnya tanpa event baru tidak terhitung — batas yang disengaja
    // sampai ada replay status penuh (ponytail: ganti per-butir time-weighted bila perlu).
    let seats = { available: true, seats_monitored: 0, average_ratio: null as number | null, daily: [] as { date: string; occupied: number; ratio: number }[] };
    const seatsRes = await supabaseServer
      .from("seats")
      .select("seat_id")
      .eq("class_id", classId)
      .eq("is_monitored", true);
    if (!seatsRes.error && seatsRes.data?.length) {
      const ids = seatsRes.data.map((s) => s.seat_id as string);
      const evRes = await supabaseServer
        .from("seat_events")
        .select("seat_id, new_status, created_at")
        .in("seat_id", ids)
        .gte("created_at", `${from}T00:00:00+07:00`)
        .lt("created_at", `${to}T23:59:59.999+07:00`);
      if (evRes.error) {
        // PGRST205 (tabel seat_events belum dimigrasi) -> empty state, bukan estimasi.
        seats = { available: false, seats_monitored: ids.length, average_ratio: null, daily: [] };
      } else {
        const perDay: Record<string, Set<string>> = {};
        for (const d of days) perDay[d] = new Set();
        for (const e of (evRes.data ?? []) as { seat_id: string; new_status: string; created_at: string }[]) {
          if (e.new_status !== "occupied") continue;
          const wd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(e.created_at));
          perDay[wd]?.add(e.seat_id);
        }
        const seatDaily = days.map((d) => ({
          date: d,
          occupied: perDay[d].size,
          ratio: ids.length > 0 ? Math.round((perDay[d].size / ids.length) * 1000) / 10 : 0,
        }));
        seats = {
          available: true,
          seats_monitored: ids.length,
          average_ratio:
            days.length > 0
              ? Math.round((seatDaily.reduce((a, d) => a + d.ratio, 0) / days.length) * 10) / 10
              : 0,
          daily: seatDaily,
        };
      }
    }

    // Konektivitas mentah: belum ada tabel riwayat offline perangkat,
    // jadi tunjukkan status + last-seen terkini (tanpa skor reliability).
    const devRes = await supabaseServer
      .from("devices")
      .select("device_id, name, type, status, last_seen_at, class_id")
      .order("name");
    if (devRes.error) throw devRes.error;
    const devices = ((devRes.data ?? []) as {
      device_id: string; name: string; type: string; status: string; last_seen_at: string | null; class_id: string | null;
    }[])
      .filter((d) => !d.class_id || d.class_id === classId)
      .map((d) => ({ ...d, stale: d.status !== "online" }));

    return NextResponse.json({
      from, to, class_id: classId, classes, students: studentCount, days: days.length,
      summary, daily, seats, devices,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
