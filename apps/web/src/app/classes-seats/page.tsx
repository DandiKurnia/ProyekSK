"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Armchair, RefreshCw, WifiOff, AlertTriangle } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { supabase } from "@/lib/supabase";

interface DeviceInfo {
  device_id: string;
  name: string;
  status: string;
  last_seen_at: string | null;
  last_data_at: string | null;
}

interface Seat {
  seat_id: string;
  class_id: string;
  device_id: string | null;
  row_no: number | null;
  col_no: number | null;
  is_monitored: boolean;
  status: "occupied" | "empty" | "unknown";
  weight_kg: number | null;
  updated_at: string | null;
  stale: boolean;
  stale_after_seconds: number;
  device: DeviceInfo | null;
}

interface SeatEvent {
  event_id: string;
  old_status: string | null;
  new_status: string;
  weight_kg: number | null;
  created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  occupied: "bg-aici-success-bg text-aici-success",
  empty: "bg-aici-periwinkle-subtle text-aici-dark",
  unknown: "bg-aici-error-bg text-aici-error",
};

function seatWeight(s: Seat): string {
  if (s.weight_kg == null) return "—";
  const g = s.weight_kg * 1000;
  return g < 1000
    ? `${Math.round(g)} g`
    : `${(s.weight_kg as number).toFixed(2)} kg`;
}

