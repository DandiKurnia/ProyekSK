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

# --- BAGIAN 2: JEMBATAN SIDIK JARI (USB SERIAL) ---
import threading as _threading  # Pekerja latar untuk enroll sidik jari (bloking 40 dtk)

import fingerprint_serial as fp  # Driver USB Serial: parser baris, antrian perintah, sesi 2FA


# Format input POST /fingerprint/enroll & POST /fingerprint/session
class FingerJob(BaseModel):
    slot: int = Field(..., ge=1, le=200, description="Slot memori sensor 1..200")


class FingerSession(BaseModel):
    student_id: str = Field(..., min_length=1, description="NIS pemilik sesi 2FA")
    slot: int = Field(..., ge=1, le=200, description="Slot sidik jari yang ditunggu")
    ttl: float = Field(30.0, ge=5, le=120, description="Umur sesi dalam detik")


# Satu pekerjaan enroll dalam satu waktu: firmware tidak bisa melayani 2 enroll paralel.
_fp_job = {"active": False, "slot": None, "ok": None, "code": None, "detail": None}
_fp_job_lock = _threading.Lock()


@app.on_event("startup")
def _fp_start():
    fp.bridge.start()  # Buka COM port + thread pembaca; gagal -> auto-retry tiap 2 dtk


@app.on_event("shutdown")
def _fp_stop():
    fp.bridge.stop()


# --- ENDPOINT 5: STATUS PERANGKAT SIDIK JARI ---
@app.get("/fingerprint/status")
def fingerprint_status():
    return fp.bridge.status()


# --- ENDPOINT 6: MULAI ENROLLMENT SIDIK JARI (ASINKRON) ---
@app.post("/fingerprint/enroll", status_code=status.HTTP_202_ACCEPTED)
def fingerprint_enroll(req: FingerJob):
    with _fp_job_lock:
        if _fp_job["active"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Enrollment slot {_fp_job['slot']} masih berjalan",
            )
        if not fp.bridge.connected:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="ESP32 fingerprint tidak terhubung (cek kabel USB / port)",
            )
        _fp_job.update(active=True, slot=req.slot, ok=None, code=None, detail=None)

    def _worker(slot: int):
        hasil = fp.bridge.enroll(slot)  # Blokir maks 40 dtk: tunggu 2x tempel jari
        with _fp_job_lock:
            _fp_job.update(
                active=False,
                ok=hasil["ok"],
                code=hasil.get("code"),
                detail=hasil.get("error"),
            )

    _threading.Thread(target=_worker, args=(req.slot,), daemon=True).start()
    return {"started": True, "slot": req.slot}


# --- ENDPOINT 7: STATUS PEKERJAAN ENROLLMENT (POLLING UI) ---
@app.get("/fingerprint/enroll/status")
def fingerprint_enroll_status():
    with _fp_job_lock:
        job = dict(_fp_job)
    job["stage"] = (fp.bridge.status()["enroll"] or {}).get("stage") if job["active"] else None
    return job


# --- ENDPOINT 8: HAPUS SLOT SIDIK JARI ---
@app.delete("/fingerprint/{slot:int}")
def fingerprint_delete(slot: int):
    if not 1 <= slot <= 200:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="slot harus 1..200")
    hasil = fp.bridge.delete(slot)
    if not hasil["ok"]:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=hasil.get("error", "hapus slot gagal"),
        )
    return {"slot": slot, "deleted": True}


# --- ENDPOINT 9-11: SESI VERIFIKASI 2FA (WAJAH KUNCI -> TUNGGU JARI) ---
@app.post("/fingerprint/session", status_code=status.HTTP_201_CREATED)
def fingerprint_session_open(req: FingerSession):
    hasil = fp.bridge.open_session(req.student_id.strip(), req.slot, req.ttl)
    if not hasil["ok"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=hasil["error"])
    return hasil


@app.get("/fingerprint/session")
def fingerprint_session_get():
    return fp.bridge.session()


@app.delete("/fingerprint/session")
def fingerprint_session_cancel():
    return fp.bridge.cancel_session()


# --- ENDPOINT LED: KONFIRMASI FISIK SETELAH ABSENSI TERCATAT ---
@app.post("/fingerprint/led")
def fingerprint_led():
    """Kedip hijau di R503. Dipanggil Route Handler setelah baris attendance tersimpan."""
    return fp.bridge.led_ok()
