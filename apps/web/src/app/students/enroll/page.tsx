"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Trash2,
  ArrowLeft,
  ScanFace,
  Layers,
  Sparkles,
} from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import type { ClassOption } from "@/lib/overview";

const SAMPLES_GUIDE = [
  { id: 1, label: "Lurus (Center)", hint: "Hadap kamera lurus, ekspresi netral" },
  { id: 2, label: "Kiri 30°", hint: "Putar kepala sedikit ke kiri" },
  { id: 3, label: "Kanan 30°", hint: "Putar kepala sedikit ke kanan" },
  { id: 4, label: "Mundur (±1 m)", hint: "Jarak sedikit lebih jauh dari kamera" },
  { id: 5, label: "Senyum / Netral", hint: "Variasi ekspresi wajar sehari-hari" },
];

export default function StudentFaceEnrollPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [streamActive, setStreamActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [classes] = useState<ClassOption[]>([
    { class_id: "ai-eng-b3", name: "AI Engineering Batch 3" },
    { class_id: "XII-RPL-1", name: "XII RPL 1" },
  ]);
  const [activeClassId, setActiveClassId] = useState<string>("ai-eng-b3");

  const [studentId, setStudentId] = useState("");
  const [fullName, setFullName] = useState("");

  const [samples, setSamples] = useState<{ [slot: number]: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const [serviceOnline, setServiceOnline] = useState<boolean | null>(null);

  // Cek konektivitas face service lokal
  const checkService = useCallback(async () => {
    try {
      const res = await fetch("/api/face/health", { cache: "no-store" });
      setServiceOnline(res.ok);
    } catch {
      setServiceOnline(false);
    }
  }, []);

  useEffect(() => {
    checkService();
  }, [checkService]);

  // Start webcam
  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreamActive(true);
    } catch (err: unknown) {
      setStreamActive(false);
      setCameraError(
        err instanceof Error
          ? err.message
          : "Gagal membuka kamera. Periksa izin akses webcam."
      );
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const s = videoRef.current.srcObject as MediaStream;
      s.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  // Ambil 1 sampel frame ke slot berikutnya yang kosong
  const captureSample = (targetSlot?: number) => {
    if (!videoRef.current || !streamActive) return;
    const v = videoRef.current;
    if (v.videoWidth === 0 || v.videoHeight === 0) return;

    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const b64 = canvas.toDataURL("image/jpeg", 0.9);

    // Cari slot target
    let slot = targetSlot;
    if (!slot) {
      for (const g of SAMPLES_GUIDE) {
        if (!samples[g.id]) {
          slot = g.id;
          break;
        }
      }
    }
    if (!slot) slot = 1; // overwrite slot 1 jika penuh

    setSamples((prev) => ({ ...prev, [slot!]: b64 }));
    setFeedback({
      type: "info",
      message: `Sampel ${slot} (${SAMPLES_GUIDE.find((g) => g.id === slot)?.label}) berhasil diambil.`,
    });
  };

  const deleteSample = (slot: number) => {
    setSamples((prev) => {
      const copy = { ...prev };
      delete copy[slot];
      return copy;
    });
  };

  // Submit enrollment ke backend FastAPI
  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = studentId.trim();
    if (!cleanId) {
      setFeedback({
        type: "error",
        message: "Student ID / NIS wajib diisi.",
      });
      return;
    }
    const sampleList = Object.values(samples);
    if (sampleList.length === 0) {
      setFeedback({
        type: "error",
        message: "Ambil minimal 1 sampel wajah (disarankan 5).",
      });
      return;
    }

    setSubmitting(true);
    setFeedback({
      type: "info",
      message: "Mengekstrak embedding SFace & menyimpan ke database...",
    });

    try {
      const res = await fetch("/api/face/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          student_id: cleanId,
          images_base64: sampleList,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setFeedback({
        type: "success",
        message: `Wajah ${cleanId} berhasil didaftarkan! (${data.samples_used ?? sampleList.length} sampel diproses, total database: ${data.total_registered ?? "?"} wajah).`,
      });
      // Reset form
      setSamples({});
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal mendaftarkan wajah ke service.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const sampleCount = Object.keys(samples).length;

  return (
    <div className="flex min-h-screen bg-[#F6F8FA]">
      <Sidebar active="Students" />

      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar
          classes={classes}
          activeClassId={activeClassId}
          onClassChange={(id) => setActiveClassId(id)}
          realtimeLive={true}
          onRefresh={checkService}
          refreshing={false}
          pageTitle="Students"
        />

        <main className="p-4 md:p-6 space-y-4 max-w-6xl w-full mx-auto flex-1">
          {/* Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-aici-surface p-4 rounded-2xl border border-aici-border/60 shadow-sm">
            <div className="flex items-center gap-3">
              <Link
                href="/attendance"
                className="p-2 rounded-xl border border-aici-border hover:bg-aici-surface-nested text-aici-muted hover:text-aici-dark transition-colors"
                title="Kembali ke Dashboard"
              >
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-bold text-aici-dark">
                    Enrollment Wajah Siswa
                  </h1>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                    AREA ADMIN
                  </span>
                </div>
                <p className="text-xs text-aici-muted mt-0.5">
                  Pengambilan 5 sampel sudut wajah untuk pembentukan vektor embedding stabil (PRD §3).
                </p>
              </div>
            </div>

            {/* Status backend badge */}
            <div className="flex items-center gap-2 text-xs">
              {serviceOnline ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Service FastAPI :8200 Siap
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-semibold text-[11px]">
                  <AlertCircle className="w-3.5 h-3.5" />
                  FastAPI Offline (:8200)
                </span>
              )}
              <button
                onClick={checkService}
                className="p-1.5 rounded-lg border border-aici-border hover:bg-aici-surface-nested text-aici-muted"
                title="Cek ulang service"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Feedback Banner */}
          {feedback && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                feedback.type === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : feedback.type === "error"
                  ? "bg-rose-50 border-rose-200 text-rose-800"
                  : "bg-blue-50 border-blue-200 text-blue-800"
              }`}
            >
              {feedback.type === "success" && (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
              )}
              {feedback.type === "error" && (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              )}
              {feedback.type === "info" && (
                <Sparkles className="w-4 h-4 shrink-0 text-blue-600 mt-0.5" />
              )}
              <span className="flex-1 font-medium leading-relaxed">
                {feedback.message}
              </span>
            </div>
          )}

          {/* Grid Konten: Kamera (Kiri) + Form & Slot Sampel (Kanan) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Kolom Kiri: Kamera Operator (6 cols) */}
            <div className="lg:col-span-6 flex flex-col gap-3">
              <div className="bg-aici-surface rounded-2xl border border-aici-border/60 p-4 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between text-xs font-semibold text-aici-dark">
                  <span>Pratinjau Kamera Operator</span>
                  {streamActive && (
                    <span className="text-[11px] font-mono text-emerald-600 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                      640×480
                    </span>
                  )}
                </div>

                {/* Viewport Video */}
                <div className="relative aspect-[4/3] bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center">
                  <video
                    ref={videoRef}
                    playsInline
                    autoPlay
                    muted
                    className={`w-full h-full object-cover ${
                      streamActive ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <canvas ref={canvasRef} className="hidden" />

                  {/* Placeholder saat kamera mati */}
                  {!streamActive && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-4 text-center text-slate-400">
                      <CameraOff className="w-8 h-8 text-slate-500" />
                      <p className="text-xs font-medium text-slate-300">
                        Kamera operator belum aktif
                      </p>
                      <button
                        onClick={startCamera}
                        className="mt-1 px-4 py-2 rounded-xl bg-aici-dark text-white text-xs font-semibold hover:bg-black transition-colors"
                      >
                        Nyalakan Kamera
                      </button>
                      {cameraError && (
                        <p className="text-[11px] text-rose-400 mt-1 max-w-xs">
                          {cameraError}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Reticle Oval Wajah */}
                  {streamActive && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="w-48 h-64 rounded-[50%] border-2 border-dashed border-white/60 shadow-[0_0_20px_rgba(255,255,255,0.2)] flex items-center justify-center">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-black/60 text-white/90">
                          Posisikan Wajah di Oval
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Toolbar Kamera */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  {streamActive ? (
                    <>
                      <button
                        onClick={() => captureSample()}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-aici-dark hover:bg-black text-white text-xs font-bold shadow-sm transition-transform active:scale-95"
                      >
                        <Camera className="w-4 h-4" />
                        <span>Ambil Sampel Berikutnya</span>
                      </button>
                      <button
                        onClick={stopCamera}
                        className="px-3 py-2.5 rounded-xl border border-aici-border hover:bg-aici-surface-nested text-xs font-semibold text-rose-600"
                      >
                        Matikan
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={startCamera}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-aici-dark hover:bg-black text-white text-xs font-bold shadow-sm"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Nyalakan Kamera</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Petunjuk Pengambilan */}
              <div className="bg-aici-surface rounded-2xl border border-aici-border/60 p-4 shadow-sm text-xs text-aici-muted space-y-1.5">
                <p className="font-semibold text-aici-dark">
                  Pedoman Akurasi (Hasil Uji 2026-10-21):
                </p>
                <ul className="list-disc list-inside space-y-1 text-[11px]">
                  <li>Cahaya depan merata — hindari lampu tepat di belakang siswa.</li>
                  <li>Ambil 5 sudut berbeda (lurus, serong kiri, serong kanan, mundur, netral).</li>
                  <li>Wajah memenuhi ~1/3 layar tanpa masker atau kacamata hitam.</li>
                  <li>Sistem merata-ratakan 5 embedding menjadi 1 vektor stabil (L2-normalized).</li>
                </ul>
              </div>
            </div>

            {/* Kolom Kanan: Form Data Siswa & Slot 5 Sampel (6 cols) */}
            <div className="lg:col-span-6 flex flex-col gap-4">
              <form
                onSubmit={handleEnroll}
                className="bg-aici-surface rounded-2xl border border-aici-border/60 p-5 shadow-sm space-y-4"
              >
                <div>
                  <h2 className="text-sm font-bold text-aici-dark">
                    Identitas Siswa yang Didaftarkan
                  </h2>
                  <p className="text-xs text-aici-muted mt-0.5">
                    Data induk siswa yang diasosiasikan ke embedding SFace.
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-aici-dark mb-1">
                      Student ID / NIS <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Contoh: AICI-2026-001 atau dandi"
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-aici-surface border border-aici-border rounded-xl text-xs font-mono font-medium text-aici-dark placeholder:text-aici-muted outline-none focus:border-aici-dark transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-aici-dark mb-1">
                      Nama Lengkap (Opsional)
                    </label>
                    <input
                      type="text"
                      placeholder="Nama lengkap siswa"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full px-3 py-2 bg-aici-surface border border-aici-border rounded-xl text-xs font-medium text-aici-dark placeholder:text-aici-muted outline-none focus:border-aici-dark transition-colors"
                    />
                  </div>
                </div>

                {/* 5 Slot Sampel Grid */}
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-aici-dark">
                      Sampel Sudut Wajah ({sampleCount}/5)
                    </span>
                    <span className="text-[11px] text-aici-muted">
                      {sampleCount >= 3 ? "✓ Siap Disimpan" : "Min. 3 sampel"}
                    </span>
                  </div>

                  <div className="grid grid-cols-5 gap-2">
                    {SAMPLES_GUIDE.map((g) => {
                      const img = samples[g.id];
                      return (
                        <div
                          key={g.id}
                          className={`relative aspect-square rounded-xl border flex flex-col items-center justify-center overflow-hidden transition-all ${
                            img
                              ? "border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-50"
                              : "border-dashed border-aici-border bg-aici-surface-nested hover:border-aici-dark"
                          }`}
                        >
                          {img ? (
                            <>
                              <img
                                src={img}
                                alt={g.label}
                                className="w-full h-full object-cover"
                              />
                              <button
                                type="button"
                                onClick={() => deleteSample(g.id)}
                                className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white hover:bg-rose-600 transition-colors"
                                title="Hapus sampel ini"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                              <span className="absolute bottom-1 inset-x-1 text-[9px] font-bold text-center text-white bg-black/60 rounded px-0.5 truncate">
                                #{g.id} {g.label}
                              </span>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => captureSample(g.id)}
                              disabled={!streamActive}
                              className="w-full h-full flex flex-col items-center justify-center p-1 text-center disabled:opacity-40"
                              title={`Ambil foto ${g.label}`}
                            >
                              <ScanFace className="w-4 h-4 text-aici-muted mb-0.5" />
                              <span className="text-[9px] font-bold text-aici-dark">
                                #{g.id}
                              </span>
                              <span className="text-[8px] text-aici-muted leading-tight truncate w-full">
                                {g.label}
                              </span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Tombol Simpan Enrollment */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={submitting || sampleCount === 0 || !studentId.trim()}
                    className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-aici-dark hover:bg-black text-white text-xs font-bold shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Layers className="w-4 h-4" />
                    <span>
                      {submitting
                        ? "Memproses SFace Embedding..."
                        : `Simpan Enrollment (${sampleCount} Sampel)`}
                    </span>
                  </button>
                </div>
              </form>

              {/* Link ke Stasiun Scan Siswa */}
              <div className="p-4 bg-aici-surface rounded-2xl border border-aici-border/60 flex items-center justify-between text-xs">
                <div>
                  <p className="font-semibold text-aici-dark">
                    Stasiun Kamera Siswa (Kiosk)
                  </p>
                  <p className="text-[11px] text-aici-muted">
                    Buka antarmuka verifikasi mandiri tanpa hak akses admin.
                  </p>
                </div>
                <Link
                  href="/camera"
                  target="_blank"
                  className="px-3 py-1.5 rounded-lg border border-aici-border hover:bg-aici-surface-nested text-xs font-semibold text-aici-dark"
                >
                  Buka /camera ↗
                </Link>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
