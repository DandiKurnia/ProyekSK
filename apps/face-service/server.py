"""FastAPI local service untuk face recognition (YuNet + SFace).

Jalan di komputer kelas lokal (port 8200). Hanya diakses localhost/LAN kelas.
Contract PRD: ObsidianAllProgramSK/docs/face-recognition.md

Jalankan:
  uvicorn server:app --app-dir apps/face-service --host 127.0.0.1 --port 8200
"""

# --- IMPORT LIBRARY ---
import base64  # Decode teks base64 (kiriman webcam browser) jadi byte biner
from typing import List, Optional  # Tipe untuk validasi skema request/response

import cv2  # OpenCV: ubah byte gambar jadi matriks piksel BGR
import numpy as np  # NumPy: tampung byte mentah sebelum didecode OpenCV
from fastapi import FastAPI, HTTPException, status  # Framework API + kode error HTTP (400/404/422)
from fastapi.middleware.cors import CORSMiddleware  # Izinkan browser akses lintas port (3000 -> 8200)
from pydantic import BaseModel, Field  # Validasi otomatis body JSON + dokumentasi Swagger

import face_engine as fe  # Modul visi lokal: YuNet detect, SFace embed, cosine match, baca/tulis .npz

# --- INISIALISASI APLIKASI FASTAPI ---
app = FastAPI(
    title="Smart Classroom - Face Recognition Service",  # Nama layanan di halaman /docs
    description="YuNet-live + SFace-on-demand local vision service",  # Ringkasan di Swagger
    version="1.0.0",  # Versi API
)

# --- KONFIGURASI CORS (KEAMANAN AKSES BROWSER) ---
# Batasi hanya localhost dan origin dashboard Next.js (port 3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Izinkan fetch dari frontend Next.js lokal
        "http://127.0.0.1:3000",  # Varian alamat IP lokal
    ],
    allow_credentials=True,  # Izinkan cookie/header autentikasi bila ada
    allow_methods=["*"],  # Izinkan semua metode HTTP (GET, POST, DELETE)
    allow_headers=["*"],  # Izinkan semua header (Content-Type, dsb.)
)

# Muat database embedding wajah (`embeddings_yunet.npz`) ke RAM sekali saat server nyala.
# Struktur `db`: dict {"student_id": np.ndarray shape (128,)}; tidak ada foto yang disimpan.
db = fe.load_db()


# --- FUNGSI BANTU: DECODE GAMBAR BASE64 -> MATRIKS OPENCV ---
def _decode_b64(b64_str: str) -> np.ndarray:
    try:
        # Handle data URL bila ada (data:image/jpeg;base64,...)
        if "," in b64_str:
            b64_str = b64_str.split(",", 1)[1]  # Ambil isi base64 setelah koma pertama
        raw = base64.b64decode(b64_str)  # Teks base64 -> byte biner JPEG/PNG
        arr = np.frombuffer(raw, dtype=np.uint8)  # Byte -> array 1D uint8 (0-255)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)  # Decode jadi matriks BGR 3-channel
        if img is None:  # imdecode mengembalikan None bila file bukan gambar valid
            raise ValueError("Gambar rusak / format tidak didukung")
        return img  # Gambar siap masuk YuNet
    except Exception as e:
        # Semua kegagalan decode -> HTTP 400, bukan crash 500
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Gagal decode gambar: {e}",
        )


# --- SKEMA DATA (PYDANTIC MODELS) UNTUK KONTRAK JSON ---

# Format balikan GET /health
class HealthResponse(BaseModel):
    status: str = "ok"  # Penanda server hidup
    models: dict  # Versi detektor (YuNet) & recognizer (SFace)
    oval: dict  # {"rx": float, "ry": float} — geometri oval panduan terkini
    registered_faces: int  # Jumlah siswa punya vektor di .npz
    students: List[str]  # Daftar student_id terdaftar (urut abjad)


# Format input POST /recognize
class RecognizeRequest(BaseModel):
    image_base64: str = Field(..., description="JPEG/PNG base64")  # Wajib (`...`) diisi
    min_confidence: Optional[float] = Field(
        default=fe.THRESHOLD,  # Default 0.40 bila klien tidak mengirim
        description="Ambang batas cosine similarity (default 0.40)",
    )
    margin: Optional[float] = Field(
        default=fe.MARGIN,  # Default 0.08 (selisih minimal juara 1 vs juara 2)
        description="Selisih minimal skor juara 1 vs juara 2 (default 0.08)",
    )


