"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  CameraOff,
  ScanFace,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Fingerprint,
  ArrowLeft,
  Settings2,
  Activity,
  Zap,
} from "lucide-react";

interface HealthStatus {
  status: "ok" | "offline" | "checking";
  registered_faces?: number;
  students?: string[];
  error?: string;
}

interface RecognizeResult {
  faces_detected: number;
  match: boolean;
  student_id: string | null;
  full_name?: string | null;
  class_id?: string | null;
  confidence: number;
  threshold_used: number;
  reason?: string | null;
  timestamp: string;
}

export default function CameraKioskPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [streamActive, setStreamActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  const [health, setHealth] = useState<HealthStatus>({ status: "checking" });
  const [scanning, setScanning] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [lastResult, setLastResult] = useState<RecognizeResult | null>(null);
  const [minConfidence, setMinConfidence] = useState<number>(0.4);

  // 1. Cek kesehatan backend FastAPI lokal
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/face/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHealth({
        status: data.status === "ok" ? "ok" : "offline",
        registered_faces: data.registered_faces ?? 0,
        students: data.students ?? [],
      });
    } catch (err: unknown) {
      setHealth({
        status: "offline",
        error:
          err instanceof Error
            ? err.message
            : "Service FastAPI lokal belum aktif (:8200)",
      });
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 8000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  // 2. Daftar perangkat video input
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => {
        const vids = all.filter((d) => d.kind === "videoinput");
        setDevices(vids);
        if (vids.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(vids[0].deviceId);
        }
      })
      .catch(() => {});
  }, [selectedDeviceId]);

  // 3. Start / stop webcam stream
  const startCamera = async (deviceId?: string) => {
    setCameraError(null);
    try {
      if (videoRef.current?.srcObject) {
        const prev = videoRef.current.srcObject as MediaStream;
        prev.getTracks().forEach((t) => t.stop());
      }
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: 640, height: 480 }
          : { width: 640, height: 480, facingMode: "user" },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
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
      const prev = videoRef.current.srcObject as MediaStream;
      prev.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
    setAutoScan(false);
  };

  // 4. Capture 1 frame & kirim ke /api/face/recognize
  const captureAndRecognize = useCallback(async () => {
    if (!videoRef.current || !streamActive || scanning) return;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    setScanning(true);
    try {
      // Crop ke area oval (rasio 3:4) + mask elips: piksel di luar oval jadi hitam
      // agar YuNet tidak mendeteksi wajah di luar panduan UI.
      const OVAL_ASPECT = 3 / 4;
      let cw = video.videoWidth;
      let ch = Math.round(cw / OVAL_ASPECT);
      if (ch > video.videoHeight) {
        ch = video.videoHeight;
        cw = Math.round(ch * OVAL_ASPECT);
      }
      const sx = (video.videoWidth - cw) / 2;
      const sy = (video.videoHeight - ch) / 2;

      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cw / 2, ch / 2, cw / 2 - 2, ch / 2 - 2, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(video, sx, sy, cw, ch, 0, 0, cw, ch);
      ctx.restore();
      const base64 = canvas.toDataURL("image/jpeg", 0.85);

      const res = await fetch("/api/face/recognize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image_base64: base64,
          min_confidence: minConfidence,
          margin: 0.08,
        }),
      });

      const data = await res.json();
      const now = new Intl.DateTimeFormat("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date());

      if (res.ok) {
        setLastResult({
          faces_detected: data.faces_detected ?? 0,
          match: Boolean(data.match),
          student_id: data.student_id ?? null,
          full_name: data.full_name ?? null,
          class_id: data.class_id ?? null,
          confidence: Number(data.confidence ?? 0),
          threshold_used: Number(data.threshold_used ?? minConfidence),
          reason: data.reason ?? null,
          timestamp: now,
        });
      } else {
        setLastResult({
          faces_detected: 0,
          match: false,
          student_id: null,
          confidence: 0,
          threshold_used: minConfidence,
          reason: data.error ?? "Service offline / error",
          timestamp: now,
        });
      }
    } catch (err: unknown) {
      setLastResult({
        faces_detected: 0,
        match: false,
        student_id: null,
        confidence: 0,
        threshold_used: minConfidence,
        reason: err instanceof Error ? err.message : "Gagal kirim frame",
        timestamp: new Date().toLocaleTimeString(),
      });
    } finally {
      setScanning(false);
    }
  }, [streamActive, scanning, minConfidence]);

  // 5. Loop auto scan jika diaktifkan
  useEffect(() => {
    if (!autoScan || !streamActive) return;
    const timer = setInterval(() => {
      captureAndRecognize();
    }, 1800);
    return () => clearInterval(timer);
  }, [autoScan, streamActive, captureAndRecognize]);

  return (
    <div className="min-h-screen bg-[#F6F8FA] text-aici-dark flex flex-col">
      {/* Top Bar Kiosk */}
      <header className="px-5 py-3 bg-aici-surface border-b border-aici-border/60 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-semibold text-aici-muted hover:text-aici-dark px-2.5 py-1.5 rounded-lg border border-aici-border hover:bg-aici-surface-nested transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </Link>
          <div className="h-4 w-px bg-aici-border" />
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold tracking-tight text-aici-dark">
              AICI Smart Vision Station
            </h1>
          </div>
        </div>

        {/* Status Backend Face Service: hanya tampil saat offline */}
        <div className="flex items-center gap-2 text-xs">
          {health.status !== "ok" && health.status !== "checking" && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-semibold text-[11px]">
              <AlertCircle className="w-3.5 h-3.5" />
              Kamera offline — hubungi operator
            </span>
          )}
          <button
            onClick={checkHealth}
            title="Refresh status service"
            className="p-1.5 rounded-lg border border-aici-border hover:bg-aici-surface-nested text-aici-muted transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Kiosk Area: satu kolom tengah full-width */}
      <main className="flex-1 p-4 md:p-6 max-w-3xl mx-auto w-full flex flex-col gap-4">
        {/* Blok Kamera */}
        <div className="flex flex-col gap-3">
          <div className="bg-aici-surface rounded-2xl border border-aici-border/60 p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs font-semibold text-aici-dark">
              <span>Pratinjau Kamera Kelas</span>
              {streamActive && (
                <span className="text-[11px] font-mono text-emerald-600 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  640×480
                </span>
              )}
            </div>

            <div className="relative aspect-[4/3] bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center">
              {/* Video element */}
              <video
                ref={videoRef}
                playsInline
                autoPlay
                muted
                className={`w-full h-full object-cover transition-opacity duration-300 ${
                  streamActive ? "opacity-100" : "opacity-0"
                }`}
              />
              {/* Hidden canvas untuk frame grab */}
              <canvas ref={canvasRef} className="hidden" />

              {/* Placeholder saat kamera mati */}
              {!streamActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-4 text-center">
                  <CameraOff className="w-8 h-8 text-slate-500" />
                  <div>
                    <p className="text-sm font-semibold text-slate-200">
                      Kamera Belum Aktif
                    </p>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs">
                      Klik tombol di bawah untuk membuka webcam browser kelas
                    </p>
                  </div>
                  <button
                    onClick={() => startCamera(selectedDeviceId)}
                    className="mt-1 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs shadow-lg transition-transform active:scale-95"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Nyalakan Kamera</span>
                  </button>
                  {cameraError && (
                    <p className="text-xs text-rose-400 max-w-md bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-lg">
                      {cameraError}
                    </p>
                  )}
                </div>
              )}

              {/* Reticle Oval Wajah Identik /students/enroll */}
              {streamActive && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div
                    className={`w-48 h-64 rounded-[50%] border-2 border-dashed transition-all duration-300 flex items-center justify-center ${
                      lastResult?.match
                        ? "border-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.4)]"
                        : scanning
                        ? "border-white shadow-[0_0_20px_rgba(255,255,255,0.3)] animate-pulse"
                        : "border-white/60"
                    }`}
                  >
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-black/60 text-white/90">
                      Posisikan Wajah di Oval
                    </span>
                  </div>
                </div>
              )}

              {/* Badge Status Pojok Kiri Atas */}
              {streamActive && (
                <div className="absolute top-3 left-3 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/70 backdrop-blur text-emerald-300 text-xs font-semibold border border-white/10">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    LIVE FEED
                  </span>
                  {autoScan && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/70 text-white text-[11px] font-bold border border-white/20">
                      <Zap className="w-3 h-3" />
                      AUTO (1.8s)
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Toolbar Kamera */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              {streamActive ? (
                <>
                  <button
                    onClick={captureAndRecognize}
                    disabled={scanning}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-aici-dark hover:bg-black text-white font-bold text-xs shadow transition-all active:scale-95 disabled:opacity-50"
                  >
                    <ScanFace className="w-4 h-4" />
                    <span>{scanning ? "Memproses..." : "Scan Wajah"}</span>
                  </button>

                  <button
                    onClick={() => setAutoScan((v) => !v)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold border transition-colors ${
                      autoScan
                        ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                        : "bg-aici-surface border-aici-border text-aici-muted hover:bg-aici-surface-nested"
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>{autoScan ? "Auto-Scan Aktif" : "Auto-Scan Off"}</span>
                  </button>

                  <button
                    onClick={stopCamera}
                    className="px-3 py-2.5 rounded-xl hover:bg-aici-surface-nested text-rose-600 text-xs font-semibold border border-aici-border transition-colors"
                  >
                    Matikan
                  </button>
                </>
              ) : (
                <button
                  onClick={() => startCamera(selectedDeviceId)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-aici-dark hover:bg-black text-white font-bold text-xs shadow transition-all active:scale-95"
                >
                  <Camera className="w-4 h-4" />
                  <span>Nyalakan Kamera</span>
                </button>
              )}
            </div>

            {/* Device Selector */}
            {devices.length > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <Settings2 className="w-3.5 h-3.5 text-aici-muted" />
                <select
                  value={selectedDeviceId}
                  onChange={(e) => {
                    setSelectedDeviceId(e.target.value);
                    if (streamActive) startCamera(e.target.value);
                  }}
                  className="bg-aici-surface text-aici-dark border border-aici-border rounded-lg px-2.5 py-1 text-xs outline-none cursor-pointer"
                >
                  {devices.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Kamera ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Card Hasil Identifikasi (Full Width di Bawah Kamera) */}
        <div className="p-5 bg-aici-surface rounded-2xl border border-aici-border/60 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-aici-border/60 pb-3">
              <div>
                <h2 className="text-sm font-bold text-aici-dark">
                  Status Identifikasi Biometrik
                </h2>
                <p className="text-[11px] text-aici-muted mt-0.5">
                  Faktor 1: YuNet Bounding Box + SFace Cosine
                </p>
              </div>
              {lastResult && (
                <span className="text-[10px] font-mono text-aici-muted">
                  {lastResult.timestamp}
                </span>
              )}
            </div>

            {/* State Tampilan Hasil */}
            {!lastResult ? (
              <div className="py-10 flex flex-col items-center justify-center text-center text-aici-muted gap-2">
                <ScanFace className="w-10 h-10 text-aici-muted stroke-[1.5]" />
                <p className="text-xs font-semibold text-aici-dark">
                  Belum ada pembacaan wajah
                </p>
                <p className="text-[11px] text-aici-muted max-w-xs">
                  Arahkan wajah ke kotak panduan lalu klik &ldquo;Scan Wajah&rdquo;
                  atau aktifkan Auto-Scan.
                </p>
              </div>
            ) : lastResult.match ? (
              <div className="space-y-4">
                {/* Banner Match Hijau */}
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                      Wajah Terverifikasi (Kandidat Terkunci)
                    </span>
                    <h3 className="text-base font-bold text-aici-dark mt-0.5 truncate">
                      {lastResult.full_name ?? lastResult.student_id}
                    </h3>
                    <p className="text-[11px] text-aici-muted font-mono">
                      {lastResult.student_id}{lastResult.class_id ? ` • ${lastResult.class_id}` : ""}
                    </p>
                    <p className="text-xs text-emerald-700 mt-1 font-mono">
                      Skor SFace: {(lastResult.confidence * 100).toFixed(1)}% (ambang: {lastResult.threshold_used})
                    </p>
                  </div>
                </div>

                {/* Petunjuk Langkah ke-2 (Fingerprint) */}
                <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                    <Fingerprint className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-blue-800">
                      Langkah 2: Verifikasi Sidik Jari
                    </h4>
                    <p className="text-[11px] text-blue-900/70 mt-1 leading-relaxed">
                      Tempelkan jari pada sensor <strong>R503</strong> di bawah
                      webcam dalam waktu <strong>30 detik</strong> untuk
                      menyelesaikan 2FA.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Banner Tidak Cocok */}
                <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3">
                  <XCircle className="w-6 h-6 text-rose-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700">
                      {lastResult.faces_detected === 0
                        ? "Wajah Tidak Terdeteksi"
                        : lastResult.reason === "ambiguous"
                        ? "Wajah Ambigu — Verifikasi Ulang"
                        : "Wajah Belum Terdaftar"}
                    </span>
                    <p className="text-xs text-aici-muted mt-1">
                      {lastResult.faces_detected === 0
                        ? "Tidak ada wajah valid dalam frame kamera. Pastikan pencahayaan cukup dan wajah menghadap lurus."
                        : lastResult.reason === "ambiguous"
                        ? `Skor (${(lastResult.confidence * 100).toFixed(1)}%) terlalu dekat dengan 2 wajah. Mendekat ke kamera / perbaiki cahaya, lalu pindai lagi.`
                        : `Skor kemiripan (${(lastResult.confidence * 100).toFixed(1)}%) di bawah batas minimum (${lastResult.threshold_used}).`}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Threshold slider */}
            <div className="pt-3 border-t border-aici-border/60 space-y-1.5">
              <div className="flex justify-between text-xs text-aici-muted">
                <span>Threshold Cosine</span>
                <span className="font-mono text-aici-dark font-semibold">
                  {minConfidence.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0.3"
                max="0.7"
                step="0.02"
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
                className="w-full accent-aici-dark cursor-pointer"
              />
              <p className="text-[10px] text-aici-muted">
                Default: 0.40 (SFace cosine). Naikkan jika false positive tinggi.
              </p>
            </div>
          </div>
      </main>
    </div>
  );
}
