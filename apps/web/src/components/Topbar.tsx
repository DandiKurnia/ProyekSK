"use client";

import { GraduationCap, CalendarDays, RefreshCw, User } from "lucide-react";
import type { ClassOption } from "@/lib/overview";

export function Topbar({
  classes,
  activeClassId,
  onClassChange,
  realtimeLive,
  onRefresh,
  refreshing,
  pageTitle = "Overview",
}: {
  classes: ClassOption[];
  activeClassId: string | null;
  onClassChange: (id: string) => void;
  realtimeLive: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  pageTitle?: string;
}) {

  return (
    <header className="flex items-center gap-2 sm:gap-3 pl-16 lg:px-5 pr-4 py-3 bg-aici-surface border-b border-aici-border">
      <nav className="text-sm text-aici-muted flex-1 flex items-center gap-2 min-w-0">
        <span className="font-medium hidden sm:inline">AICI Center</span>
        <span className="mx-1 hidden sm:inline">›</span>
        <span className="font-semibold text-aici-dark truncate">{pageTitle}</span>
        <span
          title={realtimeLive ? "Realtime live" : "Realtime terputus"}
          className={`w-2 h-2 rounded-full shrink-0 inline-block ${
            realtimeLive ? "bg-aici-success" : "bg-aici-error"
          }`}
        />
      </nav>
      <label className="flex items-center gap-2 text-xs font-medium border border-aici-border-dark rounded-lg px-3 py-2 hover:bg-aici-surface-nested cursor-pointer">
        <GraduationCap className="w-4 h-4" />
        <select
          value={activeClassId ?? ""}
          onChange={(e) => onClassChange(e.target.value)}
          className="bg-transparent outline-none cursor-pointer font-medium"
          aria-label="Kelas aktif"
        >
          {classes.length === 0 && <option value="">Memuat…</option>}
          {classes.map((c) => (
            <option key={c.class_id} value={c.class_id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="hidden md:flex items-center gap-2 text-xs font-medium border border-aici-border-dark rounded-lg px-3 py-2">
        <CalendarDays className="w-4 h-4 shrink-0" />
        <span className="truncate">
          {new Intl.DateTimeFormat("id-ID", {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "Asia/Jakarta",
          }).format(new Date())}
        </span>
      </div>

      <button
        aria-label="Refresh"
        onClick={onRefresh}
        disabled={refreshing}
        className="w-9 h-9 flex items-center justify-center border border-aici-border-dark rounded-lg hover:bg-aici-surface-nested disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
      </button>

      <div className="flex items-center gap-2 sm:gap-2.5 pl-2 border-l border-aici-border-dark">
        <span className="text-sm font-semibold hidden sm:inline">Budi Santoso</span>
        <div className="w-9 h-9 rounded-full bg-[#3F6212] flex items-center justify-center shrink-0" aria-label="Budi Santoso">
          <User className="w-4 h-4 text-white" />
        </div>
      </div>
    </header>
  );
}
