import { NextResponse } from "next/server";
// GET /api/fingerprint/status — pantau kesehatan ESP32 + R503 via jembatan USB Serial.
// 503 bila kabel/port belum terhubung agar UI menampilkan banner masalah hardware, bukan nilai nol.
export const dynamic = "force-dynamic";

const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8000";

export async function GET() {
  try {
    const res = await fetch(`${FACE_URL}/fingerprint/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`face-service HTTP ${res.status}`);
    const data = await res.json();
    if (!data.connected) {
      return NextResponse.json({ ...data, error: "fingerprint tidak terhubung" }, { status: 503 });
    }
    return NextResponse.json(data);
  } catch (err: unknown) {
    return NextResponse.json(
      { connected: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
