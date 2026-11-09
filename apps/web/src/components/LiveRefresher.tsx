"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Sengaja re-render penuh (router.refresh) tiap ada baris baru: satu jalur
// kode, tidak ada state duplikat di klien. Halaman ini layar verifikasi,
// bukan UI produksi — jadi cukup.
export function LiveRefresher({ tables }: { tables: string[] }) {
  const router = useRouter();

  useEffect(() => {
    const ch = supabase.channel("device-data-live");
    for (const table of tables) {
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => router.refresh()
      );
    }
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [router, tables]);

  return null;
}