# Format balikan POST /recognize
class RecognizeResponse(BaseModel):
    faces_detected: int  # Jumlah wajah yang tertangkap YuNet dalam frame
    face_in_frame: bool = True  # False = wajah terpotong tepi frame (belum dihitung terdeteksi)
    match: bool  # True bila cocok dengan salah satu siswa di .npz
    student_id: Optional[str] = None  # NIS yang cocok; None bila gagal/tidak dikenal
    confidence: float  # Skor cosine tertinggi (0.0-1.0)
    threshold_used: float  # Ambang yang dipakai pada pengecekan ini
    reason: Optional[str] = None  # "no_face" | "partial_face" | "face_outside_oval" | "below_threshold" | "ambiguous" | None


# Format input POST /enroll
class EnrollRequest(BaseModel):
    student_id: str = Field(..., min_length=1, description="NIS / identifier siswa")  # Wajib, tidak kosong
    images_base64: List[str] = Field(
        ..., min_items=1, max_items=10,  # Wajib 1-10 sampel frame
        description="1-10 sampel frame wajah",
    )


# Format balikan POST /enroll
class EnrollResponse(BaseModel):
    student_id: str  # NIS yang baru didaftarkan
    enrolled: bool  # True bila berhasil disimpan ke .npz
    samples_used: int  # Jumlah frame yang lolos (wajah ada, utuh, di dalam oval)
    samples_skipped: int = 0  # Frame yang dibuang (tanpa wajah / terpotong / di luar oval)
    total_registered: int  # Total siswa di .npz setelah enroll selesai


# --- ENDPOINT 1: CEK KESEHATAN SERVICE ---
@app.get("/health", response_model=HealthResponse)
def health():
    return {
        "status": "ok",  # Server merespons
        "models": fe.MODEL_VERSIONS,  # {"detector": "yunet_2023mar", "recognizer": "sface_2021dec"}
        # Geometri oval: `ry` = setengah tinggi (fraksi tinggi frame),
        # `aspect` = lebar:tinggi dalam piksel (0.75 = portrait 3:4). Klien menghitung
        # lebar = 2*ry*h/w*aspect agar bentuk oval sama di semua resolusi.
        "oval": {"rx": fe.GUIDE_RX, "ry": fe.GUIDE_RY, "aspect": fe.GUIDE_ASPECT},
        "registered_faces": len(db),  # Jumlah key di dict `db`
        "students": sorted(list(db.keys())),  # Daftar NIS terurut
    }


