"""Hitung ukuran oval optimal dari oval_log.csv dan perbarui face_engine.py.

Jalankan setelah menjalankan absensi atau setelah mengumpulkan sampel lewat
test_yunet_box.py. GUIDE_RY baru = GUIDE_RY_lama * p95(oval_need); bentuk oval
portrait 3:4 (GUIDE_ASPECT) tidak berubah.

Jalankan:
  python fit_oval.py              # Pratinjau hitungan (tanpa mengubah file)
  python fit_oval.py --write      # Tulis langsung GUIDE_RY ke face_engine.py
"""

import argparse
import csv
import os
import re
import statistics
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(BASE_DIR, "oval_log.csv")
ENGINE_PATH = os.path.join(BASE_DIR, "face_engine.py")


REF_W, REF_H = 1280, 720  # Frame acuan 16:9 (sama dengan --size default test_yunet_box.py)


def read_needs(log_path):
    """Hitung ulang `oval_need` tiap baris dengan aturan portrait 3:4 terkini.

    Nilai tersimpan di CSV mungkin berasal dari rumus oval lama, jadi dihitung
    ulang dari cx,cy,bw,bh memakai face_engine.oval_need() pada frame acuan.
    """
    if not os.path.exists(log_path):
        sys.exit(f"File log belum ada: {log_path}\nJalankan server/test dulu untuk mengumpulkan sampel.")
    import face_engine as fe
    needs = []
    with open(log_path, encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            try:
                # Ambil sampel yang bukan partial (wajah utuh)
                if int(row.get("in_frame", "1")) == 1:
                    cx = float(row["cx"]) * REF_W
                    cy = float(row["cy"]) * REF_H
                    bw = float(row["bw"]) * REF_W
                    bh = float(row["bh"]) * REF_H
                    needs.append(fe.oval_need(cx, cy, bw, bh, REF_W, REF_H))
            except (ValueError, KeyError):
                continue
    return needs


def fit(needs):
    """Hitung skala RY optimal dari p95(needs), bentuk 3:4 (GUIDE_ASPECT) tetap."""
    if not needs:
        sys.exit("Tidak ada baris valid di log.")
    s = sorted(needs)
    p95 = s[int(len(s) * 0.95)]
    p99 = s[min(len(s) - 1, int(len(s) * 0.99))]
    # Di face_engine baru, `oval_need` adalah rasio terhadap GUIDE_RY saat ini.
    # Skala baru = GUIDE_RY * p95.
    import face_engine as fe
    ry = round(fe.GUIDE_RY * p95, 3)
    # Jaga batas wajar kamera: minimal 0.20 (oval kecil), maksimal 0.45 (mepet tepi)
    ry = max(0.20, min(0.45, ry))
    return {
        "n": len(s),
        "min": round(s[0], 3),
        "median": round(statistics.median(s), 3),
        "p95": round(p95, 3),
        "p99": round(p99, 3),
        "ry": ry,
    }


def write_engine(ry):
    """Ganti baris `GUIDE_RY = ...` di face_engine.py (RX otomatis terhitung)."""
    with open(ENGINE_PATH, encoding="utf-8") as f:
        src = f.read()
    pattern = r"GUIDE_RY\s*=\s*[\d\.]+"
    repl = f"GUIDE_RY = {ry:.3f}"
    new_src, count = re.subn(pattern, repl, src)
    if count == 0:
        sys.exit("Pola GUIDE_RY tidak ditemukan di face_engine.py")
    with open(ENGINE_PATH, "w", encoding="utf-8") as f:
        f.write(new_src)
    print(f"face_engine.py diperbarui: {repl} (portrait 3:4 tetap)")

def main():
    p = argparse.ArgumentParser(description="Fit ukuran oval dari data CSV nyata")
    p.add_argument("--log", default=LOG_PATH, help=f"path CSV (default {LOG_PATH})")
    p.add_argument("--write", action="store_true", help="tulis hasil ke face_engine.py")
    args = p.parse_args()

    needs = read_needs(args.log)
    res = fit(needs)
    print(f"Sampel valid : n={res['n']}")
    print(f"Radius sebaran: min={res['min']} median={res['median']} p95={res['p95']} p99={res['p99']}")
    print(f"Ukuran pas   : GUIDE_RY = {res['ry']} (tinggi oval {res['ry']*2*100:.1f}% frame)")
    if args.write:
        write_engine(res["ry"])
    else:
        print("Jalankan dengan --write untuk menerapkan angka ini.")


if __name__ == "__main__":
    main()
