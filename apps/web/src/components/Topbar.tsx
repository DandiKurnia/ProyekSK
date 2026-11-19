"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, CalendarDays, RefreshCw, User, LogOut } from "lucide-react";
import type { ClassOption } from "@/lib/overview";
import { supabaseBrowser } from "@/lib/supabase-browser";

interface SessionUser {
  email: string;
  full_name: string;
  role: string;
}


 export function Topbar({
   classes,
   activeClassId,
   onClassChange,
   date,
   onDateChange,
   realtimeLive,
   onRefresh,
   refreshing,
   pageTitle = "Overview",
 }: {
   classes: ClassOption[];
   activeClassId: string | null;
   onClassChange: (id: string) => void;
   date?: string;
   onDateChange?: (d: string) => void;
   realtimeLive: boolean;
   onRefresh: () => void;
   refreshing: boolean;
   pageTitle?: string;
 }) {
  const router = useRouter();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSessionUser(d))
      .catch(() => {});
  }, []);

  const logout = async () => {
    await supabaseBrowser().auth.signOut();
    await fetch("/api/auth/signout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

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

      {date && onDateChange && (
        <label className="flex items-center gap-2 text-xs font-medium border border-aici-border-dark rounded-lg px-3 py-2 hover:bg-aici-surface-nested cursor-pointer">
          <CalendarDays className="w-4 h-4 shrink-0" />
          <input
            type="date"
            value={date}
            max={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())}
            onChange={(e) => e.target.value && onDateChange(e.target.value)}
            className="bg-transparent outline-none cursor-pointer font-medium"
            aria-label="Tanggal aktif"
          />
        </label>
      )}

      <button
        aria-label="Refresh"
        onClick={onRefresh}
        disabled={refreshing}
        className="w-9 h-9 flex items-center justify-center border border-aici-border-dark rounded-lg hover:bg-aici-surface-nested disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
      </button>

      <div className="relative flex items-center gap-2 sm:gap-2.5 pl-2 border-l border-aici-border-dark">
        <div className="hidden sm:block text-right leading-tight">
          <p className="text-sm font-semibold truncate max-w-[140px]">
            {sessionUser?.full_name ?? "—"}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-aici-muted">
            {sessionUser?.role ?? ""}
          </p>
        </div>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu profil"
          aria-expanded={menuOpen}
          className="w-9 h-9 rounded-full bg-[#3F6212] flex items-center justify-center shrink-0"
        >
          <User className="w-4 h-4 text-white" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-12 z-20 w-56 rounded-xl border border-aici-border bg-aici-surface shadow-lg p-2">
            <p className="px-2 py-1.5 text-xs font-semibold text-aici-dark truncate">
              {sessionUser?.full_name ?? "Staf"}
            </p>
            <p className="px-2 pb-1.5 text-[11px] text-aici-muted truncate">
              {sessionUser?.email ?? ""}
            </p>
            <button
              onClick={logout}
              className="mt-1 w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-aici-error hover:bg-aici-surface-nested"
            >
              <LogOut className="w-3.5 h-3.5" />
              Keluar
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
