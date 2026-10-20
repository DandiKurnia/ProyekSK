"""Uji coba face recognition lokal — InsightFace FaceAnalysis (buffalo_s, CPU).

Alur pakai:
  1. pip install onnxruntime insightface opencv-python numpy
  2. python face_trial.py
  3. Berdiri di depan webcam, tekan 'e' untuk enroll wajah (ketik nama di terminal).
  4. Tekan 'r' untuk ON/OFF mode recognize. Tekan 'q' untuk keluar.

Embedding tersimpan lokal di embeddings.npz (bukan foto).
Threshold default 0.45 — naikkan bila sering salah orang, turunkan bila sering tak dikenal.
"""

import os

import cv2
import numpy as np

MODEL_NAME = "buffalo_s"
DB_PATH = "embeddings.npz"
THRESHOLD = 0.45

print("Memuat model InsightFace (download pertama ~15 MB, sekali saja)...")
from insightface.app import FaceAnalysis  # noqa: E402

app = FaceAnalysis(name=MODEL_NAME, providers=["CPUExecutionProvider"])
app.prepare(ctx_id=0, det_size=(640, 640))
print("Model siap.")


def load_db():
    if os.path.exists(DB_PATH):
        data = np.load(DB_PATH, allow_pickle=True)
        return {k: data[k] for k in data.files}
    return {}


def save_db(db):
    np.savez(DB_PATH, **db)
    print(f"Tersimpan: {DB_PATH} ({len(db)} wajah)")


def biggest_face(faces):
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


def recognize(embedding, db):
    best_name, best_score = None, -1.0
    for name, ref in db.items():
        score = float(np.dot(embedding, ref))  # embedding InsightFace sudah L2-normalized
        if score > best_score:
            best_name, best_score = name, score
    if best_score >= THRESHOLD:
        return best_name, best_score
    return None, best_score


db = load_db()
print(f"Database: {len(db)} wajah terdaftar {list(db)}")
recognize_mode = True

cap = cv2.VideoCapture(0)
if not cap.isOpened():
    raise SystemExit("Webcam tidak terbuka. Cek koneksi kamera / tutup aplikasi lain.")
print("Tekan 'e' = enroll | 'r' = recognize on/off | 'q' = keluar")

while True:
    ret, frame = cap.read()
    if not ret:
        print("Gagal baca frame.")
        break

    faces = app.get(frame)
    label = "tidak ada wajah" if not faces else None

    if faces:
        face = biggest_face(faces)
        x1, y1, x2, y2 = face.bbox.astype(int)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        if recognize_mode and db:
            name, score = recognize(face.normed_embedding, db)
            label = f"{name} ({score:.2f})" if name else f"tak dikenal ({score:.2f})"
        else:
            label = f"det_score {face.det_score:.2f}"
        cv2.putText(frame, label, (x1, y1 - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

    cv2.putText(frame, f"db={len(db)} rec={'ON' if recognize_mode else 'OFF'}",
                (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    cv2.imshow("Uji FaceAnalysis (e=enroll r=recognize q=keluar)", frame)
    key = cv2.waitKey(1) & 0xFF

    if key == ord("q"):
        break
    elif key == ord("r"):
        recognize_mode = not recognize_mode
        print(f"Recognize: {'ON' if recognize_mode else 'OFF'}")
    elif key == ord("e"):
        if not faces:
            print("Tidak ada wajah — enroll dibatalkan.")
            continue
        name = input("Nama untuk wajah ini: ").strip()
        if not name:
            print("Nama kosong — enroll dibatalkan.")
            continue
        emb = biggest_face(faces).normed_embedding.astype(np.float32)
        db[name] = emb if name not in db else (db[name] + emb) / 2  # rata-rata sampel
        # normalisasi ulang setelah rata-rata
        db[name] = db[name] / np.linalg.norm(db[name])
        save_db(db)
        print(f"Enroll '{name}' ok (total sampel dirata-rata). Enroll 2-4x lagi dari sudut beda.")

cap.release()
cv2.destroyAllWindows()
