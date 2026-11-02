# Kode — `test_yunet_box.py`

> Salinan penuh `apps/face-service/test_yunet_box.py` (188 baris). Sinkron: 2026-11-02.

## Peran

Skrip **uji bounding box YuNet** — tanpa SFace (tidak mengenali identitas, hanya kotak + skor). Menampilkan kotak wajah + skor keyakinan dari `face_engine.detect()`, mencetak koordinat `[x, y, w, h]` ke terminal, dan menumpuk oval panduan + label status dengan aturan yang sama seperti server `/recognize`.

Status yang dihitung (`status_of`): `ok` | `face_outside_oval` | `partial_face` | `no_face`.

Mode `--oval-auto`: kumpul bounding box ke `oval_log.csv`, lalu **saat keluar otomatis menghitung dan menimpa `GUIDE_RY` di `face_engine.py`** via `fit_oval`.

## Cara pakai

```bash
cd apps/face-service
python test_yunet_box.py                              # webcam 0, jendela live (ESC/q keluar)
python test_yunet_box.py --image foto.jpg --save out/box.jpg   # 1 gambar, simpan hasil
python test_yunet_box.py --oval-auto --size 1280x720   # kumpul sampel oval + fit otomatis
```

## Kode penuh

```python
"""Uji bounding box YuNet (detektor wajah) - tanpa SFace.

Menampilkan kotak wajah + skor keyakinan yang dihasilkan `face_engine.detect()`,
dan mencetak koordinat [x, y, w, h] ke terminal.

Jalankan:
  python test_yunet_box.py                              # webcam 0, jendela live (ESC/q keluar)
  python test_yunet_box.py --image foto.jpg --save out/box.jpg   # 1 gambar, simpan hasil
"""

import argparse
import os
import sys

import cv2

import face_engine as fe  # pipeline YuNet yang sudah ada; tidak ada model baru di sini


def draw_boxes(frame, faces):
    """Gambar kotak + skor tiap wajah; koordinat sudah dalam skala frame asli."""
    for i, face in enumerate(faces, start=1):
        x, y, w, h = face[:4].astype(int)          # indeks 0..3 = x, y, lebar, tinggi
        score = float(face[14])                    # indeks 14 = skor keyakinan YuNet
        cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
        cv2.putText(
            frame, f"#{i} {score:.2f}", (x, max(y - 8, 12)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2,
        )
    return frame
# Warna BGR; disamakan dengan oval di halaman /camera pada web.
GREEN, RED = (0, 255, 0), (0, 0, 255)


def status_of(frame, faces):
    """Hitung status yang sama dengan server /recognize:
    ok | face_outside_oval | partial_face | no_face
    """
    if faces is None or len(faces) == 0:
        return "no_face", None
    face = fe.biggest(faces)  # sama seperti server: wajah terluas
    q = fe.face_quality(frame, face)
    if not q["in_frame"]:
        return "partial_face", face
    if not q["in_guide"]:
        return "face_outside_oval", face
    return "ok", face


def recognize_box(frame, face, db):
    """Identitas 1 wajah: (nama|None, skor). DB kosong -> (None, -1.0)."""
    if not db:
        return None, -1.0
    return fe.recognize(fe.embed(frame, face), db)  # SFace 1x per panggilan


def draw_identity(frame, face, label):
    """Tulis label identitas di atas kotak wajah."""
    x, y = face[:2].astype(int)
    cv2.putText(frame, label, (x, max(y - 26, 16)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
    return frame


def draw_status(frame, faces):
    """Tumpuk oval panduan + label status, mengikuti aturan server."""
    h, w = frame.shape[:2]
    status, face = status_of(frame, faces)
    label = {
        "ok": "Wajah Terdeteksi",
        "face_outside_oval": "Wajah Di Luar Oval - Masuk ke Lingkaran",
        "partial_face": "Wajah Belum Utuh - Masuk ke Oval",
        "no_face": "Wajah Tidak Terdeteksi",
    }[status]
    color = GREEN if status == "ok" else RED
    rx, ry = (int(v) for v in fe.guide_radii(w, h))  # Portrait 3:4 di semua aspek sensor
    cv2.ellipse(frame, (w // 2, h // 2), (rx, ry), 0, 0, 360, color, 2)
    cv2.putText(frame, label, (20, h - 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
    # Tampilkan dimensi piksel oval dan frame agar bisa dicocokkan dengan FE
    cv2.putText(
        frame,
        f"frame: {w}x{h} | oval: {rx*2}x{ry*2} px ({rx*200//w}%x{ry*200//h}%)",
        (20, h - 54),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (200, 200, 200),
        1,
    )
    return status


def report(faces):
    """Cetak koordinat tiap kotak ke terminal."""
    print(f"Wajah terdeteksi: {len(faces)}")
    for i, face in enumerate(faces, start=1):
        x, y, w, h = face[:4].astype(int)
        print(f"  #{i} x={x} y={y} w={w} h={h} skor={float(face[14]):.4f}")


def parse_args():
    p = argparse.ArgumentParser(description="Uji bounding box YuNet")
    p.add_argument("--image", help="path gambar uji (kosong = pakai webcam)")
    p.add_argument("--camera", type=int, default=0, help="indeks webcam (default 0)")
    p.add_argument("--save", help="simpan frame beranotasi ke path ini")
    p.add_argument("--no-gui", action="store_true", help="tanpa jendela imshow (cocok utk uji cepat)")
    p.add_argument(
        "--oval-auto",
        action="store_true",
        help="kumpulkan bounding box wajah ke CSV, lalu saat keluar otomatis hitung "
        "dan simpan ukuran oval yang pas ke face_engine.py",
    )
    p.add_argument(
        "--size",
        metavar="LxT",
        default="1280x720",
        help="resolusi kamera (default 1280x720, disamakan dengan constraint web /camera)",
    )
    return p.parse_args()


def main():
    args = parse_args()

    if args.image:                                  # mode 1 gambar statis
        frame = cv2.imread(args.image)
        if frame is None:
            sys.exit(f"Gagal membaca gambar: {args.image}")
        faces = fe.detect(frame)
        report(faces)
        status = draw_status(frame, faces)
        print(f"status={status}")
        if faces:
            name, score = recognize_box(frame, fe.biggest(faces), fe.load_db())
            label = f"{name} ({score:.2f})" if name else f"tak dikenal ({score:.2f})"
            print(f"identitas: {label}")
            draw_identity(frame, fe.biggest(faces), label)
        frame = draw_boxes(frame, faces)
        if args.save:
            os.makedirs(os.path.dirname(os.path.abspath(args.save)), exist_ok=True)
            cv2.imwrite(args.save, frame)
            print(f"Hasil disimpan: {args.save}")
        if not args.no_gui:
            cv2.imshow("YuNet - bounding box", frame)
            cv2.waitKey(0)
            cv2.destroyAllWindows()
        return

    cap = cv2.VideoCapture(args.camera)             # mode webcam live
    if not cap.isOpened():
        sys.exit(f"Webcam {args.camera} tidak bisa dibuka")
    if args.size:  # samakan bingkai Python dengan stream web sebelum melukis oval
        try:
            vw, vh = [int(v) for v in args.size.lower().replace("×", "x").split("x")]
        except ValueError:
            sys.exit("--size harus format LxT, mis. 1280x720")
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, vw)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, vh)
    w_cam = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h_cam = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"Webcam {args.camera} aktif: resolusi {w_cam}x{h_cam} (rasio {w_cam/h_cam:.2f}:1)")

    writer = None  # perekam video hasil anotasi bila --save dipakai
    auto = args.oval_auto  # mode kumpul sample oval -> fit otomatis saat keluar
    if auto:
        print(f"Kumpul sample oval -> {fe.OVAL_LOG_PATH}. Posisikan wajah senyaman scanning, tekan q/ESC bila selesai.")
    try:
        db = fe.load_db()                           # baca .npz sekali (tidak per frame)
        last = None                                 # status terakhir yang dicetak (hindari spam tiap frame)
        label_box = None                            # kotak saat identitas terakhir dihitung
        label = ""                                  # "nama (skor)" / "tak dikenal (skor)" / "DB kosong"
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            faces = fe.detect(frame)
            if auto and faces is not None and len(faces) > 0:
                h0, w0 = frame.shape[:2]
                x0, y0, bw0, bh0 = [float(v) for v in fe.biggest(faces)[:4]]
                q0 = fe.face_quality(frame, fe.biggest(faces))
                fe.log_oval((x0 + bw0 / 2) / w0, (y0 + bh0 / 2) / h0, bw0 / w0, bh0 / h0, q0, "live")
            status, face = status_of(frame, faces)  # kotak terbesar + aturan oval
            if status == "ok":                      # hanya wajah utuh di dalam oval yang dikenali
                x, y, w, h = face[:4].astype(int)
                current = (x, y, x + w, y + h)
                if label_box is None or fe.box_iou(label_box, current) < 0.6:  # orang/pindah -> kenali ulang
                    name, score = recognize_box(frame, face, db)
                    label = f"{name} ({score:.2f})" if name else f"tak dikenal ({score:.2f})"
                    label_box = current
                    print(f"identitas: {label}")
                if not db:
                    label = "DB kosong"
                draw_identity(frame, face, label)
            else:                                   # wajah hilang/keluar oval -> label ikut reset
                label_box = None
                label = ""
            draw_status(frame, faces)
            frame = draw_boxes(frame, faces)
            cv2.imshow("YuNet - status AI (ESC/q keluar)", frame)
            if status != last:                       # cetak hanya saat status berubah
                last = status
                print(f"status={status}")
            if args.save and writer is None:        # rekam hasil anotasi ke file video
                h, w = frame.shape[:2]
                writer = cv2.VideoWriter(
                    args.save, cv2.VideoWriter_fourcc(*"mp4v"), 20, (w, h)
                )
            if writer is not None:
                writer.write(frame)
            if cv2.waitKey(1) & 0xFF in (27, ord("q")):
                break
    finally:
        cap.release()
        if writer is not None:
            writer.release()
            print(f"Rekaman disimpan: {args.save}")
        cv2.destroyAllWindows()
        if auto:  # hitung dan terapkan ukuran oval dari sampel yang terkumpul
            import fit_oval

            needs = fit_oval.read_needs(fe.OVAL_LOG_PATH)
            res = fit_oval.fit(needs)
            fit_oval.write_engine(res["rx"], res["ry"])


if __name__ == "__main__":
    main()
```
