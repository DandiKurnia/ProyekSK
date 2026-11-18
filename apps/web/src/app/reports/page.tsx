"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  TrendingUp,
  Users,
  CheckCircle2,
  Clock,
  XCircle,
  Armchair,
  Cpu,
  AlertTriangle,
  RotateCw,
} from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import type { ClassOption } from "@/lib/overview";
import { downloadCsv } from "@/lib/csv";

interface DailyRow {
  date: string;
  present: number;
  late: number;
  failed: number;
  expired: number;
  absent: number;
  rate: number;
}
interface DeviceRow {
  device_id: string;
  name: string;
  type: string;
  status: string;
  last_seen_at: string | null;
  stale: boolean;
}
interface ReportSummary {
  from: string;
  to: string;
  class_id: string;
  classes: ClassOption[];
  students: number;
  days: number;
  summary: {
    present: number;
    late: number;
    failed: number;
    expired: number;
    absent: number;
    attendance_rate: number;
  };
  daily: DailyRow[];
  seats: {
    available: boolean;
    seats_monitored: number;
    average_ratio: number | null;
    daily: { date: string; occupied: number; ratio: number }[];
  };
  devices: DeviceRow[];
}

const wibToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const shiftDays = (iso: string, n: number) => {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
};
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short" }).format(
    new Date(`${iso}T00:00:00+07:00`)
  );
const fmtStamp = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};
const deviceTypeLabel: Record<string, string> = {
  face_computer: "Face Recognition PC",
  fingerprint_esp32: "Fingerprint Scanner",
  rfid_esp32: "RFID Reader (RC522)",
  seat_esp32: "Seat Occupancy Hub",
  env_esp32: "Environment Sensor",
};

