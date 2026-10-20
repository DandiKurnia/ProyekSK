import { NextResponse } from "next/server";

// Proxy server-to-server ke face-service lokal (YuNet + SFace).
// Browser tidak langsung hit :8200 agar bebas masalah CORS/origin.
const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8200";

export async function GET() {
  try {
    const res = await fetch(`${FACE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        status: "offline",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
