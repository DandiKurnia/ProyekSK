"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  UserPlus,
  ScanFace,
  Fingerprint,
  CheckCircle2,
  Clock,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import type { ClassOption } from "@/lib/overview";

interface StudentItem {
  student_id: string;
  full_name: string;
  class_id: string;
  class_name: string;
  face_status: "enrolled" | "not_enrolled" | "pending";
  fingerprint_status: "enrolled" | "not_enrolled" | "pending";
  fingerprint_slot: number | null;
  is_active: boolean;
}

export default function StudentsPage() {
  const [classes, setClasses] = useState<ClassOption[]>([
    { class_id: "XII-RPL-1", name: "XII RPL 1" },
  ]);
  const [activeClassId, setActiveClassId] = useState<string>("XII-RPL-1");
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "enrolled" | "not_enrolled">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newGender, setNewGender] = useState<"L" | "P">("L");
  const [newContact, setNewContact] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedStudent, setSavedStudent] = useState<{ student_id: string; full_name: string } | null>(null);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/students?class_id=${activeClassId}`);
      if (!res.ok) throw new Error("Gagal mengambil data siswa");
      const data = await res.json();
      setStudents(data.students ?? []);
    } catch {
      // Fallback data awal jika offline / kosong
      setStudents([
        {
          student_id: "S001",
          full_name: "Ahmad Rizky Pratama",
          class_id: "XII-RPL-1",
          class_name: "XII RPL 1",
          face_status: "enrolled",
          fingerprint_status: "enrolled",
          fingerprint_slot: 1,
          is_active: true,
        },
        {
          student_id: "S002",
          full_name: "Siti Nurhaliza",
          class_id: "XII-RPL-1",
          class_name: "XII RPL 1",
          face_status: "not_enrolled",
          fingerprint_status: "not_enrolled",
          fingerprint_slot: null,
          is_active: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [activeClassId]);

  const handleAddStudent = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId.trim() || !newName.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          student_id: newId.trim(),
          full_name: newName.trim(),
          class_id: activeClassId,
          gender: newGender,
          guardian_contact: newContact.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan siswa");
      setSavedStudent({ student_id: data.student_id, full_name: newName.trim() });
      setNewId("");
      setNewName("");
      setNewContact("");
      await loadStudents();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [newId, newName, newGender, newContact, activeClassId, loadStudents]);


  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      const matchQuery =
        !q ||
        s.student_id.toLowerCase().includes(q) ||
        s.full_name.toLowerCase().includes(q);
      const matchStatus =
        statusFilter === "all"
          ? true
          : statusFilter === "enrolled"
          ? s.face_status === "enrolled" && s.fingerprint_status === "enrolled"
          : s.face_status !== "enrolled" || s.fingerprint_status !== "enrolled";
      return matchQuery && matchStatus;
    });
  }, [students, search, statusFilter]);

  const stats = useMemo(() => {
    const total = students.length;
    const faceComplete = students.filter((s) => s.face_status === "enrolled").length;
    const fpComplete = students.filter((s) => s.fingerprint_status === "enrolled").length;
    const fullyEnrolled = students.filter(
      (s) => s.face_status === "enrolled" && s.fingerprint_status === "enrolled"
    ).length;
    return { total, faceComplete, fpComplete, fullyEnrolled };
  }, [students]);

  return (
    <>
      <div className="flex min-h-screen">
      <Sidebar active="Students" />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          pageTitle="Students"
          classes={classes}
          activeClassId={activeClassId}
          onClassChange={setActiveClassId}
          realtimeLive={true}
          refreshing={loading}
          onRefresh={loadStudents}
        />

        <main className="p-4 md:p-6 space-y-5 max-w-[1400px]">
          {/* Header Bar + Tombol Add Siswa di Atas */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-aici-dark">
                Daftar Induk Siswa & Enrollment 2FA
              </h1>
              <p className="text-xs text-aici-muted mt-0.5">
                Kelola status biometrik wajah (YuNet + SFace) dan sidik jari (ESP32 R503).
              </p>
            </div>

            <button
              onClick={() => { setShowAdd(true); setSavedStudent(null); setSaveError(null); }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-aici-dark hover:bg-black text-white text-xs font-bold shadow-sm transition-transform active:scale-95"
            >
              <UserPlus className="w-4 h-4 text-aici-lime" />
              <span>Tambah Siswa</span>
            </button>
          </div>

          {/* Quick KPI Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3.5 bg-aici-surface rounded-xl border border-aici-border/60">
              <span className="text-[11px] font-semibold text-aici-muted">Total Siswa</span>
              <p className="text-xl font-bold font-mono text-aici-dark mt-0.5">{stats.total}</p>
            </div>
            <div className="p-3.5 bg-aici-surface rounded-xl border border-aici-border/60">
              <span className="text-[11px] font-semibold text-aici-muted">Wajah Terdaftar</span>
              <p className="text-xl font-bold font-mono text-emerald-600 mt-0.5">
                {stats.faceComplete} <span className="text-xs text-aici-muted font-normal">/ {stats.total}</span>
              </p>
            </div>
            <div className="p-3.5 bg-aici-surface rounded-xl border border-aici-border/60">
              <span className="text-[11px] font-semibold text-aici-muted">Sidik Jari Terdaftar</span>
              <p className="text-xl font-bold font-mono text-blue-600 mt-0.5">
                {stats.fpComplete} <span className="text-xs text-aici-muted font-normal">/ {stats.total}</span>
              </p>
            </div>
            <div className="p-3.5 bg-aici-surface rounded-xl border border-aici-border/60">
              <span className="text-[11px] font-semibold text-aici-muted">2FA Lengkap</span>
              <p className="text-xl font-bold font-mono text-aici-dark mt-0.5">
                {stats.fullyEnrolled}{" "}
                <span className="text-[11px] text-emerald-600 font-semibold">
                  ({stats.total > 0 ? Math.round((stats.fullyEnrolled / stats.total) * 100) : 0}%)
                </span>
              </p>
            </div>
          </div>

          {/* Table Container Card */}
          <div className="bg-aici-surface rounded-2xl border border-aici-border/60 shadow-sm p-4 md:p-6 space-y-4">
            {/* Filter & Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[240px] max-w-md">
                <Search className="w-3.5 h-3.5 text-aici-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Cari berdasarkan nama atau NIS / ID siswa..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-aici-surface-nested border border-aici-border rounded-xl text-xs text-aici-dark outline-none focus:border-aici-dark transition-colors"
                />
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <button
                  onClick={() => setStatusFilter("all")}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    statusFilter === "all"
                      ? "bg-aici-dark text-white"
                      : "text-aici-muted hover:text-aici-dark hover:bg-aici-surface-nested"
                  }`}
                >
                  Semua ({students.length})
                </button>
                <button
                  onClick={() => setStatusFilter("not_enrolled")}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    statusFilter === "not_enrolled"
                      ? "bg-aici-dark text-white"
                      : "text-aici-muted hover:text-aici-dark hover:bg-aici-surface-nested"
                  }`}
                >
                  Butuh Enrollment ({students.length - stats.fullyEnrolled})
                </button>
                <button
                  onClick={() => setStatusFilter("enrolled")}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    statusFilter === "enrolled"
                      ? "bg-aici-dark text-white"
                      : "text-aici-muted hover:text-aici-dark hover:bg-aici-surface-nested"
                  }`}
                >
                  2FA Lengkap ({stats.fullyEnrolled})
                </button>
              </div>
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-aici-border text-[11px] font-bold text-aici-muted uppercase tracking-wider">
                    <th className="py-3 px-3">Siswa</th>
                    <th className="py-3 px-3">NIS / ID</th>
                    <th className="py-3 px-3">Kelas</th>
                    <th className="py-3 px-3 text-center">Wajah (YuNet + SFace)</th>
                    <th className="py-3 px-3 text-center">Sidik Jari (R503)</th>
                    <th className="py-3 px-3 text-center">Status 2FA</th>
                    <th className="py-3 px-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-aici-border/50">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-aici-muted">
                        Tidak ada data siswa yang cocok dengan filter.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((student) => {
                      const isComplete =
                        student.face_status === "enrolled" &&
                        student.fingerprint_status === "enrolled";

                      return (
                        <tr key={student.student_id} className="hover:bg-aici-surface-nested/50 transition-colors">
                          <td className="py-3.5 px-3">
                            <span className="font-semibold text-aici-dark block">
                              {student.full_name}
                            </span>
                          </td>
                          <td className="py-3.5 px-3 font-mono text-aici-muted">
                            {student.student_id}
                          </td>
                          <td className="py-3.5 px-3 text-aici-dark">
                            {student.class_name}
                          </td>
                          <td className="py-3.5 px-3 text-center">
                            {student.face_status === "enrolled" ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3" />
                                Terdaftar (.npz)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                <Clock className="w-3 h-3" />
                                Belum Terdaftar
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-3 text-center">
                            {student.fingerprint_status === "enrolled" && student.fingerprint_slot !== null ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                <Fingerprint className="w-3 h-3" />
                                Slot #{student.fingerprint_slot}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                Belum Ada
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-3 text-center">
                            {isComplete ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                <ShieldCheck className="w-3 h-3" />
                                Siap Absen
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                Belum Lengkap
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-3 text-right">
                            {student.face_status !== "enrolled" ? (
                              <Link
                                href={`/students/enroll?student_id=${encodeURIComponent(student.student_id)}&name=${encodeURIComponent(student.full_name)}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-aici-dark hover:bg-black text-white text-[11px] font-semibold transition-colors"
                              >
                                <ScanFace className="w-3 h-3 text-aici-lime" />
                                <span>Scan Wajah</span>
                              </Link>
                            ) : (
                              <Link
                                href={`/students/enroll?student_id=${encodeURIComponent(student.student_id)}&name=${encodeURIComponent(student.full_name)}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-aici-border text-aici-muted hover:text-aici-dark hover:bg-aici-surface-nested text-[11px] font-semibold transition-colors"
                              >
                                <span>Re-enroll</span>
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View (< md) */}
            <div className="md:hidden divide-y divide-aici-border/50">
              {filtered.map((student) => (
                <div key={student.student_id} className="py-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-aici-dark">{student.full_name}</p>
                      <p className="text-[11px] font-mono text-aici-muted">{student.student_id} • {student.class_name}</p>
                    </div>
                    {student.face_status === "enrolled" && student.fingerprint_status === "enrolled" ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                        2FA Lengkap
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                        Belum Lengkap
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <div className="text-[11px] text-aici-muted">
                      Wajah: {student.face_status === "enrolled" ? "✓" : "✗"} • Jari: {student.fingerprint_status === "enrolled" ? `#${student.fingerprint_slot}` : "✗"}
                    </div>
                    <Link
                      href={`/students/enroll?student_id=${encodeURIComponent(student.student_id)}`}
                      className="inline-flex items-center gap-1 text-xs font-bold text-aici-dark"
                    >
                      <span>Enroll</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
      {/* Modal Tambah Siswa */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !saving && setShowAdd(false)}
          />
          <div className="relative w-full max-w-md bg-aici-surface rounded-2xl border border-aici-border shadow-xl p-6">
            <h2 className="text-sm font-bold text-aici-dark">Tambah Siswa Baru</h2>
            <p className="text-xs text-aici-muted mt-0.5 mb-4">
              Data induk disimpan ke Supabase. Setelah tersimpan, lanjutkan ke Scan Wajah.
            </p>

            {savedStudent ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {savedStudent.full_name} ({savedStudent.student_id}) tersimpan ke database.
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setShowAdd(false)}
                    className="px-4 py-2 rounded-xl border border-aici-border text-aici-muted hover:text-aici-dark text-xs font-semibold transition-colors"
                  >
                    Tutup
                  </button>
                  <Link
                    href={`/students/enroll?student_id=${encodeURIComponent(savedStudent.student_id)}&name=${encodeURIComponent(savedStudent.full_name)}`}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-aici-dark hover:bg-black text-white text-xs font-bold transition-colors"
                  >
                    <ScanFace className="w-4 h-4 text-aici-lime" />
                    <span>Scan Wajah Sekarang</span>
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleAddStudent} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-aici-dark mb-1">
                    NIS / Student ID <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                    required
                    placeholder="Contoh: S003"
                    className="w-full px-3 py-2 bg-aici-surface-nested border border-aici-border rounded-xl text-xs font-mono text-aici-dark outline-none focus:border-aici-dark transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-aici-dark mb-1">
                    Nama Lengkap <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                    placeholder="Nama lengkap siswa"
                    className="w-full px-3 py-2 bg-aici-surface-nested border border-aici-border rounded-xl text-xs text-aici-dark outline-none focus:border-aici-dark transition-colors"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-aici-dark mb-1">Kelas</label>
                    <div className="px-3 py-2 bg-aici-surface-nested border border-aici-border rounded-xl text-xs text-aici-dark">
                      {classes.find((c) => c.class_id === activeClassId)?.name ?? activeClassId}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-aici-dark mb-1">Jenis Kelamin</label>
                    <select
                      value={newGender}
                      onChange={(e) => setNewGender(e.target.value as "L" | "P")}
                      className="w-full px-3 py-2 bg-aici-surface-nested border border-aici-border rounded-xl text-xs text-aici-dark outline-none focus:border-aici-dark"
                    >
                      <option value="L">Laki-laki</option>
                      <option value="P">Perempuan</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-aici-dark mb-1">
                    Kontak Wali (opsional)
                  </label>
                  <input
                    type="text"
                    value={newContact}
                    onChange={(e) => setNewContact(e.target.value)}
                    placeholder="No. HP / email wali"
                    className="w-full px-3 py-2 bg-aici-surface-nested border border-aici-border rounded-xl text-xs text-aici-dark outline-none focus:border-aici-dark transition-colors"
                  />
                </div>
                {saveError && (
                  <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                    {saveError}
                  </p>
                )}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAdd(false)}
                    disabled={saving}
                    className="px-4 py-2 rounded-xl border border-aici-border text-aici-muted hover:text-aici-dark text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !newId.trim() || !newName.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-aici-dark hover:bg-black text-white text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    {saving ? "Menyimpan..." : "Simpan ke Database"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
