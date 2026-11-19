import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-session";

// Logout: menghapus cookie sesi di sisi server (PRD auth §3).
export async function POST() {
  const session = await supabaseSession();
  await session.auth.signOut();
  return NextResponse.json({ ok: true });
}
