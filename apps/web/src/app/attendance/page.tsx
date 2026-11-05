"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Download,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CheckCircle2,
  XCircle,
  Clock,
  Fingerprint,
  ExternalLink,
  ChevronRight as ChevronRightIcon,
  X,
  ScanFace,
  Radio,
  Database,
  ShieldCheck,
} from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import type { ClassOption } from "@/lib/overview";

interface AttendanceRow {
  id: string;
  time: string;
  student_id: string;
  full_name: string;
  class_name: string;
  face_confidence: number | null;
  fingerprint_slot: number | null;
  fingerprint_label?: string;
  status: "Present" | "Late" | "Pending" | "Failed" | "Expired" | "Absent";
  status_label?: string;
  is_live?: boolean;
}

export default function AttendancePage() {
  // Live-only: tanpa mock. API mengembalikan classes + rows sesuai DB.
  const todayId = () =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [activeClassId, setActiveClassId] = useState<string>("");
  const [date, setDate] = useState<string>(todayId);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [selectedRow, setSelectedRow] = useState<AttendanceRow | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const q = new URLSearchParams({
        ...(activeClassId ? { class_id: activeClassId } : {}),
        date,
        search,
        status: statusFilter,
        page: String(page),
        limit: String(limit),
      });
      const res = await fetch(`/api/attendance?${q.toString()}`);
      if (!res.ok) throw new Error("Gagal mengambil data");
      const d = (await res.json()) as {
        classes?: ClassOption[];
        class_id?: string;
        totalPages?: number;
        rows?: {
          id: string;
          time: string;
          student_id: string;
          full_name: string;
          class_name: string;
          face_confidence: number | null;
          fingerprint_slot: number | null;
          status: string;
        }[];
        total?: number;
      };
      if (d.classes?.length) setClasses(d.classes);
      if (!activeClassId && d.class_id) setActiveClassId(d.class_id);
      setRows(
        (d.rows ?? []).map((r) => ({
          id: r.id,
          time: r.time.includes("T") ? (r.time.split("T")[1]?.slice(0, 12) ?? r.time) : r.time,
          student_id: r.student_id,
          full_name: r.full_name,
          class_name: r.class_name,
          face_confidence: r.face_confidence,
          fingerprint_slot: r.fingerprint_slot,
          status: (r.status.charAt(0).toUpperCase() + r.status.slice(1)) as AttendanceRow["status"],
        }))
      );
      setTotalCount(d.total ?? 0);
      setTotalPages(Math.max(1, d.totalPages ?? 1));
    } catch (err: unknown) {
      setRows([]);
      setTotalCount(0);
      setTotalPages(1);
      setLoadError(err instanceof Error ? err.message : "Gagal mengambil data");
    } finally {
      setLoading(false);
    }
  }, [activeClassId, date, search, statusFilter, page, limit]);


  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.student_id.toLowerCase().includes(q) ||
        r.full_name.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const exportCSV = () => {
    const headers = [
      "ID Transaksi",
      "Waktu",
      "NIS/ID",
      "Nama Lengkap",
      "Kelas",
      "Face Conf",
      "Fingerprint Slot",
      "Status",
    ];
    const csvContent = [
      headers.join(","),
      ...filteredRows.map((r) =>
        [
          r.id,
          r.time,
          r.student_id,
          `"${r.full_name}"`,
          `"${r.class_name}"`,
          r.face_confidence ?? "-",
          r.fingerprint_slot ?? "-",
          r.status,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `attendance-${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex min-h-screen bg-[#F6F8FA]">
      <Sidebar active="Attendance" />

      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar
          classes={classes}
          activeClassId={activeClassId}
          onClassChange={(id) => setActiveClassId(id)}
          realtimeLive={true}
          onRefresh={loadData}
          refreshing={loading}
          pageTitle="Attendance"
        />

        <main className="p-6 space-y-4 w-full flex-1">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[280px]">
              <Search className="w-4 h-4 text-aici-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Cari NIS, Nama, atau Session ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-aici-surface border border-aici-border rounded-xl text-xs font-medium text-aici-dark placeholder:text-aici-muted outline-none focus:border-aici-dark transition-colors"
              />
            </div>

            {/* Class Dropdown */}
            <div className="relative">
              <select
                value={activeClassId}
                onChange={(e) => setActiveClassId(e.target.value)}
                className="appearance-none bg-aici-surface border border-aici-border rounded-xl px-4 py-2 pr-8 text-xs font-semibold text-aici-dark cursor-pointer outline-none hover:bg-aici-surface-nested"
              >
                {classes.map((c) => (
                  <option key={c.class_id} value={c.class_id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-aici-muted">
                ▾
              </span>
            </div>
            {/* Status Dropdown */}
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="appearance-none bg-aici-surface border border-aici-border rounded-xl px-4 py-2 pr-8 text-xs font-semibold text-aici-dark cursor-pointer outline-none hover:bg-aici-surface-nested"
              >
                <option value="all">Semua Status</option>
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="failed">Failed</option>
                <option value="expired">Expired</option>
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-aici-muted">
                ▾
              </span>
            </div>

            {/* Date Picker */}
            <label className="flex items-center gap-2 bg-aici-surface border border-aici-border rounded-xl px-4 py-2 text-xs font-semibold text-aici-dark cursor-pointer hover:bg-aici-surface-nested">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent text-xs font-semibold outline-none cursor-pointer"
              />
            </label>

            {/* Export CSV Button */}
            <button
              onClick={exportCSV}
              className="flex items-center gap-2 bg-aici-surface border border-aici-border rounded-xl px-4 py-2 text-xs font-semibold text-aici-dark hover:bg-aici-surface-nested transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            {/* Manual Correction Button */}
            <button
              disabled
              title="Fitur dalam rencana implementasi"
              className="flex items-center gap-2 bg-aici-surface/60 border border-aici-border text-aici-muted rounded-xl px-4 py-2 text-xs font-medium cursor-not-allowed"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Koreksi Manual [Planned]</span>
            </button>
          </div>

          {/* Table Card */}
          <div className="bg-aici-surface rounded-2xl border border-aici-border/60 shadow-sm p-6 flex flex-col">
            {/* Card Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-base font-bold text-aici-dark">
                    Tabel Catatan Kehadiran 2FA
                  </h1>
                </div>
                <p className="text-xs text-aici-muted mt-1">
                  Data real-time pipeline Edge PC FastAPI + Sensor Sidik Jari ESP32 R503
                </p>
              </div>

              <div className="text-xs text-aici-muted">
                Menampilkan{" "}
                <span className="font-semibold text-aici-dark">
                  {filteredRows.length}
                </span>{" "}
                dari{" "}
                <span className="font-semibold text-aici-dark">{totalCount}</span>{" "}
                log sesi hari ini
              </div>
            </div>
            {loadError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center justify-between gap-3">
                <span>{loadError}</span>
                <button
                  onClick={loadData}
                  className="px-3 py-1 rounded-lg bg-rose-600 text-white font-semibold hover:bg-rose-700"
                >
                  Coba lagi
                </button>
              </div>
            )}
            {!loading && !loadError && filteredRows.length === 0 && (
              <div className="py-12 flex flex-col items-center justify-center text-center text-aici-muted gap-2">
                <ScanFace className="w-10 h-10 text-aici-muted stroke-[1.5]" />
                <p className="text-sm font-bold text-aici-dark">Belum ada catatan pada {date}</p>
                <p className="text-[11px] max-w-xs">
                  Belum ada hasil verifikasi 2FA hari ini. Ubah tanggal/filter atau lakukan scan di halaman Check-in.
                </p>
              </div>
            )}

            {/* Mobile Card List (< md) */}
            <div className="md:hidden divide-y divide-aici-border/50">
              {filteredRows.map((row, idx) => {
                const isFirst = idx === 0;
                return (
                  <div key={row.id} className="py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            row.is_live ? "bg-[#2563EB]" : "bg-aici-border"
                          }`}
                        />
                        <span className="font-mono text-xs font-bold text-[#1E3A8A]">
                          {row.id}
                        </span>
                        <span className="font-mono text-[11px] text-aici-muted">
                          • {row.time}
                        </span>
                      </div>
                      {row.status === "Present" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#DCFCE7] text-[#15803D]">
                          Present
                        </span>
                      )}
                      {row.status === "Late" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FEF3C7] text-[#B45309]">
                          Late
                        </span>
                      )}
                      {row.status === "Pending" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E0E7FF] text-[#4338CA]">
                          {row.status_label ?? "Pending"}
                        </span>
                      )}
                      {row.status === "Failed" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FEE2E2] text-[#B91C1C]">
                          Failed
                        </span>
                      )}
                      {row.status === "Expired" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F3F4F6] text-[#4B5563]">
                          Expired
                        </span>
                      )}
                      {row.status === "Absent" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E2E8F0] text-[#475569]">
                          Absent
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline justify-between">
                      <div>
                        <p className="text-xs font-semibold text-aici-dark">
                          {row.full_name}
                        </p>
                        <p className="font-mono text-[10px] text-aici-muted">
                          NIS: {row.student_id} • {row.class_name}
                        </p>
                      </div>
                      <button
                        onClick={() => setSelectedRow(row)}
                        className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg ${
                          isFirst
                            ? "bg-[#1E293B] text-white"
                            : "border border-aici-border text-aici-muted"
                        }`}
                      >
                        <span>Detail</span>
                        {isFirst ? (
                          <ExternalLink className="w-3 h-3" />
                        ) : (
                          <ChevronRightIcon className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-mono">
                      <span className="text-aici-muted">Wajah:</span>
                      {row.face_confidence !== null ? (
                        <span className="text-[#16A34A] font-semibold">
                          ✓ {row.face_confidence.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-aici-muted">—</span>
                      )}
                      <span className="text-aici-muted ml-2">Jari:</span>
                      {row.fingerprint_label ? (
                        <span className="text-aici-muted">
                          {row.fingerprint_label}
                        </span>
                      ) : row.fingerprint_slot !== null ? (
                        <span className="text-[#16A34A] font-semibold">
                          #{String(row.fingerprint_slot).padStart(2, "0")}
                        </span>
                      ) : (
                        <span className="text-aici-muted">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop / Tablet Table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-aici-border text-[11px] font-semibold text-aici-muted uppercase tracking-wider">
                    <th className="py-3 px-3">ID Transaksi</th>
                    <th className="py-3 px-3">Waktu</th>
                    <th className="py-3 px-3">NIS / ID</th>
                    <th className="py-3 px-3">Nama Lengkap</th>
                    <th className="py-3 px-3">Kelas</th>
                    <th className="py-3 px-3">Wajah (YuNet)</th>
                    <th className="py-3 px-3">Fingerprint</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-aici-border/40 font-medium">
                  {filteredRows.map((row, idx) => {
                    const isFirst = idx === 0;
                    return (
                      <tr
                        key={row.id}
                        className="hover:bg-aici-surface-nested/50 transition-colors"
                      >
                        {/* ID Transaksi */}
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                row.is_live
                                  ? "bg-[#2563EB]"
                                  : "bg-transparent"
                              }`}
                            />
                            <span className="font-mono text-[11px] font-semibold text-[#1E3A8A]">
                              {row.id}
                            </span>
                          </div>
                        </td>

                        {/* Waktu */}
                        <td className="py-3.5 px-3 font-mono text-[11px] text-aici-muted">
                          {row.time}
                        </td>

                        {/* NIS / ID */}
                        <td className="py-3.5 px-3 font-mono text-[11px] font-bold text-aici-dark">
                          {row.student_id}
                        </td>

                        {/* Nama Lengkap */}
                        <td className="py-3.5 px-3 font-semibold text-aici-dark">
                          {row.full_name}
                        </td>

                        {/* Kelas */}
                        <td className="py-3.5 px-3 text-aici-muted">
                          {row.class_name}
                        </td>

                        {/* Wajah (YuNet) */}
                        <td className="py-3.5 px-3">
                          {row.face_confidence !== null ? (
                            row.face_confidence >= 0.7 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#E8F8EE] text-[#16A34A]">
                                <CheckCircle2 className="w-3 h-3" />
                                {row.face_confidence.toFixed(2)}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEECEC] text-[#DC2626]">
                                <XCircle className="w-3 h-3" />
                                {row.face_confidence.toFixed(2)}
                              </span>
                            )
                          ) : (
                            <span className="text-aici-muted">—</span>
                          )}
                        </td>

                        {/* Fingerprint */}
                        <td className="py-3.5 px-3">
                          {row.fingerprint_label ? (
                            row.fingerprint_label.includes("Menunggu") ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#EFF6FF] text-[#2563EB]">
                                <Fingerprint className="w-3 h-3" />
                                {row.fingerprint_label}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F3F4F6] text-aici-muted">
                                <Clock className="w-3 h-3" />
                                {row.fingerprint_label}
                              </span>
                            )
                          ) : row.fingerprint_slot !== null ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#E8F8EE] text-[#16A34A]">
                              <Fingerprint className="w-3 h-3" />#
                              {String(row.fingerprint_slot).padStart(2, "0")}
                            </span>
                          ) : (
                            <span className="text-aici-muted">—</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-3">
                          {row.status === "Present" && (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#DCFCE7] text-[#15803D]">
                              Present
                            </span>
                          )}
                          {row.status === "Late" && (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FEF3C7] text-[#B45309]">
                              Late
                            </span>
                          )}
                          {row.status === "Pending" && (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#E0E7FF] text-[#4338CA]">
                              {row.status_label ?? "Pending"}
                            </span>
                          )}
                          {row.status === "Failed" && (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FEE2E2] text-[#B91C1C]">
                              Failed
                            </span>
                          )}
                          {row.status === "Expired" && (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#F3F4F6] text-[#4B5563]">
                              Expired
                            </span>
                          )}
                          {row.status === "Absent" && (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#E2E8F0] text-[#475569]">
                              Absent
                            </span>
                          )}
                        </td>

                        {/* Aksi */}
                        <td className="py-3.5 px-3 text-right">
                          <button
                            onClick={() => setSelectedRow(row)}
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                              isFirst
                                ? "bg-[#1E293B] text-white hover:bg-black"
                                : "text-aici-muted hover:text-aici-dark border border-aici-border/60 hover:bg-aici-surface-nested"
                            }`}
                          >
                            <span>Detail</span>
                            {isFirst ? (
                              <ExternalLink className="w-3 h-3" />
                            ) : (
                              <ChevronRightIcon className="w-3 h-3" />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-5 mt-auto border-t border-aici-border/60 text-xs text-aici-muted">
              <div className="flex items-center gap-2">
                <span>Baris per halaman:</span>
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                  className="bg-aici-surface-nested border border-aici-border rounded-lg px-2.5 py-1 font-semibold text-aici-dark outline-none cursor-pointer"
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                </select>
              </div>

              <div className="flex items-center gap-1 font-medium">
                <span>Halaman {page} dari {totalPages}</span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(1)}
                  aria-label="Halaman awal"
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-aici-border hover:bg-aici-surface-nested disabled:opacity-40"
                >
                  <ChevronsLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Halaman sebelumnya"
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-aici-border hover:bg-aici-surface-nested disabled:opacity-40"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                <span className="px-2 py-1 text-xs font-semibold text-aici-dark">
                  {page} / {totalPages}
                </span>

                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Halaman berikutnya"
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-aici-border hover:bg-aici-surface-nested disabled:opacity-40"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(totalPages)}
                  aria-label="Halaman akhir"
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-aici-border hover:bg-aici-surface-nested disabled:opacity-40"
                >
                  <ChevronsRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Modal Detail Pipeline 2FA per Sesi (PRD Menu 2 §2.3) */}
      {selectedRow && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-aici-surface rounded-2xl shadow-xl border border-aici-border max-w-lg w-full p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-mono text-aici-muted">
                  Inspeksi Pipeline Biometrik 2FA
                </p>
                <h3 className="text-base font-bold text-aici-dark flex items-center gap-2 mt-0.5">
                  Sesi: {selectedRow.id}
                  <span className="text-xs font-mono font-normal text-aici-muted">
                    ({selectedRow.student_id})
                  </span>
                </h3>
              </div>
              <button
                onClick={() => setSelectedRow(null)}
                className="w-7 h-7 rounded-lg hover:bg-aici-surface-nested flex items-center justify-center text-aici-muted hover:text-aici-dark"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-aici-surface-nested rounded-xl space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-aici-muted">Nama Siswa:</span>
                <span className="font-semibold text-aici-dark">
                  {selectedRow.full_name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-aici-muted">Kelas:</span>
                <span className="font-medium">{selectedRow.class_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-aici-muted">Waktu Check-in:</span>
                <span className="font-mono">{selectedRow.time}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-aici-muted">Status Final:</span>
                <span className="font-bold text-aici-dark">
                  {selectedRow.status}
                </span>
              </div>
            </div>

            {/* 6 Steps Timeline */}
            <div className="space-y-3 pt-2">
              <p className="text-xs font-semibold text-aici-dark uppercase tracking-wider">
                Alur Verifikasi Hardware 2FA
              </p>

              <div className="space-y-2 text-xs">
                {/* Step 1 */}
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#E8F8EE] text-[#16A34A] flex items-center justify-center shrink-0 mt-0.5">
                    <ScanFace className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <p className="font-semibold text-aici-dark">
                        1. Wajah Terdeteksi (YuNet)
                      </p>
                      <span className="text-[10px] text-aici-muted font-mono">
                        Lokal PC
                      </span>
                    </div>
                    <p className="text-[11px] text-aici-muted">
                      Bounding box valid, cropping ROI wajah selesai.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#E8F8EE] text-[#16A34A] flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <p className="font-semibold text-aici-dark">
                        2. Identifikasi SFace
                      </p>
                      <span className="text-[10px] font-mono text-[#16A34A] font-bold">
                        Score: {selectedRow.face_confidence ?? "—"}
                      </span>
                    </div>
                    <p className="text-[11px] text-aici-muted">
                      Kandidat: {selectedRow.student_id} ({selectedRow.full_name})
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center shrink-0 mt-0.5">
                    <Radio className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <p className="font-semibold text-aici-dark">
                        3. Perintah Serial USB ke ESP32
                      </p>
                      <span className="text-[10px] text-aici-muted font-mono">
                        COM / USB Serial
                      </span>
                    </div>
                    <p className="text-[11px] text-aici-muted">
                      Perintah <code>VERIFY:slot</code> dikirim ke sensor R503.
                    </p>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="flex items-start gap-3">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      selectedRow.fingerprint_slot !== null
                        ? "bg-[#E8F8EE] text-[#16A34A]"
                        : "bg-[#F3F4F6] text-aici-muted"
                    }`}
                  >
                    <Fingerprint className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <p className="font-semibold text-aici-dark">
                        4. Verifikasi Sidik Jari (R503)
                      </p>
                      <span className="text-[10px] font-mono font-bold">
                        {selectedRow.fingerprint_slot !== null
                          ? `Slot #${selectedRow.fingerprint_slot}`
                          : selectedRow.fingerprint_label ?? "N/A"}
                      </span>
                    </div>
                    <p className="text-[11px] text-aici-muted">
                      Respons pencocokan sensor hardware.
                    </p>
                  </div>
                </div>

                {/* Step 5 */}
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#E8F8EE] text-[#16A34A] flex items-center justify-center shrink-0 mt-0.5">
                    <Database className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <p className="font-semibold text-aici-dark">
                        5. Commit ke PostgreSQL Supabase
                      </p>
                      <span className="text-[10px] text-aici-muted font-mono">
                        POST /api/attendance
                      </span>
                    </div>
                    <p className="text-[11px] text-aici-muted">
                      1 record final 2FA disimpan, memicu broadcast Realtime.
                    </p>
                  </div>
                </div>

                {/* Step 6 */}
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-aici-lime text-aici-dark flex items-center justify-center shrink-0 mt-0.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <p className="font-semibold text-aici-dark">
                        6. Status Final: {selectedRow.status}
                      </p>
                      <span className="text-[10px] font-mono text-aici-muted">
                        OK
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedRow(null)}
                className="px-4 py-2 bg-[#1E293B] text-white rounded-xl text-xs font-semibold hover:bg-black transition-colors"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
