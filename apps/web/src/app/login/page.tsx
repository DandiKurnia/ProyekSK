"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck, User } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function LoginPage() {
  const router = useRouter();
  // `next` dibaca dari URL langsung saat submit: halaman tetap statis (tanpa useSearchParams).
  // Pesan sesi berakhir (PRD §4.5) — dibaca setelah mount agar halaman tetap statis.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("expired") === "1") setError("Sesi berakhir, silakan login kembali");
  }, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = supabaseBrowser();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    // Pesan generik: jangan bocorkan identifier vs password (PRD §4.3).
    if (signInError) {
      setLoading(false);
      setError("Email atau password salah");
      return;
    }

    // Role & status akun ditentukan server (PRD §4.2).
    const me = await fetch("/api/auth/me", { cache: "no-store" });
    if (!me.ok) {
      const { error: reason } = await me.json().catch(() => ({ error: null }));
      await supabase.auth.signOut();
      setLoading(false);
      setError(reason ?? "Akun tidak dapat dipakai, hubungi administrator");
      return;
    }

    const next = new URLSearchParams(window.location.search).get("next");
    const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    router.replace(target);
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-[#F6F8FA] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-aici-lime flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-aici-dark" />
          </div>
          <div>
            <p className="text-sm font-bold text-aici-dark leading-tight">AICI Center</p>
            <p className="text-xs text-aici-muted">Smart Classroom AIoT</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-aici-surface rounded-2xl border border-aici-border shadow-sm p-6 space-y-4"
        >
          <div className="space-y-1">
            <h1 className="text-base font-bold text-aici-dark">Masuk ke dashboard</h1>
            <p className="text-xs text-aici-muted">
              Khusus staf terdaftar. Sesi berakhir otomatis setelah tidak aktif.
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-aici-dark">Email</span>
            <div className="flex items-center gap-2 border border-aici-border-dark rounded-xl px-3 py-2 focus-within:border-aici-dark">
              <User className="w-4 h-4 text-aici-muted shrink-0" />
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@sekolah.sch.id"
                className="bg-transparent outline-none text-sm w-full"
              />
            </div>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-aici-dark">Password</span>
            <div className="flex items-center gap-2 border border-aici-border-dark rounded-xl px-3 py-2 focus-within:border-aici-dark">
              <LockKeyhole className="w-4 h-4 text-aici-muted shrink-0" />
              <input
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="bg-transparent outline-none text-sm w-full"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                className="text-aici-muted hover:text-aici-dark shrink-0"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </label>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-aici-error bg-aici-error-bg px-3 py-2 text-xs font-medium text-aici-dark"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-aici-dark text-white rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? "Memeriksa…" : "Masuk"}
          </button>

          <p className="text-[11px] text-aici-muted text-center">
            Lupa password? Hubungi administrator — reset mandiri belum tersedia.
          </p>
        </form>
      </div>
    </div>
  );
}
