"use client";

import { useCallback, useState, type RefObject } from "react";

/**
 * Geometri oval panduan yang sama dengan `face_engine.py`:
 * - `ry`     = setengah tinggi oval, fraksi TINGGI frame (tinggi = 2*ry).
 * - `aspect` = lebar:tinggi oval dalam PIKSEL (0.75 = portrait 3:4).
 *
 * Lebar oval (fraksi lebar frame) = 2*ry*aspect / (lebar/tinggi frame).
 * Diturunkan dari frame aktual, jadi bentuknya portrait di semua resolusi.
 */
export const DEFAULT_OVAL = { ry: 0.35, aspect: 0.75 };

export interface OvalGeom {
  ry: number;
  aspect: number;
}

export function useOvalGuide(videoRef: RefObject<HTMLVideoElement | null>) {
  const [oval, setOval] = useState<OvalGeom>(DEFAULT_OVAL);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null);

  // Baca dimensi stream aktual; dipanggil dari start kamera, event video, dan probe.
  const syncVideoSize = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0 || v.videoHeight === 0) return; // biarkan nilai terakhir
    setVideoSize((prev) =>
      prev?.w === v.videoWidth && prev?.h === v.videoHeight ? prev : { w: v.videoWidth, h: v.videoHeight }
    );
  }, [videoRef]);

  const resetVideoSize = useCallback(() => setVideoSize(null), []);

  // Terima payload GET /health mentah: { oval: { ry, aspect } }.
  const setOvalFrom = useCallback((data: { oval?: Partial<OvalGeom> }) => {
    if (data?.oval?.ry && data?.oval?.aspect) {
      setOval({ ry: data.oval.ry, aspect: data.oval.aspect });
    }
  }, []);

  const videoAspect = videoSize ? videoSize.w / videoSize.h : null;
  const containerAspect = videoAspect ?? 16 / 9; // sebelum kamera hidup: asumsi 16:9
  const frameLabel = videoSize ? `${videoSize.w}×${videoSize.h}` : "—";

  // Ukuran oval sebagai persen dari wadah (wadah = frame, tanpa crop).
  const ovalHeightPct = oval.ry * 200;
  const ovalWidthPct = (ovalHeightPct * oval.aspect) / containerAspect;

  // Ukuran oval dalam piksel frame: bandingkan dengan teks `oval:` di jendela Python.
  const ovalPx = videoSize
    ? `${Math.round(((ovalWidthPct / 100) * videoSize.w))}×${Math.round(
        ((ovalHeightPct / 100) * videoSize.h)
      )}`
    : null;

  return {
    oval,
    setOvalFrom,
    videoSize,
    syncVideoSize,
    resetVideoSize,
    videoAspect,
    frameLabel,
    ovalWidthPct,
    ovalHeightPct,
    ovalPx,
  };
}
