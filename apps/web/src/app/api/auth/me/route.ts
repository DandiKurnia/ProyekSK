import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-session";
import { supabaseServer } from "@/lib/supabase-server";

// Identitas staf untuk UI. Role diambil dari tabel profiles (bukan klien),
// sesuai PRD auth §4.2. Akun tanpa profil aktif ditolak.
export async function GET() {
  const session = await supabaseSession();
  const {
    data: { user },
  } = await session.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: profile, error } = await supabaseServer
    .from("profiles")
    .select("email, full_name, role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: "profil tidak ditemukan" }, { status: 403 });
  }
  if (!profile.is_active) {
    return NextResponse.json({ error: "Akun dinonaktifkan, hubungi administrator" }, { status: 403 });
  }

  return NextResponse.json({
    user_id: user.id,
    email: profile.email,
    full_name: profile.full_name,
    role: profile.role,
  });
}
