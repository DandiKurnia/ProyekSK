import { Sidebar } from "@/components/Sidebar";
import { LiveRefresher } from "@/components/LiveRefresher";
import { supabaseServer } from "@/lib/supabase-server";
import { Cpu, Wifi, WifiOff } from "lucide-react";

export const dynamic = "force-dynamic";

// SEMENTARA: layar verifikasi board. Satu kartu per folder board
// (esp32R503_Standalone, esp32RFID_Standalone, esp32Seat_LoadCell,
// esp32DHT_Ingest) berisi baris terakhir yang dikirim tiap device.
// Diganti halaman Device Monitoring sesuai PRD setelah UI final.

type Row = Record<string, unknown>;
type Board = {
  folder: string;
  title: string;
  deviceId: string;
  table: string;
  columns: string[];
  rows: Row[];
  related?: { label: string; columns: string[]; rows: Row[] };
  empty: string;
};

const STALE_MS = 2 * 60 * 1000; // 2× heartbeat board

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return new Date(v).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return String(v);
}

function BoardCard({
  board,
  status,
  lastSeen,
}: {
  board: Board;
  status?: string;
  lastSeen?: string | null;
}) {
  const stale = !lastSeen || Date.now() - new Date(lastSeen).getTime() > STALE_MS;
  const online = !stale && status !== "offline";

  return (
    <section className="rounded-2xl border border-aici-border-dark bg-aici-surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-aici-border">
        <Cpu className="w-4 h-4 text-aici-muted shrink-0" />
        <h2 className="text-sm font-bold text-aici-dark">{board.title}</h2>
        <code className="text-[11px] font-mono text-aici-muted bg-aici-surface-nested border border-aici-border-dark rounded px-1.5 py-0.5">
          {board.folder}
        </code>
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded px-1.5 py-0.5 border ${
            online
              ? "text-aici-success border-aici-success bg-aici-success-bg"
              : "text-aici-error border-aici-error bg-aici-error-bg"
          }`}
          title={lastSeen ? `update terakhir: ${fmt(lastSeen)}` : "belum pernah mengirim"}
        >
          {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {online ? "Online" : "Belum ada data"}
        </span>
        <span className="text-[11px] font-mono text-aici-muted">{board.deviceId}</span>
        <span className="ml-auto text-[11px] font-mono text-aici-muted">
          {board.rows.length} baris · {board.table}
        </span>
      </div>

      {board.rows.length === 0 ? (
        <p className="px-4 py-5 text-xs text-aici-muted">{board.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-aici-surface-nested text-left">
                {board.columns.map((c) => (
                  <th key={c} className="px-4 py-2 font-semibold text-aici-muted whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.rows.map((r, i) => (
                <tr key={i} className="border-t border-aici-border hover:bg-aici-surface-nested">
                  {board.columns.map((c) => (
                    <td key={c} className="px-4 py-2 font-mono text-aici-dark whitespace-nowrap">
                      {fmt(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {board.related && board.related.rows.length > 0 && (
        <div className="border-t border-aici-border">
          <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-aici-muted uppercase tracking-wide">
            {board.related.label}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody>
                {board.related.rows.map((r, i) => (
                  <tr key={i} className="border-t border-aici-border">
                    {board.related!.columns.map((c) => (
                      <td key={c} className="px-4 py-2 font-mono text-aici-muted whitespace-nowrap">
                        {fmt(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export default async function BoardDataPage() {
  const [devices, fp, rfid, seats, env, cards] = await Promise.all([
    supabaseServer
      .from("devices")
      .select("device_id, name, type, status, last_seen_at")
      .in("device_id", ["FP-STANDALONE-01", "EDGE-01", "SEAT-ESP-01", "ENV-XII-RPL-1"]),
    supabaseServer
      .from("fingerprint_events")
      .select("created_at, slot_id, confidence, status")
      .eq("device_id", "FP-STANDALONE-01")
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseServer
      .from("rfid_events")
      .select("created_at, uid, status")
      .eq("device_id", "EDGE-01")
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseServer
      .from("seat_status")
      .select("updated_at, status, weight_kg, seats!inner ( seat_id, device_id, class_id )")
      .eq("seats.device_id", "SEAT-ESP-01")
      .order("updated_at", { ascending: false })
      .limit(20),
    supabaseServer
      .from("classroom_env")
      .select("device_id, class_id, temperature_c, humidity_pct, updated_at")
      .eq("device_id", "ENV-XII-RPL-1")
      .limit(20),
    supabaseServer.from("rfid_cards").select("uid, student_id").limit(20),
  ]);

  const dev = (id: string) =>
    ((devices.data ?? []) as Row[]).find((d) => d.device_id === id) ?? {};

  const boards: Board[] = [
    {
      folder: "esp32R503_Standalone",
      title: "Verifikasi sidik jari (R503)",
      deviceId: "FP-STANDALONE-01",
      table: "fingerprint_events",
      columns: ["created_at", "slot_id", "confidence", "status"],
      rows: (fp.data ?? []) as Row[],
      empty: "Belum ada verifikasi. Tempel jari ke R503 → event masuk ke sini saat realtime.",
    },
    {
      folder: "esp32RFID_Standalone",
      title: "Tap kartu RFID (RC522)",
      deviceId: "EDGE-01",
      table: "rfid_events",
      columns: ["created_at", "uid", "status", "student_id"],
      rows: ((rfid.data ?? []) as Row[]).map((r) => ({
        created_at: r.created_at,
        uid: r.uid,
        status: r.status,
        student_id:
          ((cards.data ?? []) as Row[]).find((c) => c.uid === r.uid)
            ?.student_id ?? "—",
      })),
      related: {
        label: `Kartu terdaftar (rfid_cards) — ${cards.data?.length ?? 0}`,
        columns: ["uid", "student_id"],
        rows: (cards.data ?? []) as Row[],
      },
      empty: "Belum ada tap kartu. Tempel kartu ke RC522 → event masuk ke sini.",
    },
    {
      folder: "esp32Seat_LoadCell",
      title: "Okupansi kursi (HX711)",
      deviceId: "SEAT-ESP-01",
      table: "seat_status",
      columns: ["updated_at", "seat_id", "status", "weight_kg"],
      rows: ((seats.data ?? []) as Row[]).map((r) => {
        const s = (r.seats ?? {}) as Row;
        return { ...r, seat_id: s.seat_id, class_id: s.class_id, seats: undefined };
      }),
      empty: "Belum ada pembacaan. Letakkan beban di kursi → status masuk ke sini.",
    },
    {
      folder: "esp32DHT_Ingest",
      title: "Suhu & kelembaban ruang (DHT)",
      deviceId: "ENV-XII-RPL-1",
      table: "classroom_env",
      columns: ["updated_at", "temperature_c", "humidity_pct", "class_id"],
      rows: (env.data ?? []) as Row[],
      empty: "Belum ada pembacaan. Board DHT mengirim tiap 30 detik setelah WiFi tersambung.",
    },
  ];

  const errors = [devices, fp, rfid, seats, env, cards]
    .map((q) => q.error)
    .find(Boolean);

  return (
    <div className="flex min-h-screen bg-aici-canvas">
      <Sidebar active="Device Monitoring" />
      <div className="flex-1 min-w-0">
        <header className="pl-16 lg:px-5 pr-4 py-3 bg-aici-surface border-b border-aici-border">
          <nav className="text-sm flex items-center gap-2 min-w-0">
            <span className="font-medium text-aici-muted hidden sm:inline">AICI Center</span>
            <span className="mx-1 text-aici-muted hidden sm:inline">›</span>
            <span className="font-semibold text-aici-dark">
              Device Monitoring — output board (sementara)
            </span>
          </nav>
        </header>

        <main className="p-5 space-y-4 w-full">
          <LiveRefresher
            tables={["fingerprint_events", "rfid_events", "seat_status", "classroom_env"]}
          />

          {errors && (
            <div className="rounded-xl border border-aici-error bg-aici-error-bg px-4 py-2.5 text-xs font-medium text-aici-dark">
              Gagal memuat: {errors.message}
            </div>
          )}

          {boards.map((b) => {
            const d = dev(b.deviceId);
            return (
              <BoardCard
                key={b.folder}
                board={b}
                status={d.status as string | undefined}
                lastSeen={b.rows.length > 0 ? (b.rows[0].updated_at ?? b.rows[0].created_at) as string : null}
              />
            );
          })}

          <p className="text-[11px] text-aici-muted px-1">
            Data dibaca langsung dari Supabase (service role, server-only). Kartu berubah
            otomatis saat board mengirim — tanpa refresh manual.
          </p>
        </main>
      </div>
    </div>
  );
}
