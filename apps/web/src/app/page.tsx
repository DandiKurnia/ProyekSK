"use client";

import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { KpiGrid, SeatOccupancyCard } from "@/components/KpiCards";
import {
  DeviceHealthCard,
  TwoFactorDistributionCard,
} from "@/components/DetailCards";
import type { OverviewSummary } from "@/lib/overview";
import { supabase } from "@/lib/supabase";

function todayJakarta(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(
    new Date()
  );
}

export default function OverviewPage() {
  const [classId, setClassId] = useState<string | null>(null);
  const [date] = useState<string>(todayJakarta());
  const [data, setData] = useState<OverviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeLive, setRealtimeLive] = useState(true);

  const load = useCallback(
    async (cid?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          date,
          ...(cid || classId ? { class_id: (cid ?? classId) as string } : {}),
        });
        const res = await fetch(
          `/api/dashboard/overview-summary?${params.toString()}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as OverviewSummary;
        setData(json);
        // Klas pertama jadi kelas default (prd-overview.md §1)
        if (!cid && !classId && json.class_id) setClassId(json.class_id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [date, classId]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, date]);

  // Realtime postgres_changes → refetch ringan (prd-index.md §3,
  // prd-admin-dashboard-full.md §7). Tanpa WebSocket gateway custom.
  useEffect(() => {
    if (!classId) return;
    const channel = supabase
      .channel(`overview-${classId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendance" },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seat_status" },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "devices" },
        () => load()
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeLive(true);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          setRealtimeLive(false);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [classId, load]);

  return (
    <div className="flex min-h-screen">
      <Sidebar active="Overview" />
      <div className="flex-1 min-w-0">
        <Topbar
          classes={data?.classes ?? []}
          activeClassId={classId}
          onClassChange={(id) => setClassId(id)}
          realtimeLive={realtimeLive}
          onRefresh={() => load()}
          refreshing={loading}
        />

        {!realtimeLive && (
          <div className="mx-5 mt-4 rounded-xl border border-aici-warning bg-aici-warning-bg px-4 py-2.5 text-xs font-medium text-aici-dark">
            Realtime terputus — menampilkan data terakhir. Mencoba menyambung
            kembali…
          </div>
        )}

        {error && (
          <div className="mx-5 mt-4 rounded-xl border border-aici-error bg-aici-error-bg px-4 py-2.5 text-xs font-medium text-aici-dark">
            Gagal memuat data: {error}{" "}
            <button
              onClick={() => load()}
              className="ml-2 underline font-semibold"
            >
              Coba lagi
            </button>
          </div>
        )}

        <main className="p-5 space-y-4 w-full">
          {/* Row 1: KPI cards full width */}
          <KpiGrid data={data} loading={loading} />

          {/* Row 2: device health + 2FA + okupansi (kolom okupansi compact 320px) */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1.4fr_1.1fr_320px] gap-4">
            <DeviceHealthCard data={data} loading={loading} />
            <TwoFactorDistributionCard data={data} loading={loading} />
            <div className="md:col-span-2 xl:col-span-1">
              <SeatOccupancyCard data={data} loading={loading} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
