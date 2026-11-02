"""Pipeline vision YuNet-live + SFace-on-demand (tanpa I/O kamera/UI).

Dipakai bersama oleh main.py (mode keyboard) dan server.py (FastAPI).
Model dimuat sekali saat modul diimpor.
"""

# --- IMPORT LIBRARY ---
import os  # Operasi path file/folder lintas sistem operasi (Windows/Linux)
import time  # Stempel waktu baris oval_log.csv
import urllib.request  # Unduh otomatis model ONNX dari OpenCV Zoo bila belum ada

import cv2  # OpenCV contrib: resize gambar + mesin inferensi ONNX (FaceDetectorYN & FaceRecognizerSF)
import numpy as np  # NumPy: operasi matriks, normalisasi vektor L2, dan baca/simpan file .npz

# --- KONSTANTA URL, PATH FILE, DAN PARAMETER ---
# URL resmi model ONNX di repositori OpenCV Zoo
YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
SFACE_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"

# Folder absolut tempat file `face_engine.py` berada (`.../apps/face-service`)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Lokasi penyimpanan model ONNX di disk lokal (di-gitignore agar tidak masuk Git)
YUNET_PATH = os.path.join(BASE_DIR, "models", "face_detection_yunet_2023mar.onnx")
SFACE_PATH = os.path.join(BASE_DIR, "models", "face_recognition_sface_2021dec.onnx")

# File database lokal berisi pasangan {student_id: vektor 128 float32}
DB_PATH = os.path.join(BASE_DIR, "embeddings_yunet.npz")

# Parameter keputusan pengenalan wajah:
THRESHOLD = 0.40  # Batas minimal skor cosine similarity agar dianggap cocok (default OpenCV 0.363)
MARGIN = 0.08  # Selisih minimal skor peringkat 1 vs peringkat 2 (cegah salah tempel wajah mirip)
DET_WIDTH = 240  # Lebar frame saat masuk YuNet (makin kecil makin cepat; 240 px cukup untuk <2 m)

# Metadata versi model untuk dilaporkan oleh endpoint GET /health
MODEL_VERSIONS = {
    "detector": "yunet_2023mar",
    "recognizer": "sface_2021dec",
}


# --- INISIALISASI MODEL (JALAN SEKALI SAAT IMPORT) ---
def _download(url, path):
    """Unduh file model ONNX bila belum ada di folder `models/`."""
    if os.path.exists(path):  # Kalau file sudah ada di disk, langsung lewati
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)  # Buat folder `models/` kalau belum ada
    print(f"Download {os.path.basename(path)} (sekali saja)...")
    urllib.request.urlretrieve(url, path)  # Unduh dari GitHub ke path lokal
    print("OK")


# Pastikan kedua file .onnx tersedia sebelum membuat objek OpenCV
_download(YUNET_URL, YUNET_PATH)
_download(SFACE_URL, SFACE_PATH)

# Muat model detektor wajah YuNet (ukuran input awal diset 240x240, nanti disesuaikan tiap frame)
detector = cv2.FaceDetectorYN.create(YUNET_PATH, "", (DET_WIDTH, DET_WIDTH))
# Muat model pengenal wajah SFace (mengubah crop wajah jadi vektor 128 angka)
recognizer = cv2.FaceRecognizerSF.create(SFACE_PATH, "")


# --- PENYIMPANAN EMBEDDING LOKAL (.NPZ) ---
def load_db():
    """Baca seluruh embedding siswa dari `embeddings_yunet.npz` ke dict Python di RAM."""
    if os.path.exists(DB_PATH):  # Kalau file .npz sudah pernah dibuat
        data = np.load(DB_PATH, allow_pickle=True)  # Buka arsip numpy (.npz)
        # Kembalikan dict {"student_id": array float32 shape (128,)}
        return {k: data[k].astype(np.float32) for k in data.files}
    return {}  # Kalau belum ada siswa terdaftar, kembalikan dict kosong


def save_db(db):
    """Tulis seluruh isi dict `db` ke file fisik `embeddings_yunet.npz`."""
    np.savez(DB_PATH, **db)  # Tiap key dict disimpan sebagai 1 array bernama sama dengan student_id


