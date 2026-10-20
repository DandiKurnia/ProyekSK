import { createClient } from "@supabase/supabase-js";

// Server-only. Service role melewati RLS — aman dipakai di Route Handler
// karena secret tidak pernah dikirim ke browser. RLS per-role dikunci
// belakangan setelah UI stabil (lihat docs/database.md § Catatan Implementasi).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

if (!url || !secret) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY belum di-set");
}

export const supabaseServer = createClient(url, secret, {
  auth: { persistSession: false },
});