export default function ReportsPage() {
  const today = wibToday();
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState("");
  const [from, setFrom] = useState(() => shiftDays(wibToday(), -6));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        ...(classId ? { class_id: classId } : {}),
        from,
        to,
      });
      const res = await fetch(`/api/reports/summary?${q.toString()}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Gagal mengambil laporan");
      setData(d as ReportSummary);
      if (!classId && d.class_id) setClassId(d.class_id);
      if (d.classes?.length) setClasses(d.classes);
    } catch (err: unknown) {
      setData(null);
      setError(err instanceof Error ? err.message : "Gagal mengambil laporan");
    } finally {
      setLoading(false);
    }
  }, [classId, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const className =
    classes.find((c) => c.class_id === (data?.class_id ?? classId))?.name ?? data?.class_id ?? "";

  const exportCSV = () => {
    if (!data) return;
    const s0 = data.summary;
    downloadCsv(
      `reports-${className.replace(/\s+/g, "-").toLowerCase()}-${data.from}_${data.to}.csv`,
      [
        ["Laporan Absensi", className, data.from, data.to],
        ["Siswa Aktif", data.students, "Hari", data.days, "Attendance Rate", `${s0.attendance_rate}%`],
        [],
        ["Tanggal", "Present", "Late", "Absent", "Failed", "Expired", "Attendance Rate (%)"],
        ...data.daily.map((d) => [d.date, d.present, d.late, d.absent, d.failed, d.expired, d.rate]),
        [],
        ["Total", s0.present, s0.late, s0.absent, s0.failed, s0.expired, s0.attendance_rate],
      ]
    );
  };

  const s = data?.summary;
  const peak = Math.max(1, ...(data?.daily.map((d) => d.present + d.late) ?? [1]));

  return (
    <div className="flex min-h-screen bg-[#F6F8FA]">
      <Sidebar active="Reports" />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar
          classes={classes}
          activeClassId={classId}
          onClassChange={(id) => setClassId(id)}
          realtimeLive={false}
          onRefresh={load}
          refreshing={loading}
          pageTitle="Reports"
        />

        <main className="p-6 space-y-4 w-full flex-1">
          {/* Filter rentang tanggal */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-semibold text-aici-muted">Dari</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-aici-surface border border-aici-border rounded-xl px-3 py-2 text-xs font-semibold text-aici-dark outline-none focus:border-aici-dark"
            />
            <label className="text-xs font-semibold text-aici-muted">Sampai</label>
            <input
              type="date"
              value={to}
              min={from}
              max={wibToday()}
              onChange={(e) => setTo(e.target.value)}
              className="bg-aici-surface border border-aici-border rounded-xl px-3 py-2 text-xs font-semibold text-aici-dark outline-none focus:border-aici-dark"
            />
            <div className="flex gap-2">
              {[
                { label: "7 hari", n: -6 },
                { label: "30 hari", n: -29 },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    setFrom(shiftDays(wibToday(), p.n));
                    setTo(wibToday());
                  }}
                  className="px-3 py-2 rounded-xl border border-aici-border bg-aici-surface text-xs font-semibold text-aici-muted hover:text-aici-dark transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={exportCSV}
              disabled={!data || loading}
              className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-aici-dark text-white text-xs font-semibold disabled:opacity-40"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-aici-error-bg text-aici-error text-xs font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={load} className="flex items-center gap-1 underline">
                <RotateCw className="w-3 h-3" /> Coba lagi
              </button>
            </div>
          )}

          {/* KPI periode */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-2xl p-5 bg-aici-lime shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-aici-dark/70">Attendance Rate</span>
                <TrendingUp className="w-4 h-4 text-aici-dark" />
              </div>
              <div className="mt-2 text-3xl font-bold text-aici-dark">
                {loading || !s ? "—" : `${s.attendance_rate}%`}
              </div>
              <div className="text-[11px] font-medium text-aici-dark/60">
                {data ? `${data.students} siswa × ${data.days} hari` : "—"}
              </div>
            </div>
            {[
              { label: "Tepat Waktu", value: s?.present, icon: CheckCircle2, tint: "text-aici-success" },
              { label: "Terlambat", value: s?.late, icon: Clock, tint: "text-aici-warning" },
              { label: "Tidak Hadir", value: s?.absent, icon: XCircle, tint: "text-aici-error" },
              { label: "Total Siswa", value: data?.students, icon: Users },
            ].map((c) => (
              <div key={c.label} className="rounded-2xl p-5 bg-aici-surface shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-aici-muted">{c.label}</span>
                  <c.icon className={`w-4 h-4 ${c.tint ?? "text-aici-muted"}`} />
                </div>
                <div className="mt-2 text-3xl font-bold text-aici-dark">
                  {loading ? "—" : (c.value ?? "—")}
                </div>
              </div>
            ))}
          </div>

          {(s?.failed || s?.expired) ? (
            <p className="text-[11px] font-medium text-aici-muted">
              Percobaan gagal: {s.failed} failed · {s.expired} expired (tidak dihitung hadir maupun
              absen).
            </p>
          ) : null}

          <div className="grid lg:grid-cols-3 gap-4">
            {/* Tren kehadiran per hari */}
            <div className="lg:col-span-2 rounded-2xl p-5 bg-aici-surface shadow-sm">
              <h2 className="text-sm font-bold text-aici-dark">Tren Kehadiran</h2>
              <p className="text-[11px] text-aici-muted">Hadir (tepat waktu + terlambat) per hari</p>
              <div className="mt-4 flex items-end gap-1.5 h-40 overflow-x-auto pb-1">
                {(data?.daily ?? []).map((d) => {
                  const h = ((d.present + d.late) / peak) * 100;
                  return (
                    <div
                      key={d.date}
                      className="flex-1 min-w-[8px] h-full flex flex-col justify-end items-center group"
                      title={`${d.date}: ${d.present} present, ${d.late} late, ${d.absent} absen`}
                    >
                      <div
                        className="w-full rounded-t-md bg-aici-lime border border-aici-dark/10"
                        style={{ height: `${Math.max(2, h)}%` }}
                      />
                    </div>
                  );
                })}
                {!loading && !data?.daily.length && (
                  <p className="text-xs text-aici-muted">Tidak ada data pada periode ini.</p>
                )}
              </div>
              <div className="flex justify-between text-[10px] font-medium text-aici-muted mt-1">
                <span>{data ? fmtDate(data.from) : ""}</span>
                <span>{data ? fmtDate(data.to) : ""}</span>
              </div>
            </div>

            {/* Okupansi kursi */}
            <div className="rounded-2xl p-5 bg-aici-surface shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-aici-dark">Okupansi Kursi</h2>
                <Armchair className="w-4 h-4 text-aici-muted" />
              </div>
              {!data ? (
                <p className="mt-3 text-xs text-aici-muted">Memuat…</p>
              ) : !data.seats.available ? (
                <p className="mt-3 text-xs text-aici-muted">
                  Riwayat SeatEvents belum tersedia untuk periode ini. Jalankan migrasi
                  <code className="mx-1 px-1 rounded bg-aici-surface-nested">supabase/2026-11-16_seat_events.sql</code>
                  lalu muat ulang — tidak ada angka estimasi.
                </p>
              ) : data.seats.seats_monitored === 0 ? (
                <p className="mt-3 text-xs text-aici-muted">
                  Kelas ini belum punya kursi terpantau.
                </p>
              ) : (
                <>
                  <div className="mt-2 text-3xl font-bold text-aici-dark">
                    {data.seats.average_ratio ?? 0}%
                  </div>
                  <p className="text-[11px] text-aici-muted">
                    rata-rata · {data.seats.seats_monitored} kursi terpantau
                  </p>
                  <div className="mt-3 space-y-1.5 max-h-32 overflow-y-auto">
                    {data.seats.daily.map((d) => (
                      <div key={d.date} className="flex items-center gap-2 text-[11px]">
                        <span className="w-12 text-aici-muted">{fmtDate(d.date)}</span>
                        <div className="flex-1 h-2 rounded bg-aici-surface-nested overflow-hidden">
                          <div
                            className="h-full bg-aici-periwinkle"
                            style={{ width: `${Math.min(100, d.ratio)}%` }}
                          />
                        </div>
                        <span className="w-10 text-right font-semibold text-aici-dark">
                          {d.occupied}
                        </span>
                      </div>
                    ))}
                  </div>
                  {data.seats.daily.every((d) => d.occupied === 0) && (
                    <p className="mt-2 text-[11px] text-aici-muted">Tidak ada event okupansi.</p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Rekap harian */}
          <div className="rounded-2xl bg-aici-surface shadow-sm overflow-hidden">
            <h2 className="px-5 py-4 text-sm font-bold text-aici-dark border-b border-aici-border">
              Rekap Harian
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-aici-muted bg-aici-surface-nested">
                    {["Tanggal", "Present", "Late", "Absent", "Failed", "Expired", "Rate"].map((h) => (
                      <th key={h} className="px-5 py-3 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.daily ?? []).map((d) => (
                    <tr key={d.date} className="border-t border-aici-border">
                      <td className="px-5 py-3 font-semibold text-aici-dark">{d.date}</td>
                      <td className="px-5 py-3 text-aici-success">{d.present}</td>
                      <td className="px-5 py-3 text-aici-warning">{d.late}</td>
                      <td className="px-5 py-3 text-aici-error">{d.absent}</td>
                      <td className="px-5 py-3 text-aici-muted">{d.failed}</td>
                      <td className="px-5 py-3 text-aici-muted">{d.expired}</td>
                      <td className="px-5 py-3 font-semibold text-aici-dark">{d.rate}%</td>
                    </tr>
                  ))}
                  {!loading && !data?.daily.length && (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-aici-muted">
                        Tidak ada data pada periode ini.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Log konektivitas perangkat */}
          <div className="rounded-2xl bg-aici-surface shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-aici-border">
              <h2 className="text-sm font-bold text-aici-dark">Log Konektivitas Perangkat</h2>
              <p className="text-[11px] text-aici-muted">
                Status + terakhir terlihat (mentah). Riwayat event offline dan uptime belum tersedia.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-aici-muted bg-aici-surface-nested">
                    {["Perangkat", "Tipe", "Status", "Terakhir Terlihat"].map((h) => (
                      <th key={h} className="px-5 py-3 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.devices ?? []).map((d) => (
                    <tr key={d.device_id} className="border-t border-aici-border">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 font-semibold text-aici-dark">
                          <Cpu className="w-3.5 h-3.5 text-aici-muted" /> {d.name}
                        </div>
                        <div className="text-[10px] font-mono text-aici-muted">{d.device_id}</div>
                      </td>
                      <td className="px-5 py-3 text-aici-muted">
                        {deviceTypeLabel[d.type] ?? d.type}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            d.stale
                              ? "bg-aici-error-bg text-aici-error"
                              : "bg-aici-success-bg text-aici-success"
                          }`}
                        >
                          {d.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-aici-muted">{fmtStamp(d.last_seen_at)}</td>
                    </tr>
                  ))}
                  {!loading && !data?.devices.length && (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-aici-muted">
                        Belum ada perangkat terdaftar untuk kelas ini.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
