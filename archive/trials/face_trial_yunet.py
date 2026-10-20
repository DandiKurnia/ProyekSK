"""Uji coba ringan: YuNet deteksi tiap frame + SFace verifikasi berkala.

Kenapa mulus: YuNet (~300 KB) jalan tiap frame untuk kotak wajah.
SFace (~37 MB) hanya jalan 1x per 20 frame untuk tebak nama.

Pakai:
  1. pip install opencv-contrib-python numpy   (sudah ada = skip)
  2. python face_trial_yunet.py                (model auto-download sekali)
  3. 'e' = enroll wajah terlihat | 'q' = keluar

DB lokal: embeddings_yunet.npz. Threshold default 0.40 (SFace cosine).
"""

import os
import urllib.request

import cv2
import numpy as np

YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
SFACE_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
YUNET_PATH = os.path.join("models", "face_detection_yunet_2023mar.onnx")
SFACE_PATH = os.path.join("models", "face_recognition_sface_2021dec.onnx")
DB_PATH = "embeddings_yunet.npz"
THRESHOLD = 0.40
DET_WIDTH = 320       # deteksi di frame kecil -> cepat
RECOGNIZE_EVERY = 20  # embedding 1x per N frame -> kamera mulus


def download(url, path):
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print(f"Download {os.path.basename(path)} (sekali saja)...")
    urllib.request.urlretrieve(url, path)
    print("OK")


download(YUNET_URL, YUNET_PATH)
download(SFACE_URL, SFACE_PATH)

detector = cv2.FaceDetectorYN.create(YUNET_PATH, "", (DET_WIDTH, DET_WIDTH))
recognizer = cv2.FaceRecognizerSF.create(SFACE_PATH, "")
print("Model siap.")


def load_db():
    if os.path.exists(DB_PATH):
        data = np.load(DB_PATH, allow_pickle=True)
        return {k: data[k].astype(np.float32) for k in data.files}
    return {}


def save_db(db):
    np.savez(DB_PATH, **db)
    print(f"Tersimpan: {DB_PATH} ({len(db)} wajah)")


def detect(frame):
    """Deteksi di frame kecil, kembalikan list face-row skala penuh."""
    h, w = frame.shape[:2]
    scale = DET_WIDTH / w
    small = cv2.resize(frame, (DET_WIDTH, int(h * scale)))
    detector.setInputSize((small.shape[1], small.shape[0]))
    _, faces = detector.detect(small)
    if faces is None or len(faces) == 0:
        return []
    faces = faces.copy()
    faces[:, :4] /= scale      # x, y, w, h
    faces[:, 4:14] /= scale    # 5 landmark (x,y)
    return [row for row in faces]


def biggest(faces):
    return max(faces, key=lambda f: f[2] * f[3])


def embed(frame, face):
    aligned = recognizer.alignCrop(frame, face.reshape(1, -1))
    return recognizer.feature(aligned).flatten().astype(np.float32)


def recognize(emb, db):
    best_name, best_score = None, -1.0
    for name, ref in db.items():
        score = float(recognizer.match(
            emb.reshape(1, -1), ref.reshape(1, -1),
            cv2.FaceRecognizerSF_FR_COSINE))
        if score > best_score:
            best_name, best_score = name, score
    if best_score >= THRESHOLD:
        return best_name, best_score
    return None, best_score


db = load_db()
print(f"Database: {len(db)} wajah {list(db)}")
print("Kamera jalan. 'e' = enroll | 'q' = keluar")

cap = cv2.VideoCapture(0)
if not cap.isOpened():
    raise SystemExit("Webcam tidak terbuka.")
frame_no, cached_label = 0, ""
fps_tick = cv2.getTickCount()

while True:
    ret, frame = cap.read()
    if not ret:
        print("Gagal baca frame.")
        break
    frame_no += 1

    faces = detect(frame)
    if faces:
        face = biggest(faces)
        x, y, w, h = face[:4].astype(int)
        cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
        if frame_no % RECOGNIZE_EVERY == 0 and db:
            name, score = recognize(embed(frame, face), db)
            cached_label = f"{name} ({score:.2f})" if name else f"tak dikenal ({score:.2f})"
        if db:
            cv2.putText(frame, cached_label, (x, y - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
    else:
        cached_label = ""

    if frame_no % 30 == 0:  # update fps 1x/detik
        now = cv2.getTickCount()
        fps = 30 / ((now - fps_tick) / cv2.getTickFrequency())
        fps_tick, cached_fps = now, f"{fps:.0f} fps"
    cv2.putText(frame, f"{cached_fps if 'cached_fps' in dir() else ''} db={len(db)}",
                (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    cv2.imshow("Uji YuNet+SFace (e=enroll q=keluar)", frame)
    key = cv2.waitKey(1) & 0xFF

    if key == ord("q"):
        break
    elif key == ord("e"):
        if not faces:
            print("Tidak ada wajah — enroll dibatalkan.")
            continue
        name = input("Nama untuk wajah ini: ").strip()
        if not name:
            print("Nama kosong — enroll dibatalkan.")
            continue
        emb = embed(frame, biggest(faces))
        db[name] = emb if name not in db else (db[name] + emb) / 2
        db[name] = db[name] / np.linalg.norm(db[name])
        save_db(db)
        print(f"Enroll '{name}' ok. Ulangi 2-4x dari sudut beda.")

cap.release()
cv2.destroyAllWindows()
