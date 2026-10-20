"""Mode uji keyboard: YuNet tiap frame, SFace hanya saat tombol ditekan.

Pakai:  python apps/face-service/main.py
Tombol: 'v' = verify sekali | 'e' = enroll | 'c' = hapus label | 'q' = keluar
"""

import time

import cv2
import numpy as np

import face_engine as fe

print("Model siap. YuNet tiap frame, SFace hanya on-demand.")

db = fe.load_db()
print(f"Database: {len(db)} wajah {list(db)}")
print("'v' = verify sekali | 'e' = enroll | 'c' = hapus label | 'q' = keluar")

cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
if not cap.isOpened():
    raise SystemExit("Webcam tidak terbuka.")

label = ""
label_time = 0.0
last_box = None
LABEL_TTL = 5.0  # label otomatis hilang setelah 5 detik
fps, tick = 0.0, cv2.getTickCount()

while True:
    ret, frame = cap.read()
    if not ret:
        print("Gagal baca frame.")
        break

    faces = fe.detect(frame)  # SATU-SATUNYA kerja tiap frame
    now_sec = time.time()

    if faces:
        x, y, w, h = fe.biggest(faces)[:4].astype(int)
        current_box = (x, y, x + w, y + h)

        # Ganti orang (box melompat) -> reset; label kedaluwarsa -> reset
        if last_box is not None and fe.box_iou(last_box, current_box) < 0.3:
            label = ""
        if label and (now_sec - label_time > LABEL_TTL):
            label = ""
        last_box = current_box

        cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
        if label:
            cv2.putText(frame, label, (x, y - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
    else:
        label = ""
        last_box = None

    now = cv2.getTickCount()
    fps = 0.9 * fps + 0.1 * (cv2.getTickFrequency() / (now - tick)) if tick else 0
    tick = now
    cv2.putText(frame, f"{fps:.0f} fps db={len(db)}", (10, 25),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    cv2.imshow("YuNet live, SFace on-demand (v/e/c/q)", frame)
    key = cv2.waitKey(1) & 0xFF

    if key == ord("q"):
        break
    elif key == ord("c"):
        label = ""
    elif key == ord("v"):
        if not faces:
            print("Tidak ada wajah.")
        elif not db:
            print("DB kosong — enroll dulu (e).")
        else:
            name, score = fe.recognize(fe.embed(frame, fe.biggest(faces)), db)
            label = f"{name} ({score:.2f})" if name else f"tak dikenal ({score:.2f})"
            label_time = now_sec
            print(label)
    elif key == ord("e"):
        if not faces:
            print("Tidak ada wajah — enroll dibatalkan.")
            continue
        name = input("Nama untuk wajah ini: ").strip()
        if not name:
            print("Nama kosong — dibatalkan.")
            continue
        fe.enroll_embedding(db, name, fe.embed(frame, fe.biggest(faces)))
        fe.save_db(db)
        label = f"{name} (enrolled)"
        label_time = time.time()
        print(f"Enroll '{name}' ok. File: {fe.DB_PATH}")

cap.release()
cv2.destroyAllWindows()
