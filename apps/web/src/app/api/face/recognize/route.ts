import { NextResponse } from "next/server";

// POST /api/face/recognize { image_base64, min_confidence? }
// Diteruskan apa adanya ke POST :8200/recognize (contract: face-recognition.md).
const FACE_URL = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8200";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      image_base64?: string;
      min_confidence?: number;
      margin?: number;
    };
    if (!body.image_base64) {
      return NextResponse.json(
        { error: "image_base64 wajib diisi" },
        { status: 400 }
      );
    }
    const res = await fetch(`${FACE_URL}/recognize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image_base64: body.image_base64,
        ...(body.min_confidence !== undefined
          ? { min_confidence: body.min_confidence }
          : {}),
        ...(body.margin !== undefined ? { margin: body.margin } : {}),
      }),
      signal: AbortSignal.timeout(25000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        match: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
