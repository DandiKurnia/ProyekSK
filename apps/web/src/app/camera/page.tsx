"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOvalGuide } from "@/lib/oval-guide";
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

// (geometri oval panduan kini dari hook bersama `useOvalGuide`)

interface RecognizeResult {
  faces_detected: number;
  face_in_frame?: boolean;
  match: boolean;
  student_id: string | null;
  full_name?: string | null;
  class_id?: string | null;
  fingerprint_slot?: number | null;
  confidence: number;
  threshold_used: number;
  reason?: string | null;
  timestamp: string;
}

export default function CameraKioskPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Geometri oval + ukuran frame aktual dari hook bersama (sama dengan /students/enroll + Python).
  const {
    setOvalFrom,
    syncVideoSize,
    resetVideoSize,
    videoAspect,
    frameLabel,
    ovalWidthPct,
    ovalHeightPct,
    ovalPx,
  } = useOvalGuide(videoRef);
  const [streamActive, setStreamActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  const [health, setHealth] = useState<HealthStatus>({ status: "checking" });
  const [scanning, setScanning] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [lastResult, setLastResult] = useState<RecognizeResult | null>(null);
  const [minConfidence, setMinConfidence] = useState<number>(0.4);
  const [facePresent, setFacePresent] = useState<boolean | null>(null);
  const [facePartial, setFacePartial] = useState(false); // wajah terdeteksi tapi terpotong tepi frame
  const [faceOutside, setFaceOutside] = useState(false); // seluruh kotak wajah di luar oval panduan

  interface TwoFa {
    state: "waiting" | "verified" | "failed" | "expired" | "error";
    message?: string;
  }

  // --- 2FA: wajah cocok -> buka sesi tunggu sidik jari (max 1 sesi per wajah) ---
  const [twofa, setTwofa] = useState<TwoFa | null>(null);
  const twofaFor = useRef<string | null>(null); // student_id sesi yang sedang aktif
  const twofaPoll = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (twofaPoll.current) window.clearInterval(twofaPoll.current);
    },
    []
  );

  const startTwoFa = useCallback(async (studentId: string, slot: number) => {
    if (twofaFor.current === studentId) return; // auto-scan kirim frame tiap 1.8 dtk: jangan buka sesi ganda
    twofaFor.current = studentId;
    setTwofa({ state: "waiting" });
    try {
      const res = await fetch("/api/fingerprint/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ student_id: studentId, slot, ttl: 30 }),
      });
      const opened = await res.json();
      if (!res.ok) throw new Error(opened.detail ?? opened.error ?? `HTTP ${res.status}`);
    } catch (err: unknown) {
      twofaFor.current = null;
      setTwofa({ state: "error", message: err instanceof Error ? err.message : "ESP32 tidak terhubung" });
      return;
    }
    twofaPoll.current = window.setInterval(async () => {
      try {
        const r = await fetch("/api/fingerprint/session", { cache: "no-store" });
        const s = await r.json();
        if (s.state !== "waiting") {
          window.clearInterval(twofaPoll.current!);
          twofaPoll.current = null;
          twofaFor.current = null;
        }
        setTwofa({ state: s.state, message: s.reason });
      } catch {
        // Jaringan putus sesaat: polling berikutnya mencoba lagi
      }
    }, 500);
  }, []);

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
      setOvalFrom(data); // oval: { ry, aspect } dari GUIDE_RY/GUIDE_ASPECT di face_engine.py
    } catch (err: unknown) {
      setHealth({
        status: "offline",
        error:
          err instanceof Error
            ? err.message
            : "Service FastAPI lokal belum aktif (:8200)",
      });
    }
  }, [setOvalFrom]);

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

  const startCamera = async (deviceId?: string) => {
    setCameraError(null);
    try {
      if (videoRef.current?.srcObject) {
        const prev = videoRef.current.srcObject as MediaStream;
        prev.getTracks().forEach((t) => t.stop());
      }
      // ideal 1280x720 = rasio 16:9, sama dengan default --size di test_yunet_box.py
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play();
        syncVideoSize(); // ukur bingkai aktual: kamera bisa menolak 16:9 dan memberi rasio lain
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
    resetVideoSize(); // wadah kembali ke 4:3 sampai stream baru terukur
    setFacePresent(null);
    setFaceOutside(false);
  };
  // 4. Capture 1 frame & kirim ke /api/face/recognize
  const captureAndRecognize = useCallback(async () => {
    if (!videoRef.current || !streamActive || scanning) return;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    setScanning(true);
    try {
      // Kirim frame utuh (tanpa mask elips): oval murni panduan UI, bukan filter piksel.
      // Kalau dipotong/masking, wajah yang sedikit keluar oval bisa gagal terdeteksi.
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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
          fingerprint_slot: data.fingerprint_slot ?? null,
          confidence: Number(data.confidence ?? 0),
          threshold_used: Number(data.threshold_used ?? minConfidence),
          reason: data.reason ?? null,
          timestamp: now,
        });
        // Wajah cocok + siswa punya sidik jari -> kunci sesi, tunggu jari (TTL 30 dtk di server)
        if (data.match && data.student_id && data.fingerprint_slot) {
          startTwoFa(data.student_id, Number(data.fingerprint_slot));
        }
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
  }, [streamActive, scanning, minConfidence, startTwoFa]);

  // 5. Loop auto scan jika diaktifkan. Lewat ref supaya interval tidak dibuat ulang
  //    setiap `scanning` berubah (dulu bikin tick 1.8 dtk ter-reset terus).
  const scanRef = useRef(captureAndRecognize);
  useEffect(() => {
    scanRef.current = captureAndRecognize;
  }, [captureAndRecognize]);
  useEffect(() => {
    if (!autoScan || !streamActive) return;
    const timer = setInterval(() => scanRef.current(), 1800);
    return () => clearInterval(timer);
  }, [autoScan, streamActive]);

  // 6. Probing ringan tiap 1.2 dtk: warna oval mengikuti ada/tidaknya wajah di frame.
  useEffect(() => {
    if (!streamActive) {
      setFacePresent(null);
      setFacePartial(false);
      setFaceOutside(false);
      return;
    }
    let alive = true;
    const probe = async () => {
      const v = videoRef.current;
      if (!v || v.videoWidth === 0) return;
      syncVideoSize(); // pastikan state selalu sama dengan frame aktual (anti wadah nyangkut 4:3)
      try {
        const cnv = document.createElement("canvas");
        cnv.width = 320;
        cnv.height = Math.round((v.videoHeight * 320) / v.videoWidth);
        const c2 = cnv.getContext("2d");
        if (!c2) return;
        c2.drawImage(v, 0, 0, cnv.width, cnv.height);
        const res = await fetch("/api/face/recognize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            image_base64: cnv.toDataURL("image/jpeg", 0.6),
            min_confidence: minConfidence,
            margin: 0.08,
          }),
        });
        if (!alive || !res.ok) return;
        const d = await res.json();
        const detected = Number(d.faces_detected ?? 0) > 0;
        const inFrame = d.face_in_frame !== false; // server lama tanpa field -> anggap utuh
        const outside = d.reason === "face_outside_oval";
        setFacePresent(detected && inFrame && !outside);
        setFacePartial(detected && !inFrame);
        setFaceOutside(outside);
      } catch {
        // Biarkan status terakhir: gangguan jaringan tidak mengubah warna.
      }
    };
    probe();
    const t = setInterval(probe, 1200);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [streamActive, minConfidence, syncVideoSize]);

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
                  {frameLabel}
                  {ovalPx && ` · oval ${ovalPx}`}
                </span>
              )}
            </div>

            {/* Wadah ikut rasio stream asli: tanpa crop, oval FE = oval Python */}
            <div
              style={{ aspectRatio: String(videoAspect ?? 4 / 3) }}
              className="relative w-full bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center"
            >
              {/* Video element */}
              <video
                ref={videoRef}
                playsInline
                autoPlay
                muted
                onLoadedMetadata={syncVideoSize}
                onResize={syncVideoSize}
                className={`w-full h-full object-contain transition-opacity duration-300 ${
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

              {/* Reticle oval: ukuran dari GET /health (GUIDE_RX/RY di server) */}
              {streamActive && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div
                    style={{ width: `${ovalWidthPct}%`, height: `${ovalHeightPct}%` }}
                    className={`rounded-[50%] border-2 transition-all duration-300 flex items-center justify-center ${
                      scanning
                        ? "border-amber-400 border-dashed shadow-[0_0_24px_rgba(251,191,36,0.45)] animate-pulse"
                        : facePresent === true
                        ? "border-emerald-400 border-solid shadow-[0_0_28px_rgba(16,185,129,0.45)]"
                        : facePartial || faceOutside
                        ? "border-rose-500 border-dashed shadow-[0_0_24px_rgba(244,63,94,0.4)] animate-pulse"
                        : facePresent === false
                        ? "border-rose-500 border-dashed shadow-[0_0_24px_rgba(244,63,94,0.4)]"
                        : "border-white/60 border-dashed shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                    }`}
                  >
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full text-white transition-colors ${
                        scanning
                          ? "bg-amber-600/85"
                          : facePresent === true
                          ? "bg-emerald-600/85"
                          : facePartial || faceOutside
                          ? "bg-rose-600/85"
                          : facePresent === false
                          ? "bg-rose-600/85"
                          : "bg-black/60"
                      }`}
                    >
                      {scanning
                        ? "Memindai..."
                        : facePresent === true
                        ? "Wajah Terdeteksi — Siap Scan"
                        : facePartial
                        ? "Wajah Belum Utuh — Masuk ke Oval"
                        : faceOutside
                        ? "Wajah Di Luar Oval — Masuk ke Lingkaran"
                        : facePresent === false
                        ? "Wajah Tidak Terdeteksi"
                        : "Posisikan Wajah di Oval"}
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

                {/* Status Langkah ke-2 (Fingerprint) */}
                {!lastResult.fingerprint_slot ? (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
                    Siswa ini belum mendaftarkan sidik jari. Daftarkan dulu lewat menu Students →
                    Enroll Fingerprint agar bisa absen 2FA.
                  </div>
                ) : (
                  <div
                    className={
                      twofa?.state === "verified"
                        ? "p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3"
                        : twofa?.state === "failed" || twofa?.state === "expired" || twofa?.state === "error"
                          ? "p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3"
                          : "p-4 rounded-xl bg-blue-50 border border-blue-200 flex items-start gap-3"
                    }
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                      {twofa?.state === "verified" ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      ) : twofa?.state === "failed" || twofa?.state === "expired" || twofa?.state === "error" ? (
                        <XCircle className="w-5 h-5 text-rose-500" />
                      ) : (
                        <Fingerprint className="w-5 h-5 animate-pulse" />
                      )}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-blue-800">
                        {twofa?.state === "verified"
                          ? "Sidik Jari Cocok — 2FA Lolos"
                          : twofa?.state === "failed"
                            ? "Sidik Jari Salah 3x — sesi hangus"
                            : twofa?.state === "expired"
                              ? "Waktu habis (30 dtk) — scan wajah ulang"
                              : twofa?.state === "error"
                                ? `Sensor bermasalah: ${twofa.message ?? "ESP32 tidak terhubung"}`
                                : "Langkah 2: Verifikasi Sidik Jari"}
                      </h4>
                      {(!twofa || twofa.state === "waiting") && (
                        <p className="text-[11px] text-blue-900/70 mt-1 leading-relaxed">
                          Tempelkan jari pada sensor <strong>R503</strong> di bawah webcam untuk menyelesaikan
                          2FA.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Banner Tidak Cocok */}
                <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3">
                  <XCircle className="w-6 h-6 text-rose-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700">
                      {lastResult.reason === "no_face" || lastResult.faces_detected === 0
                        ? "Wajah Tidak Terdeteksi"
                        : lastResult.reason === "partial_face"
                        ? "Wajah Belum Utuh — Ulangi"
                        : lastResult.reason === "face_outside_oval"
                        ? "Wajah Di Luar Oval — Ulangi"
                        : lastResult.reason === "ambiguous"
                        ? "Wajah Ambigu — Verifikasi Ulang"
                        : "Wajah Belum Terdaftar"}
                    </span>
                    <p className="text-xs text-aici-muted mt-1">
                      {lastResult.reason === "no_face" || lastResult.faces_detected === 0
                        ? "Tidak ada wajah valid dalam frame kamera. Pastikan pencahayaan cukup dan wajah menghadap lurus."
                        : lastResult.reason === "partial_face"
                        ? "Sebagian wajah keluar dari frame. Posisikan seluruh wajah (dahi sampai dagu) di dalam oval, lalu pindai lagi."
                        : lastResult.reason === "face_outside_oval"
                        ? "Wajah terdeteksi tapi di luar lingkaran panduan. Geser hingga seluruh wajah masuk ke dalam oval, lalu pindai lagi."
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
