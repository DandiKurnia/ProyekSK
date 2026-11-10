import { NextResponse } from "next/server";
// POST /api/fingerprint/session { student_id, slot, ttl? }
// Buka jendela 2FA lokal saat wajah terkunci.
export const dynamic = "force-dynamic";

const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8000";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${FACE_URL}/fingerprint/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function GET() {
  try {
    const res = await fetch(`${FACE_URL}/fingerprint/session`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    return NextResponse.json(
      { state: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function DELETE() {
  try {
    const res = await fetch(`${FACE_URL}/fingerprint/session`, {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