export default function ClassesSeatsPage() {
  const [seats, setSeats] = useState<Seat[]>([]);
  const [classId, setClassId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<SeatEvent[]>([]);
  const [eventsAvail, setEventsAvail] = useState(true);
  const [realtimeLive, setRealtimeLive] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetch("/api/seats/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { seats: Seat[] };
      setSeats(json.seats);
      setClassId((id) =>
        id && json.seats.some((s) => s.class_id === id)
          ? id
          : (json.seats[0]?.class_id ?? null)
      );
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadEvents = useCallback(async (seatId: string) => {
    try {
      const res = await fetch(
        `/api/seats/events?seat_id=${encodeURIComponent(seatId)}&limit=20`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        events: SeatEvent[];
        available: boolean;
      };
      setEvents(json.events);
      setEventsAvail(json.available);
    } catch {
      // Riwayat non-kritis; telemetri utama tetap tampil.
    }
  }, []);

  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  useEffect(() => {
    const channel = supabase
      .channel("classes-seats")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seat_status" },
        () => load(true)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seat_events" },
        () => {
          load(true);
          if (selectedRef.current) loadEvents(selectedRef.current);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeLive(true);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          setRealtimeLive(false);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, loadEvents]);

  // ponytail: poll 15 dtk sampai publikasi realtime seat_status aktif
  // (supabase/2026-11-16_seat_events.sql). Hapus bila push sudah jalan.
  useEffect(() => {
    const id = setInterval(() => load(true), 15000);
    return () => clearInterval(id);
  }, [load]);

  const select = (seatId: string) => {
    setSelected(seatId);
    loadEvents(seatId);
  };

  const classIds = useMemo(
    () => [...new Set(seats.map((s) => s.class_id))],
    [seats]
  );
  const rows = useMemo(
    () => seats.filter((s) => !classId || s.class_id === classId),
    [seats, classId]
  );
  const summary = useMemo(() => {
    const t = { total: 0, occupied: 0, empty: 0, unknown: 0, stale: 0 };
    for (const s of rows) {
      t.total++;
      t[s.status]++;
      if (s.stale) t.stale++;
    }
    return t;
  }, [rows]);

  const fmtTime = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("id-ID", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: "Asia/Jakarta",
        })
      : "—";

  return (
    <div className="flex min-h-screen bg-[#F6F8FA]">
      <Sidebar active="Classes & Seats" />
      <div className="flex-1 min-w-0">
        <Topbar
          classes={classIds.map((c) => ({ class_id: c, name: c }))}
          activeClassId={classId}
          onClassChange={(id) => setClassId(id || null)}
          realtimeLive={realtimeLive}
          onRefresh={load}
          refreshing={loading}
          pageTitle="Classes & Seats"
        />

        <main className="p-6 space-y-4 w-full flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h1 className="text-base font-bold text-aici-dark">
                {classId ?? "Kelas"}
              </h1>
              <p className="text-xs text-aici-muted">
                Telemetri sensor kursi — bukan bukti kehadiran (prd §4.1).
              </p>
            </div>
            <button
              onClick={() => load()}
              disabled={loading}
              className="flex items-center gap-1.5 border border-aici-border-dark rounded-lg px-2.5 py-1.5 text-xs font-medium text-aici-dark disabled:opacity-40"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Muat ulang
            </button>
          </div>

          {!realtimeLive && !loading && (
            <div className="rounded-xl border border-aici-warning bg-aici-warning-bg px-4 py-2.5 text-xs font-medium text-aici-dark flex items-center gap-2">
              <WifiOff className="w-3.5 h-3.5 text-aici-warning" />
              Realtime terputus — data mungkin basi; auto-reconnect berjalan.
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-aici-error bg-aici-error-bg px-4 py-2.5 text-xs font-medium text-aici-dark">
              Gagal: {error}
              <button
                onClick={() => load()}
                className="ml-2 underline font-semibold"
              >
                Coba lagi
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {(
              [
                ["Total kursi", summary.total],
                ["Terisi", summary.occupied],
                ["Kosong", summary.empty],
                ["Sensor error", summary.unknown],
                ["Data basi", summary.stale],
              ] as const
            ).map(([label, v]) => (
              <div
                key={label}
                className="bg-aici-surface rounded-2xl border border-aici-border/60 shadow-sm p-3.5"
              >
                <p className="text-[11px] text-aici-muted">{label}</p>
                <p className="text-xl font-bold text-aici-dark font-mono">
                  {loading ? "…" : v}
                </p>
              </div>
            ))}
          </div>

          {!loading && rows.length === 0 && (
            <div className="rounded-2xl border border-aici-border/60 bg-aici-surface p-8 text-center text-sm text-aici-muted">
              Tidak ada kursi terpantau di kelas ini.
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 content-start">
              {rows.map((s) => (
                <button
                  key={s.seat_id}
                  onClick={() => select(s.seat_id)}
                  className={`text-left bg-aici-surface rounded-2xl border shadow-sm p-4 transition-colors ${
                    selected === s.seat_id
                      ? "border-aici-dark"
                      : "border-aici-border/60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Armchair className="w-4 h-4 text-aici-dark" />
                    <span className="text-sm font-bold font-mono text-aici-dark">
                      {s.seat_id}
                    </span>
                    <span
                      className={`ml-auto text-[10px] font-bold uppercase rounded-md px-2 py-0.5 ${STATUS_STYLE[s.status]}`}
                    >
                      {s.status}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-aici-muted space-y-0.5">
                    <p className="font-mono text-xs text-aici-dark">
                      {seatWeight(s)}
                    </p>
                    <p>
                      R{s.row_no ?? "?"} · C{s.col_no ?? "?"}
                      {s.device_id ? ` · ${s.device_id}` : " · tanpa device"}
                    </p>
                    <p>Update: {fmtTime(s.updated_at)}</p>
                  </div>
                  {s.stale && (
                    <p className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-aici-warning">
                      <AlertTriangle className="w-3 h-3" />
                      Basi &gt; {s.stale_after_seconds}s tanpa laporan
                    </p>
                  )}
                </button>
              ))}
            </div>

            <div className="bg-aici-surface rounded-2xl border border-aici-border/60 shadow-sm p-5 h-fit xl:sticky xl:top-4">
              {!selected ? (
                <p className="text-sm text-aici-muted">
                  Pilih kursi untuk melihat telemetri &amp; riwayat.
                </p>
              ) : (
                (() => {
                  const s = rows.find((r) => r.seat_id === selected);
                  if (!s) return null;
                  return (
                    <div>
                      <h2 className="text-sm font-bold font-mono text-aici-dark">
                        {s.seat_id}
                      </h2>
                      <dl className="mt-3 space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <dt className="text-aici-muted">Status</dt>
                          <dd
                            className={`font-bold uppercase rounded-md px-2 py-0.5 ${STATUS_STYLE[s.status]}`}
                          >
                            {s.status}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-aici-muted">Berat</dt>
                          <dd className="font-mono font-bold text-aici-dark">
                            {seatWeight(s)} ({s.weight_kg ?? "—"} kg)
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-aici-muted">Terakhir dibaca</dt>
                          <dd className="font-mono">{fmtTime(s.updated_at)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-aici-muted">Perangkat</dt>
                          <dd className="font-mono">
                            {s.device_id ?? "—"}
                            {s.device
                              ? ` (${s.device.status}, terlihat ${fmtTime(s.device.last_seen_at)})`
                              : ""}
                          </dd>
                        </div>
                      </dl>

                      <h3 className="mt-4 text-xs font-bold text-aici-dark">
                        Riwayat perubahan
                      </h3>
                      {!eventsAvail ? (
                        <p className="mt-2 text-xs text-aici-muted">
                          Tabel <code className="font-mono">seat_events</code>{" "}
                          belum dibuat — jalankan{" "}
                          <code className="font-mono">
                            supabase/2026-11-16_seat_events.sql
                          </code>{" "}
                          di SQL Editor.
                        </p>
                      ) : events.length === 0 ? (
                        <p className="mt-2 text-xs text-aici-muted">
                          Belum ada perubahan tercatat.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-1.5 text-xs max-h-64 overflow-auto">
                          {events.map((e) => (
                            <li
                              key={e.event_id}
                              className="flex flex-wrap items-center gap-x-2 border border-aici-border rounded-lg px-2.5 py-1.5"
                            >
                              <span className="font-mono text-aici-muted">
                                {fmtTime(e.created_at)}
                              </span>
                              <span className="font-mono">
                                {e.old_status ?? "∅"} →{" "}
                                <b>{e.new_status}</b>
                              </span>
                              {e.weight_kg != null && (
                                <span className="font-mono text-aici-muted">
                                  {Math.round(e.weight_kg * 1000)} g
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()
              )}
            </div>
          </div>

          <p className="text-[11px] text-aici-muted">
            Lihat integrasi firmware:{" "}
            <Link
              href="#"
              className="underline"
              onClick={(e) => e.preventDefault()}
            >
              esp32Loadcell_WiFi/esp32Loadcell_WiFi.ino
            </Link>
          </p>
        </main>
      </div>
    </div>
  );
}