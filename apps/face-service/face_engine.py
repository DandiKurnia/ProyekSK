"""Pipeline vision YuNet-live + SFace-on-demand (tanpa I/O kamera/UI).

Dipakai bersama oleh main.py (mode keyboard) dan server.py (FastAPI).
Model dimuat sekali saat modul diimpor.
"""

import os
import urllib.request

import cv2
import numpy as np

YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
SFACE_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
YUNET_PATH = os.path.join(BASE_DIR, "models", "face_detection_yunet_2023mar.onnx")
SFACE_PATH = os.path.join(BASE_DIR, "models", "face_recognition_sface_2021dec.onnx")
DB_PATH = os.path.join(BASE_DIR, "embeddings_yunet.npz")

THRESHOLD = 0.40
DET_WIDTH = 240  # makin kecil makin cepat; 240 cukup utk jarak <2 m

MODEL_VERSIONS = {
    "detector": "yunet_2023mar",
    "recognizer": "sface_2021dec",
}


def _download(url, path):
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print(f"Download {os.path.basename(path)} (sekali saja)...")
    urllib.request.urlretrieve(url, path)
    print("OK")


_download(YUNET_URL, YUNET_PATH)
_download(SFACE_URL, SFACE_PATH)

detector = cv2.FaceDetectorYN.create(YUNET_PATH, "", (DET_WIDTH, DET_WIDTH))
recognizer = cv2.FaceRecognizerSF.create(SFACE_PATH, "")


def load_db():
    if os.path.exists(DB_PATH):
        data = np.load(DB_PATH, allow_pickle=True)
        return {k: data[k].astype(np.float32) for k in data.files}
    return {}


def save_db(db):
    np.savez(DB_PATH, **db)


def detect(frame):
    """Deteksi di frame kecil; kembalikan list baris wajah skala penuh."""
    h, w = frame.shape[:2]
    scale = DET_WIDTH / w
    small = cv2.resize(frame, (DET_WIDTH, int(h * scale)))
    detector.setInputSize((small.shape[1], small.shape[0]))
    _, faces = detector.detect(small)
    if faces is None or len(faces) == 0:
        return []
    faces = faces.copy()
    faces[:, :4] /= scale
    faces[:, 4:14] /= scale
    return [row for row in faces]


def biggest(faces):
    return max(faces, key=lambda f: f[2] * f[3])


def embed(frame, face):
    aligned = recognizer.alignCrop(frame, face.reshape(1, -1))
    return recognizer.feature(aligned).flatten().astype(np.float32)


def cosine(a, b):
    return float(recognizer.match(
        a.reshape(1, -1), b.reshape(1, -1),
        cv2.FaceRecognizerSF_FR_COSINE))


def enroll_embedding(db, name, emb):
    """Rata-rata sampel baru ke data lama; kembalikan db (belum disimpan)."""
    emb = emb.astype(np.float32)
    if name in db:
        emb = (db[name] + emb) / 2
    db[name] = emb / np.linalg.norm(emb)
    return db


def recognize(emb, db, threshold=THRESHOLD):
    """Kembalikan (nama|None, skor_terbaik)."""
    best_name, best_score = None, -1.0
    for name, ref in db.items():
        score = cosine(emb, ref)
        if score > best_score:
            best_name, best_score = name, score
    if best_score >= threshold:
        return best_name, best_score
    return None, best_score


def delete_student(db, student_id):
    """Hapus 1 siswa; True bila ada yang terhapus."""
    if student_id in db:
        del db[student_id]
        save_db(db)
        return True
    return False


def box_iou(boxA, boxB):
    """IoU dua box (x1, y1, x2, y2); 0.0 bila salah satu None."""
    if boxA is None or boxB is None:
        return 0.0
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    inter = max(0, xB - xA) * max(0, yB - yA)
    areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    areaB = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    union = areaA + areaB - inter
    return inter / union if union > 0 else 0.0