# --- TAHAP 1: DETEKSI WAJAH (YUNET) ---
def detect(frame):
    """Deteksi di frame kecil; kembalikan list baris wajah skala penuh.

    Tiap baris `face` adalah array 15 angka:
    - indeks 0..3  : kotak wajah [x, y, w, h]
    - indeks 4..13 : 5 titik landmark [x_mata_kanan, y_mata_kanan, x_mata_kiri, ..., mulut]
    - indeks 14    : skor keyakinan deteksi wajah
    """
    h, w = frame.shape[:2]  # Ambil tinggi (h) dan lebar (w) asli gambar (mis. 480, 640)
    scale = DET_WIDTH / w  # Faktor pengecilan gambar (mis. 240 / 640 = 0.375)
    small = cv2.resize(frame, (DET_WIDTH, int(h * scale)))  # Kecilkan gambar agar YuNet ringan di CPU
    detector.setInputSize((small.shape[1], small.shape[0]))  # Beri tahu YuNet ukuran frame kecil (w, h)
    _, faces = detector.detect(small)  # Jalankan inferensi YuNet pada gambar kecil
    if faces is None or len(faces) == 0:  # Kalau tidak ada wajah terdeteksi:
        return []  # Kembalikan list kosong (aman untuk `if not faces:`)
    faces = faces.copy()  # Salin array agar aman dimodifikasi
    faces[:, :4] /= scale  # Kembalikan koordinat kotak [x, y, w, h] ke ukuran gambar asli
    faces[:, 4:14] /= scale  # Kembalikan koordinat 5 titik landmark ke ukuran gambar asli
    return [row for row in faces]  # Ubah matriks (N, 15) jadi list berisi N baris wajah


def biggest(faces):
    """Pilih 1 wajah dengan luas kotak (lebar * tinggi = f[2] * f[3]) paling besar."""
    return max(faces, key=lambda f: f[2] * f[3])

# --- TAHAP 1b: VALIDASI WAJAH UTUH DI FRAME + SELURUH KOTAK DI DALAM OVAL ---
EDGE_TOLERANCE = 0.02  # Toleransi kotak yang menyentuh tepi frame (2% lebar/tinggi gambar)

# Rasio bentuk oval panduan (LEBAR : TINGGI dalam piksel).
# 0.75 = 3:4 (lonjong ke bawah / portrait), identik dengan `w-48 h-64` (192x256 px).
GUIDE_ASPECT = 0.75

# Setengah sumbu vertikal oval (tinggi oval = 2 * GUIDE_RY * tinggi frame).
# 0.35 = oval menempati 70% tinggi frame (wajah nyaman, tidak mepet tepi).
GUIDE_RY = 0.350


def guide_radii(w, h):
    """Hitung radius piksel (rx, ry) oval panduan yang selalu berorientasi portrait 3:4.

    Tidak peduli aspek sensor (4:3, 16:9, dll), bentuk oval di layar selalu
    memiliki rasio lebar:tinggi = GUIDE_ASPECT (0.75).
    """
    ry = h * GUIDE_RY
    rx = ry * GUIDE_ASPECT
    return rx, ry


# Kompatibilitas mundur dengan klien yang membaca /api/face/health
# (rx dihitung dengan asumsi frame 16:9 1280x720: rx/w = (ry*0.75)/w = 0.350*0.75*720/1280 ≈ 0.148)
GUIDE_RX = round(GUIDE_RY * GUIDE_ASPECT * (9.0 / 16.0), 3)


def oval_need(cx, cy, bw, bh, w, h):
    """Faktor skala minimum dari oval panduan agar SELURUH kotak wajah masuk.

    `cx, cy, bw, bh` = pusat & dimensi kotak wajah (piksel); `w, h` = ukuran frame.
    Kembalikan rasio skala: <= 1.0 berarti seluruh kotak berada di dalam oval.
    """
    rx, ry = guide_radii(w, h)  # Setengah sumbu oval pada frame ini (piksel)
    dx = abs(cx - w / 2.0) + bw / 2.0  # Sisi kotak terjauh dari pusat (arah x)
    dy = abs(cy - h / 2.0) + bh / 2.0  # Sisi kotak terjauh dari pusat (arah y)
    if rx <= 0 or ry <= 0:
        return 999.0
    return float(np.sqrt((dx / rx) ** 2 + (dy / ry) ** 2))  # Sudut terjauh = titik terburuk
