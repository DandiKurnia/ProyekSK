"use client";

import { Monitor, Fingerprint, Armchair, ShieldCheck, Cpu } from "lucide-react";
import type { OverviewSummary } from "@/lib/overview";

function deviceIcon(type: string) {
  if (type === "face_computer") return Monitor;
  if (type === "fingerprint_esp32") return Fingerprint;
  return Armchair;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Belum melapor";
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec} dtk lalu`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  return `${Math.round(diffMin / 60)} jam lalu`;
}

export function DeviceHealthCard({
  data,
  loading,
}: {
  data: OverviewSummary | null;
  loading: boolean;
}) {
  const devices = data?.devices ?? [];

  return (
    <div className="bg-aici-surface rounded-2xl p-5 shadow-sm flex flex-col h-full">
      <div className="flex items-start gap-2.5 mb-4">
        <Cpu className="w-4 h-4 text-aici-dark mt-0.5" />
        <div>
          <p className="text-sm font-semibold">Kesehatan Perangkat Kelas</p>
          <p className="text-[11px] text-aici-muted font-mono">
            Hardware Edge Diagnostics &amp; Telemetry
          </p>
        </div>
      </div>

      <div className="space-y-2.5 flex-1">
        {loading || !data ? (
          <div className="space-y-2">
            <div className="h-14 bg-aici-surface-nested rounded-xl animate-pulse" />
            <div className="h-14 bg-aici-surface-nested rounded-xl animate-pulse" />
          </div>
        ) : devices.length === 0 ? (
          <p className="text-xs text-aici-muted py-6 text-center">
            Belum ada perangkat terdaftar di kelas ini
          </p>
        ) : (
          devices.map((d) => {
            const Icon = deviceIcon(d.type);
            const isOnline = d.status === "online" && !d.stale;
            return (
              <div
                key={d.device_id}
                className="flex items-center gap-3 p-3 bg-aici-surface-nested rounded-xl"
              >
                <div className="w-8 h-8 rounded-lg bg-aici-surface flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-aici-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{d.name}</p>
                  <p className="text-[10px] text-aici-muted font-mono truncate">
                    ID: {d.device_id} • {d.type}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      isOnline
                        ? "bg-aici-success-bg text-aici-success"
                        : "bg-aici-error-bg text-aici-error"
                    }`}
                  >
                    {isOnline ? "Online" : "Offline"}
                  </span>
                  <p className="text-[10px] text-aici-muted mt-0.5 font-mono">
                    {timeAgo(d.last_seen_at)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function TwoFactorDistributionCard({
  data,
  loading,
}: {
  data: OverviewSummary | null;
  loading: boolean;
}) {
  const total = data?.total ?? 0;
  const present = data?.present ?? 0;
  const late = data?.late ?? 0;
  const other = (data?.failed ?? 0) + (data?.expired ?? 0) + (data?.absent ?? 0);

  const share = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  const items = [
    { label: "Wajah + Sidik Jari Cocok (Present)", count: present, tone: "bg-aici-success" },
    { label: "Sidik Jari Sahaja / Terlambat (Late)", count: late, tone: "bg-aici-warning" },
    { label: "Gagal / Expired / Belum Hadir", count: other, tone: "bg-aici-error" },
  ].map((it) => ({ ...it, pct: `${share(it.count).toFixed(1)}%` }));

  const pFrac = share(present);
  const lFrac = share(late);
  const oFrac = share(other);

  return (
    <div className="bg-aici-surface rounded-2xl p-5 shadow-sm flex flex-col h-full">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-sm font-semibold">Distribusi Status 2FA</p>
          <p className="text-[11px] text-aici-muted font-mono">
            Face Recognition + Biometric
          </p>
        </div>
        <span className="text-[11px] font-medium bg-aici-periwinkle text-aici-dark px-2.5 py-0.5 rounded-full">
          Sesi Pagi
        </span>
      </div>

      <div className="space-y-1.5 mb-4">
        <div className="w-full h-2.5 bg-aici-surface-nested rounded-full overflow-hidden flex">
          <div className="bg-aici-success h-full" style={{ width: `${pFrac}%` }} />
          <div className="bg-aici-warning h-full" style={{ width: `${lFrac}%` }} />
          <div className="bg-aici-error h-full" style={{ width: `${oFrac}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-aici-muted font-mono">
          <span>0%</span>
          <span>{items[0].pct} Hadir Tepat</span>
          <span>100%</span>
        </div>
      </div>

      <div className="space-y-2 flex-1">
        {loading || !data ? (
          <div className="space-y-2">
            <div className="h-6 bg-aici-surface-nested rounded animate-pulse" />
            <div className="h-6 bg-aici-surface-nested rounded animate-pulse" />
            <div className="h-6 bg-aici-surface-nested rounded animate-pulse" />
          </div>
        ) : (
          items.map((it) => (
            <div key={it.label} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${it.tone}`} />
                <span className="font-medium text-aici-dark">{it.label}</span>
              </div>
              <span className="font-mono text-aici-dark">
                <span className="font-semibold">{it.count}</span>{" "}
                <span className="text-aici-muted">({it.pct})</span>
              </span>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between pt-3 mt-3 border-t border-aici-border text-[11px] font-mono text-aici-muted">
        <span>Audit: PostgreSQL</span>
        <span className="inline-flex items-center gap-1 text-aici-success font-semibold">
          <ShieldCheck className="w-3.5 h-3.5" />
          Integrity Valid
        </span>
      </div>
    </div>
  );
}
