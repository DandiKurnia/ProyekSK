"use client";

import { useEffect, useState } from "react";
import { Save, ShieldAlert, CheckCircle2 } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

type Config = Record<string, unknown>;
type Field =
  | {
      key: string;
      label: string;
      kind: "time" | "number" | "text";
      hint?: string;
      step?: string;
    }
  | {
      key: string;
      label: string;
      kind: "window";
      hint?: string;
    };

// Hanya key yang benar-benar dibaca Route Handler (docs/database.md §13).
const GROUPS: { title: string; desc: string; fields: Field[] }[] = [
  {
    title: "Aturan Absensi",
    desc: "Dipakai POST /api/attendance saat menentukan status & jendela sah.",
    fields: [
      {
        key: "late_threshold",
        label: "Batas terlambat",
        kind: "time",
        hint: "Check-in setelah jam ini = late (WIB).",
      },
      {
        key: "checkout_after",
        label: "Mulai jam pulang",
        kind: "time",
        hint: "Scan setelah jam ini dicatat sebagai check-out.",
      },
      {
        key: "attendance_window",
        label: "Jendela absensi sah",
        kind: "window",
        hint: "Di luar rentang ini check-in ditolak.",
      },
      {
        key: "verification_timeout",
        label: "Timeout verifikasi 2FA",
        kind: "number",
        step: "1",
        hint: "Detik menunggu faktor kedua sebelum sesi hangus.",
      },
    ],
  },
  {
    title: "Perangkat & Sensor",
    desc: "Ambang telemetri; dibaca Overview dan pipeline sensor.",
    fields: [
      {
        key: "device_offline_seconds",
        label: "Ambang offline perangkat",
        kind: "number",
        step: "1",
        hint: "Detik tanpa heartbeat sebelum ditandai offline.",
      },
      {
        key: "seat_hysteresis_seconds",
        label: "Histeresis kursi",
        kind: "number",
        step: "1",
        hint: "Detik beban harus stabil sebelum status kursi berubah.",
      },
      {
        key: "seat_occupied_kg",
        label: "Ambang beban kursi",
        kind: "number",
        step: "0.1",
        hint: "Kilogram minimum agar kursi dianggap terisi.",
      },
    ],
  },
  {
    title: "Umum",
    desc: "Referensi waktu sistem; semua timestamp disimpan UTC.",
    fields: [
      {
        key: "timezone",
        label: "Zona waktu",
        kind: "text",
        hint: "Nama zona IANA, mis. Asia/Jakarta.",
      },
    ],
  },
];

export default function SettingsPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Config>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Config;
      setCfg(json);
      setDraft(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setField = (key: string, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const changed = Object.keys(draft).filter(
    (k) => JSON.stringify(draft[k]) !== JSON.stringify(cfg?.[k])
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(null);
    const done: string[] = [];
    try {
      for (const key of changed) {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, value: draft[key] }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Berhenti di key pertama yang gagal; sisanya belum tersimpan.
          throw new Error(`${key}: ${json.error ?? res.status}`);
        }
        done.push(key);
      }
      setSaved(done);
      await load();
    } catch (e) {
      setSaved(done.length ? done : null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const windowVal = (k: "start" | "end") =>
    ((draft["attendance_window"] ?? {}) as Record<string, string>)[k] ?? "";

  const setWindow = (k: "start" | "end", v: string) => {
    const cur = (draft["attendance_window"] ?? {}) as Record<string, string>;
    setField("attendance_window", { start: cur.start ?? "", end: cur.end ?? "", [k]: v });
  };

  return (
    <div className="flex min-h-screen bg-[#F6F8FA]">
      <Sidebar active="Settings" />
      <div className="flex-1 min-w-0">
        <Topbar
          classes={[]}
          activeClassId={null}
          onClassChange={() => {}}
          realtimeLive={true}
          onRefresh={load}
          refreshing={loading}
          pageTitle="Settings"
        />

        <main className="p-5 space-y-4 max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-bold text-aici-dark">Konfigurasi Sistem</h1>
              <p className="text-xs text-aici-muted mt-1">
                Tersimpan di <code className="font-mono">app_config</code>; perubahan
                berlaku untuk request berikutnya, tidak retroaktif.
              </p>
            </div>
            <button
              onClick={save}
              disabled={saving || changed.length === 0 || loading}
              className="flex items-center gap-2 bg-aici-dark text-white rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? "Menyimpan…" : `Simpan${changed.length ? ` (${changed.length})` : ""}`}
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-aici-error bg-aici-error-bg px-4 py-2.5 text-xs font-medium text-aici-dark">
              Gagal: {error}
            </div>
          )}
          {saved && saved.length > 0 && !error && (
            <div className="rounded-xl border border-aici-success bg-aici-success-bg px-4 py-2.5 text-xs font-medium text-aici-dark flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-aici-success" />
              Tersimpan: {saved.join(", ")}
            </div>
          )}

          {GROUPS.map((g) => (
            <section
              key={g.title}
              className="bg-aici-surface rounded-2xl border border-aici-border/60 shadow-sm p-5"
            >
              <h2 className="text-sm font-bold text-aici-dark">{g.title}</h2>
              <p className="text-[11px] text-aici-muted mt-0.5 mb-4">{g.desc}</p>

              <div className="space-y-3">
                {g.fields.map((f) => (
                  <div key={f.key} className="flex flex-wrap items-center gap-3">
                    <label className="text-xs font-medium text-aici-dark w-56">
                      {f.label}
                      <span className="block text-[10px] font-mono text-aici-muted">
                        {f.key}
                      </span>
                    </label>

                    {f.kind === "window" ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={windowVal("start")}
                          onChange={(e) => setWindow("start", e.target.value)}
                          className="border border-aici-border-dark rounded-lg px-2.5 py-1.5 text-xs font-mono"
                          aria-label="Jendela absensi mulai"
                        />
                        <span className="text-xs text-aici-muted">s/d</span>
                        <input
                          type="time"
                          value={windowVal("end")}
                          onChange={(e) => setWindow("end", e.target.value)}
                          className="border border-aici-border-dark rounded-lg px-2.5 py-1.5 text-xs font-mono"
                          aria-label="Jendela absensi selesai"
                        />
                      </div>
                    ) : (
                      <input
                        type={f.kind}
                        step={f.kind === "number" ? f.step : undefined}
                        value={String(draft[f.key] ?? "")}
                        onChange={(e) => {
                          const v = e.target.value;
                          setField(f.key, f.kind === "number" && v !== "" ? Number(v) : v);
                        }}
                        className="border border-aici-border-dark rounded-lg px-2.5 py-1.5 text-xs font-mono w-32"
                        aria-label={f.label}
                      />
                    )}

                    {f.hint && (
                      <span className="text-[11px] text-aici-muted">{f.hint}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}

          <section className="bg-aici-surface rounded-2xl border border-aici-border/60 shadow-sm p-5">
            <h2 className="text-sm font-bold text-aici-dark">Belum tersedia</h2>
            <p className="text-[11px] text-aici-muted mt-0.5 mb-3">
              PRD menu 7 §2.2/2.5 — ditandai disabled, bukan pura-pura berfungsi.
            </p>
            <div className="flex items-center gap-2 text-xs text-aici-muted">
              <ShieldAlert className="w-3.5 h-3.5" />
              Manajemen pengguna &amp; role, kredensial perangkat, koreksi manual
              absensi, jendela poll ESP32 — <span className="font-mono">Planned</span>.
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}