OVAL_LOG_PATH = os.path.join(BASE_DIR, "oval_log.csv")  # Kumpulan data fit oval
OVAL_LOG_MAX_BYTES = 5 * 1024 * 1024  # Rotasi sekali: file lama -> .1 lalu mulai baru
_OVAL_LOG_HEADER = "ts,cx,cy,bw,bh,coverage,oval_need,in_frame,in_guide,reason"


def log_oval(cx, cy, bw, bh, quality, reason):
    """Simpan satu baris geometri wajah (semua ternormalisasi) untuk fit oval.py.

    Tidak pernah melempar exception: logging tidak boleh menggagalkan pengenalan.
    """
    try:
        if os.path.exists(OVAL_LOG_PATH) and os.path.getsize(OVAL_LOG_PATH) > OVAL_LOG_MAX_BYTES:
            os.replace(OVAL_LOG_PATH, OVAL_LOG_PATH + ".1")  # Buang generasi lama
        baris_baru = not os.path.exists(OVAL_LOG_PATH)
        with open(OVAL_LOG_PATH, "a", encoding="utf-8", newline="") as f:
            if baris_baru:
                f.write(_OVAL_LOG_HEADER + "\n")
            f.write(
                f"{time.time():.0f},{cx:.4f},{cy:.4f},{bw:.4f},{bh:.4f},"
                f"{quality['coverage']:.4f},{quality['oval_need']:.4f},"
                f"{int(quality['in_frame'])},{int(quality['in_guide'])},{reason}\n"
            )
    except OSError:
        pass  # Disk penuh / file terkunci: abaikan, jangan ganggu absensi


def face_quality(frame, face):
    """Cek wajah utuh di frame DAN seluruh kotaknya berada di dalam oval panduan.

    - `in_frame`: kotak wajah tidak terpotong tepi kamera. Wajah separuh bikin crop
      SFace meleset sehingga skor cosine jadi sampah.
    - `in_guide`: keempat sudut kotak wajah di dalam elips panduan (bukan hanya titik
      tengahnya) — aturan ini sama persis dengan geometri oval di klien.
    """
    h, w = frame.shape[:2]  # Ukuran frame asli (bukan frame kecil YuNet)
    x, y, bw, bh = [float(v) for v in face[:4]]  # Kotak wajah [x, y, lebar, tinggi]
    mx, my = w * EDGE_TOLERANCE, h * EDGE_TOLERANCE  # Toleransi tepi (piksel)
    in_frame = (  # Keempat sisi kotak harus di dalam gambar (plus toleransi kecil)
        x >= -mx and y >= -my
        and x + bw <= w + mx and y + bh <= h + my
    )
    cx, cy = x + bw / 2.0, y + bh / 2.0  # Titik tengah wajah (piksel)
    need = oval_need(cx, cy, bw, bh, w, h)  # Faktor skala (<= 1.0 = muat di oval panduan)
    coverage = (bw * bh) / float(w * h) if w and h else 0.0  # Porsi frame yang ditempati wajah
    return {
        "in_frame": bool(in_frame),
        "in_guide": bool(need <= 1.0),
        "oval_need": round(need, 4),  # Dipakai fit_oval.py & log CSV
        "coverage": round(coverage, 4),
        "box": [int(x), int(y), int(bw), int(bh)],
    }


# --- TAHAP 2: EKSTRAKSI VEKTOR WAJAH 128-D (SFACE) ---
def embed(frame, face):
    """Luruskan wajah (112x112) memakai 5 titik landmark, lalu ekstrak vektor 128 float32."""
    # alignCrop memutar & memotong wajah dari frame asli berdasarkan 5 titik mata/hidung/mulut
    aligned = recognizer.alignCrop(frame, face.reshape(1, -1))
    # feature() menghasilkan vektor (1, 128) -> diratakan jadi 1D (128,) bertipe float32
    return recognizer.feature(aligned).flatten().astype(np.float32)