# --- ENDPOINT 2: KENALI WAJAH DARI 1 FRAME WEBCAM ---
@app.post("/recognize", response_model=RecognizeResponse)
def recognize(req: RecognizeRequest):
    img = _decode_b64(req.image_base64)  # 1. Base64 kiriman -> gambar BGR OpenCV
    faces = fe.detect(img)  # 2. Deteksi semua wajah pakai YuNet
    if not faces:  # 3. Tidak ada wajah sama sekali di frame:
        return {
            "faces_detected": 0,
            "face_in_frame": False,
            "match": False,
            "student_id": None,
            "confidence": 0.0,
            "threshold_used": req.min_confidence,
            "reason": "no_face",  # UI bisa tampilkan "wajah tidak terdeteksi"
        }

    face = fe.biggest(faces)  # 4. Ambil wajah terluas (paling dekat kamera)
    quality = fe.face_quality(img, face)  # 5. Kotak wajah utuh + masuk oval?
    h, w = img.shape[:2]  # Ukuran frame untuk normalisasi koordinat
    x, y, bw, bh = [float(v) for v in face[:4]]
    fe.log_oval((x + bw / 2) / w, (y + bh / 2) / h, bw / w, bh / h, quality, "pending")
    if not quality["in_frame"]:  # Setengah wajah: belum terdeteksi (landmark separuh -> skor sampah)
        return {
            "faces_detected": len(faces),
            "face_in_frame": False,
            "match": False,
            "student_id": None,
            "confidence": 0.0,
            "threshold_used": req.min_confidence,
            "reason": "partial_face",  # UI: "posisikan wajah penuh di dalam oval"
        }
    if not quality["in_guide"]:  # Wajah di luar oval panduan: UI merah, scan ditolak
        return {
            "faces_detected": len(faces),
            "face_in_frame": True,
            "match": False,
            "student_id": None,
            "confidence": 0.0,
            "threshold_used": req.min_confidence,
            "reason": "face_outside_oval",  # UI: "masuk ke dalam oval"
        }

    emb = fe.embed(img, face)  # 6. Align 112x112 + ekstrak vektor 128 angka (SFace)
    margin_val = req.margin if req.margin is not None else fe.MARGIN  # Jaga margin tidak None
    name, score = fe.recognize(  # 7. Cosine vs semua siswa di `db` (threshold + margin)
        emb, db, threshold=req.min_confidence, margin=margin_val
    )

    if name is not None:  # 8. Lolos ambang (>=0.40) DAN lolos margin (>=0.08):
        return {
            "faces_detected": len(faces),
            "face_in_frame": True,
            "match": True,
            "student_id": name,  # NIS pemenang
            "confidence": round(score, 4),  # Bulatkan 4 desimal
            "threshold_used": req.min_confidence,
            "reason": None,
        }
    # 9. Gagal cocok: skor di bawah ambang, atau mirip 2 orang (selisih juara 1-2 < margin)
    reason = "below_threshold" if score < req.min_confidence else "ambiguous"
    return {
        "faces_detected": len(faces),
        "face_in_frame": True,
        "match": False,
        "student_id": None,
        "confidence": round(score, 4) if score >= 0 else 0.0,  # db kosong -> score -1 -> tulis 0.0
        "threshold_used": req.min_confidence,
        "reason": reason,
    }


# --- ENDPOINT 3: PENDAFTARAN (ENROLL) WAJAH SISWA BARU ---
@app.post("/enroll", response_model=EnrollResponse)
def enroll(req: EnrollRequest):
    student_id = req.student_id.strip()  # Buang spasi tak sengaja di ujung NIS
    if not student_id:  # Isinya hanya spasi -> tolak HTTP 400
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="student_id tidak boleh kosong",
        )

    valid_samples = 0  # Hitung foto yang benar-benar ada wajahnya
    skipped = 0  # Sampel lolos deteksi tapi di luar oval / terpotong
    for idx, b64 in enumerate(req.images_base64):
        img = _decode_b64(b64)  # Decode foto ke-idx
        faces = fe.detect(img)  # Cari wajah dengan YuNet
        if not faces:  # Foto tanpa wajah -> lewati, jangan gagalkan seluruh request
            skipped += 1
            continue
        face = fe.biggest(faces)  # Ambil wajah terluas di foto itu
        q = fe.face_quality(img, face)  # Aturan sama dengan /recognize: utuh + di dalam oval
        if not q["in_frame"] or not q["in_guide"]:
            skipped += 1  # Wajah terpotong tepi / di luar oval -> sampel dibuang
            continue
        emb = fe.embed(img, face)  # Ekstrak vektor 128-d (SFace)
        fe.enroll_embedding(db, student_id, emb)  # Rata-rata + L2 normalize ke db[student_id]
        valid_samples += 1  # Sampel valid bertambah
    if valid_samples == 0:  # Tidak satu pun foto berisi wajah -> 422 (body valid, isi tak bisa diproses)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Tidak ada wajah valid yang terdeteksi dari seluruh sampel ({skipped} ditolak: wajah kosong/terpotong/di luar oval)",
        )

    fe.save_db(db)  # Tulis dict `db` terbaru ke `embeddings_yunet.npz`
    return {
        "student_id": student_id,
        "enrolled": True,
        "samples_used": valid_samples,
        "samples_skipped": skipped,
        "total_registered": len(db),
    }


# --- ENDPOINT 4: HAPUS DATA WAJAH SISWA (HAPUS SISWA / ROLLBACK ENROLL) ---
@app.delete("/enroll/{student_id}")
def delete_enrollment(student_id: str):
    # delete_student() menghapus key + menyimpan ulang .npz; False bila key tidak ada.
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
