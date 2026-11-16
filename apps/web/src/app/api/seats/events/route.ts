import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// GET /api/seats/events?seat_id=SEAT-01&limit=20 — riwayat perubahan
// (prd-classes-seats.md §2.3: paginasi per kursi).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seatId = searchParams.get("seat_id");
    if (!seatId)
      return NextResponse.json(
        { error: "seat_id wajib diisi" },
        { status: 400 }
      );

    const limit = Math.min(
      Math.max(Number(searchParams.get("limit") ?? 20) || 20, 1),
      100
    );
    const { data, error } = await supabaseServer
      .from("seat_events")
      .select("event_id, old_status, new_status, weight_kg, created_at")
      .eq("seat_id", seatId)
      .order("created_at", { ascending: false })
      .limit(limit);

    // Tabel belum dibuat (supabase/2026-11-16_seat_events.sql):
    // riwayat kosong, panel web menampilkan pesan.
    if (error && (error as { code?: string }).code === "PGRST205")
      return NextResponse.json({
        seat_id: seatId,
        events: [],
        available: false,
      });
    if (error) throw error;

    return NextResponse.json({
      seat_id: seatId,
      events: data ?? [],
      available: true,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}