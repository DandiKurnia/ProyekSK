"""Uji SFace: gambar 5 titik landmark, crop ter-align 112x112, dan vektor 128-d.

Landmark berasal dari YuNet (indeks 4..13), lalu dipakai `SFace.alignCrop()` untuk
meluruskan wajah sebelum `feature()` mengeluarkan vektor. Skrip ini mencetak
bentuk/norma vektor dan (opsional) skor cosine ke database `.npz`.

Jalankan:
  python test_sface_points.py --image foto.jpg --save out/sface.jpg
  python test_sface_points.py --image foto.jpg --clean            # tanpa titik, hanya crop+vektor
  python test_sface_points.py --image foto.jpg --compare          # cosine ke semua siswa di .npz
"""

import argparse
import os
import sys

import cv2
import numpy as np

import face_engine as fe

# Urutan 5 landmark YuNet di `face[4:14]`: (x, y) tiap pasangan
LANDMARK_NAMES = ["mata-kanan", "mata-kiri", "hidung", "mulut-kanan", "mulut-kiri"]
LANDMARK_COLORS = [(0, 0, 255), (0, 128, 255), (0, 255, 255), (255, 0, 255), (255, 255, 0)]


def draw_points(frame, face, idx):
    """Gambar kotak tipis + 5 titik landmark bernomor."""
    x, y, w, h = face[:4].astype(int)
    cv2.rectangle(frame, (x, y), (x + w, y + h), (120, 120, 120), 1)

    for n, (cx, cy) in enumerate(face[4:14].reshape(5, 2).astype(int)):
        cv2.circle(frame, (cx, cy), 4, LANDMARK_COLORS[n], -1)      # titik penuh
        cv2.putText(
            frame, f"{n + 1}", (cx + 6, cy - 6),
            cv2.FONT_HERSHEY_SIMPLEX, 0.45, LANDMARK_COLORS[n], 1,
        )
    cv2.putText(
        frame, f"wajah #{idx}", (x, max(y - 8, 12)),
        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2,
    )
    return frame


def main():
    p = argparse.ArgumentParser(description="Uji landmark + SFace embedding")
    p.add_argument("--image", help="path gambar uji (kosong = pakai webcam)")
    p.add_argument("--camera", type=int, default=0, help="indeks webcam (default 0)")
    p.add_argument("--save", default="out/sface_points.jpg", help="path gambar beranotasi")
    p.add_argument("--clean", action="store_true", help="jangan gambar titik landmark")
    p.add_argument("--compare", action="store_true", help="hitung cosine ke semua siswa di embeddings_yunet.npz")
    p.add_argument("--no-gui", action="store_true", help="tanpa jendela imshow")
    args = p.parse_args()

    if not args.image:                              # mode webcam live
        cap = cv2.VideoCapture(args.camera)
        if not cap.isOpened():
            sys.exit(f"Webcam {args.camera} tidak bisa dibuka")
        db = fe.load_db()
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                faces = fe.detect(frame)
                for i, face in enumerate(faces, start=1):
                    if not args.clean:
                        draw_points(frame, face, i)
                if faces:
                    big = fe.biggest(faces)
                    aligned = fe.recognizer.alignCrop(frame, big.reshape(1, -1))
                    emb = fe.embed(frame, big)
                    name, score = fe.recognize(emb, db)
                    frame[10:122, 10:122] = aligned  # preview crop 112x112 di pojok kiri atas
                    cv2.putText(
                        frame, f"SFace: {name or 'unknown'} ({score:.2f})",
                        (130, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2,
                    )
                cv2.imshow("SFace - 5 titik + alignCrop 112x112", frame)
                if cv2.waitKey(1) & 0xFF in (27, ord("q")):
                    break
        finally:
            cap.release()
            cv2.destroyAllWindows()
        return
    frame = cv2.imread(args.image)
    if frame is None:
        sys.exit(f"Gagal membaca gambar: {args.image}")

    faces = fe.detect(frame)
    if not faces:
        sys.exit("Tidak ada wajah terdeteksi (coba gambar dengan wajah lebih besar/terang)")
    print(f"Wajah terdeteksi: {len(faces)}")

    db = fe.load_db() if args.compare else {}
    annotated = frame.copy()
    base, ext = os.path.splitext(args.save)
    os.makedirs(os.path.dirname(os.path.abspath(args.save)), exist_ok=True)

    for i, face in enumerate(faces, start=1):
        if not args.clean:
            draw_points(annotated, face, i)

        aligned = fe.recognizer.alignCrop(frame, face.reshape(1, -1))   # 112x112
        emb = fe.embed(frame, face)                                     # (128,) float32
        crop_path = f"{base}_aligned_{i}{ext}"
        cv2.imwrite(crop_path, aligned)

        print(f"\n#{i} kotak x={face[0]:.0f} y={face[1]:.0f} w={face[2]:.0f} h={face[3]:.0f}")
        for n, name in enumerate(LANDMARK_NAMES):
            cx, cy = face[4 + n * 2], face[5 + n * 2]
            print(f"   titik {n + 1} ({name:<11}) = ({cx:.1f}, {cy:.1f})")
        print(f"   aligned crop  : {aligned.shape} -> {crop_path}")
        print(f"   vektor SFace  : shape={emb.shape} dtype={emb.dtype} "
              f"norm={np.linalg.norm(emb):.6f}")
        print(f"   contoh nilai  : {np.round(emb[:5], 4)} ... {np.round(emb[-3:], 4)}")

        if args.compare:
            if not db:
                print("   compare       : database .npz kosong")
            else:
                name, score = fe.recognize(emb, db)
                print(f"   compare       : {'MATCH ' + name if name else 'TIDAK COCOK'} "
                      f"(skor {score:.4f}, ambang {fe.THRESHOLD}, margin {fe.MARGIN})")
                for sid, ref in db.items():
                    print(f"     - {sid:<12} cosine={fe.cosine(emb, ref):.4f}")

    cv2.imwrite(args.save, annotated)
    print(f"\nAnotasi disimpan: {args.save}")


if __name__ == "__main__":
    main()