# --- TAHAP 3: PERBANDINGAN & KEPUTUSAN IDENTITAS ---
def cosine(a, b):
    """Hitung skor kemiripan cosine (-1.0 s/d 1.0) antara dua vektor 128-d."""
    return float(recognizer.match(
        a.reshape(1, -1), b.reshape(1, -1),
        cv2.FaceRecognizerSF_FR_COSINE))  # Makin mendekati 1.0 berarti makin mirip


def enroll_embedding(db, name, emb):
    """Rata-rata sampel baru ke data lama; kembalikan db (belum disimpan).

    Catatan: karena dirata-ratakan berurutan `(lama + baru) / 2`, sampel terakhir
    punya bobot paling besar. Setelah digabung, vektor dinormalisasi L2 (panjang = 1).
    """
    emb = emb.astype(np.float32)  # Pastikan tipe float32
    if name in db:  # Kalau siswa sudah punya vektor sebelumnya (sampel ke-2 dst.):
        emb = (db[name] + emb) / 2  # Rata-ratakan vektor lama dengan vektor sampel baru
    db[name] = emb / np.linalg.norm(emb)  # Normalisasi L2 agar panjang vektor = 1.0
    return db


def recognize(emb, db, threshold=THRESHOLD, margin=MARGIN):
    """Kembalikan (nama|None, skor terbaik).

    Lolos bila: skor >= threshold DAN (bila DB >1 wajah) selisih ke skor
    kedua >= margin. Mencegah wajah asing yg mirip dua orang sekaligus
    langsung menempel ke salah satunya.
    """
    # Hitung skor cosine wajah input (`emb`) terhadap setiap siswa yang ada di `db`
    scores = [(name, cosine(emb, ref)) for name, ref in db.items()]
    if not scores:  # Kalau database `.npz` masih kosong (0 siswa):
        return None, -1.0
    scores.sort(key=lambda s: s[1], reverse=True)  # Urutkan dari skor tertinggi ke terendah
    best_name, best_score = scores[0]  # Kandidat peringkat 1 (skor tertinggi)
    if best_score < threshold:  # Syarat 1: skor peringkat 1 wajib >= ambang batas (0.40)
        return None, best_score  # Gagal: wajah tidak cukup mirip siapa pun
    if len(scores) > 1 and (best_score - scores[1][1]) < margin:  # Syarat 2: unggul >= 0.08 dari peringkat 2
        return None, best_score  # Gagal ("ambiguous"): terlalu mirip dua siswa sekaligus
    return best_name, best_score  # Lolos kedua syarat -> kembalikan NIS pemenang & skornya


# --- UTILITAS TAMBAHAN (HAPUS SISWA & TRACKING KOTAK WAJAH) ---
def delete_student(db, student_id):
    """Hapus 1 siswa dari RAM + file `.npz`; kembalikan True bila ada yang terhapus."""
    if student_id in db:
        del db[student_id]  # Hapus dari dict di memori
        save_db(db)  # Tulis ulang file `embeddings_yunet.npz`
        return True
    return False  # Siswa memang tidak ada di `db`


def box_iou(boxA, boxB):
    """IoU (Intersection over Union) dua box (x1, y1, x2, y2); 0.0 bila salah satu None.

    Dipakai di `main.py` untuk mengecek apakah kotak wajah di frame sekarang masih
    orang yang sama di posisi yang hampir sama dengan frame sebelumnya (0.0 = pisah, 1.0 = persis berhimpit).
    """
    if boxA is None or boxB is None:
        return 0.0
    # Cari koordinat persegi panjang irisan (intersection)
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    inter = max(0, xB - xA) * max(0, yB - yA)  # Luas daerah yang berpotongan
    areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])  # Luas kotak A
    areaB = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])  # Luas kotak B
    union = areaA + areaB - inter  # Luas gabungan (A + B dikurangi irisan)
    return inter / union if union > 0 else 0.0  # Rasio irisan terhadap gabungan
