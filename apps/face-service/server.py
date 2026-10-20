"""FastAPI local service untuk face recognition (YuNet + SFace).

Jalan di komputer kelas lokal (port 8200). Hanya diakses localhost/LAN kelas.
Contract PRD: ObsidianAllProgramSK/docs/face-recognition.md

Jalankan:
  uvicorn server:app --app-dir apps/face-service --host 127.0.0.1 --port 8200
"""

import base64
from typing import List, Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import face_engine as fe

app = FastAPI(
    title="Smart Classroom - Face Recognition Service",
    description="YuNet-live + SFace-on-demand local vision service",
    version="1.0.0",
)

# Batasi hanya localhost dan origin dashboard Next.js (port 3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db = fe.load_db()


def _decode_b64(b64_str: str) -> np.ndarray:
    try:
        # Handle data URL bila ada (data:image/jpeg;base64,...)
        if "," in b64_str:
            b64_str = b64_str.split(",", 1)[1]
        raw = base64.b64decode(b64_str)
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Gambar rusak / format tidak didukung")
        return img
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Gagal decode gambar: {e}",
        )


class HealthResponse(BaseModel):
    status: str = "ok"
    models: dict
    registered_faces: int
    students: List[str]


class RecognizeRequest(BaseModel):
    image_base64: str = Field(..., description="JPEG/PNG base64")
    min_confidence: Optional[float] = Field(
        default=fe.THRESHOLD,
        description="Ambang batas cosine similarity (default 0.40)",
    )
    margin: Optional[float] = Field(
        default=fe.MARGIN,
        description="Selisih minimal skor juara 1 vs juara 2 (default 0.08)",
    )


class RecognizeResponse(BaseModel):
    faces_detected: int
    match: bool
    student_id: Optional[str] = None
    confidence: float
    threshold_used: float
    reason: Optional[str] = None


class EnrollRequest(BaseModel):
    student_id: str = Field(..., min_length=1, description="NIS / identifier siswa")
    images_base64: List[str] = Field(
        ..., min_items=1, max_items=10,
        description="1-10 sampel frame wajah",
    )


class EnrollResponse(BaseModel):
    student_id: str
    enrolled: bool
    samples_used: int
    total_registered: int


@app.get("/health", response_model=HealthResponse)
def health():
    return {
        "status": "ok",
        "models": fe.MODEL_VERSIONS,
        "registered_faces": len(db),
        "students": sorted(list(db.keys())),
    }


@app.post("/recognize", response_model=RecognizeResponse)
def recognize(req: RecognizeRequest):
    img = _decode_b64(req.image_base64)
    faces = fe.detect(img)
    if not faces:
        return {
            "faces_detected": 0,
            "match": False,
            "student_id": None,
            "confidence": 0.0,
            "threshold_used": req.min_confidence,
            "reason": "no_face",
        }

    face = fe.biggest(faces)
    emb = fe.embed(img, face)
    margin_val = req.margin if req.margin is not None else fe.MARGIN
    name, score = fe.recognize(
        emb, db, threshold=req.min_confidence, margin=margin_val
    )

    if name is not None:
        return {
            "faces_detected": len(faces),
            "match": True,
            "student_id": name,
            "confidence": round(score, 4),
            "threshold_used": req.min_confidence,
            "reason": None,
        }
    reason = "below_threshold" if score < req.min_confidence else "ambiguous"
    return {
        "faces_detected": len(faces),
        "match": False,
        "student_id": None,
        "confidence": round(score, 4) if score >= 0 else 0.0,
        "threshold_used": req.min_confidence,
        "reason": reason,
    }


@app.post("/enroll", response_model=EnrollResponse)
def enroll(req: EnrollRequest):
    student_id = req.student_id.strip()
    if not student_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="student_id tidak boleh kosong",
        )

    valid_samples = 0
    for idx, b64 in enumerate(req.images_base64):
        img = _decode_b64(b64)
        faces = fe.detect(img)
        if not faces:
            continue
        face = fe.biggest(faces)
        emb = fe.embed(img, face)
        fe.enroll_embedding(db, student_id, emb)
        valid_samples += 1

    if valid_samples == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tidak ada wajah valid yang terdeteksi dari seluruh sampel",
        )

    fe.save_db(db)
    return {
        "student_id": student_id,
        "enrolled": True,
        "samples_used": valid_samples,
        "total_registered": len(db),
    }


@app.delete("/enroll/{student_id}")
def delete_enrollment(student_id: str):
    if not fe.delete_student(db, student_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Siswa '{student_id}' tidak ditemukan di database lokal",
        )
    return {
        "student_id": student_id,
        "deleted": True,
        "total_registered": len(db),
    }
