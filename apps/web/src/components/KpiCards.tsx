"use client";

import {
  TrendingUp,
  Users,
  CheckCircle2,
  Clock,
  XCircle,
  Armchair,
} from "lucide-react";
import type { OverviewSummary } from "@/lib/overview";

export function KpiGrid({
  data,
  loading,
}: {
  data: OverviewSummary | null;
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl p-5 bg-aici-surface shadow-sm min-h-[140px]"
        >
          <div className="animate-pulse bg-aici-surface-nested rounded h-3 w-20" />
          <div className="animate-pulse bg-aici-surface-nested rounded h-8 w-16 mt-2" />
        </div>
        ))}
      </div>
    );
  }

  const rate =
    data.total > 0
      ? (((data.present + data.late) / data.total) * 100).toFixed(1) + "%"
      : "—";

  const cards = [
    { label: "Tingkat Kehadiran", value: rate, icon: TrendingUp, highlight: true },
    { label: "Total Peserta", value: String(data.total), icon: Users },
    {
      label: "Tepat Waktu",
      value: String(data.present),
      icon: CheckCircle2,
      tint: "text-aici-success",
    },
    {
      label: "Terlambat",
      value: String(data.late),
      icon: Clock,
      tint: "text-aici-warning",
    },
    {
      label: "Tidak Hadir",
      value: String(data.absent),
      icon: XCircle,
      tint: "text-aici-error",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`rounded-2xl p-5 flex flex-col min-h-[140px] ${
            c.highlight ? "bg-aici-lime" : "bg-aici-surface shadow-sm"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-medium leading-snug text-aici-dark">
              {c.label}
            </p>
            <c.icon
              className={`w-[18px] h-[18px] shrink-0 ${c.tint ?? "text-aici-dark"}`}
              strokeWidth={1.8}
            />
          </div>
          <p className="text-3xl font-bold mt-2">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

export function SeatOccupancyCard({
  data,
  loading,
}: {
  data: OverviewSummary | null;
  loading: boolean;
}) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const s = data?.seats ?? { total: 0, occupied: 0, empty: 0, unknown: 0 };
  const occFrac = s.total > 0 ? s.occupied / s.total : 0;
  const unkFrac = s.total > 0 ? s.unknown / s.total : 0;

  return (
    <div className="bg-aici-surface rounded-2xl p-5 shadow-sm flex flex-col h-full">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold flex items-center gap-2">
            Okupansi Kursi
            <span className="w-1.5 h-1.5 rounded-full bg-aici-success inline-block" />
          </p>
          <p className="text-[11px] text-aici-muted font-mono mt-0.5">
            HX711 Load Cell Grid Hub
          </p>
        </div>
        <div className="w-8 h-8 rounded-lg bg-aici-surface-nested flex items-center justify-center">
          <Armchair className="w-4 h-4 text-aici-muted" />
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center py-4">
        {loading || !data ? (
          <div className="animate-pulse bg-aici-surface-nested rounded-full w-36 h-36" />
        ) : s.total === 0 ? (
          <p className="text-xs text-aici-muted text-center">
            Belum ada kursi terpantau
            <br />
            di kelas ini
          </p>
        ) : (
          <div className="relative w-36 h-36">
            <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
              <circle cx="64" cy="64" r={R} fill="none" stroke="#F3F4F6" strokeWidth="14" />
              {occFrac > 0 && (
                <circle
                  cx="64" cy="64" r={R} fill="none"
                  stroke="#16A34A" strokeWidth="14" strokeLinecap="round"
                  strokeDasharray={`${C * occFrac} ${C}`}
                />
              )}
              {unkFrac > 0 && (
                <circle
                  cx="64" cy="64" r={R} fill="none"
                  stroke="#F59E0B" strokeWidth="14" strokeLinecap="round"
                  strokeDasharray={`${C * unkFrac} ${C}`}
                  strokeDashoffset={-C * occFrac}
                />
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-[28px] leading-none font-bold">{s.total}</p>
              <p className="text-[11px] text-aici-muted mt-1">Total Kursi Lab</p>
            </div>
          </div>
        )}
      </div>

      {!loading && data && s.total > 0 && (
        <div className="flex justify-center gap-3 text-[11px] font-mono text-aici-muted">
          <span>Terisi {s.occupied}</span>
          <span>Kosong {s.empty}</span>
          <span>Unknown {s.unknown}</span>
        </div>
      )}
    </div>
  );
}
