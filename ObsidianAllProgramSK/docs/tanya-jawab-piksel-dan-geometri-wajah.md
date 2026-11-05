# Analisis & Jawaban Seputar Piksel (Face Recognition: YuNet + SFace + Oval)

> **Tujuan Dokumen:** Lembar contekan/jawaban teknis ringkas ketika ditanya dosen/penguji/tim seputar resolusi, jumlah piksel, konversi koordinat, dan perbandingan ukuran bounding box vs oval pada modul kamera wajah (`apps/face-service`).

---

## 1. Jawaban Langsung Jika Ditanya: "Berapa Ukuran Pikselnya?"

Sistem bekerja pada **4 tingkat ukuran piksel yang berbeda** dalam satu kali proses deteksi:

```
[1. Sensor Kamera]        1280 × 720 px   (921.600 piksel) — Citra mentah BGR
        ↓ resize (scale = 0.1875)
[2. Detektor YuNet]        240 × 135 px   ( 32.400 piksel) — Deteksi wajah & 5 landmark
        ↓ hitung balik (x / scale)
[3. Oval Panduan Layar]    378 × 504 px   (rx=189 px, ry=252 px) — Validasi posisi
        ↓ alignCrop (warpAffine)
[4. Pengenal SFace]        112 × 112 px   ( 12.544 piksel) — Ekstraksi vektor 128 float
```

---

## 2. Rincian Tiap Lapisan Piksel

### Lapis 1: Resolusi Frame Asli (Kamera)
- **Sumber:** `cap.read()` dari OpenCV VideoCapture (atau stream browser `navigator.mediaDevices`).
- **Ukuran Default:** `1280 × 720` piksel (rasio 16:9, ~0,92 Megapiksel).
- **Format:** NumPy array shape `(720, 1280, 3)`, tipe `uint8` (warna BGR 0–255).
- **Fungsi:** Menjaga ketajaman visual saat crop wajah diproses oleh SFace.

### Lapis 2: Resolusi Ringan Khusus YuNet (Deteksi)
- **Konstanta:** `DET_WIDTH = 240` (`face_engine.py:33`).
- **Kenapa dikecilkan?**
  - Memproses frame penuh 1280×720 di CPU jauh lebih berat; YuNet dijalankan tiap frame pada mode webcam.
  - Dengan dikecilkan ke lebar **240 px**, jumlah piksel berkurang **28,4× lipat** (dari 921.600 jadi 32.400 piksel).
  - Komentar konstanta di kode: `240 px cukup untuk <2 m` jarak wajah ke kamera.
- **Tinggi Frame YuNet:** Mengikuti aspek rasio asli agar proporsi wajah tidak gepeng/terdistorsi:
  $$\text{scale} = \frac{240}{w_{\text{asli}}} = \frac{240}{1280} = 0,1875$$
  $$h_{\text{yunet}} = \text{round}(720 \times 0,1875) = 135\text{ px}$$

### Lapis 3: Ukuran Oval Panduan (Area Toleransi Wajah)
- **Konstanta:** `GUIDE_RY = 0.350` (35% tinggi frame), `GUIDE_ASPECT = 0.75` (rasio portrait 3:4).
- **Tengah Layar:** $(x_c, y_c) = (1280 / 2, 720 / 2) = (640, 360)\text{ px}$.
- **Radius Vertikal ($r_y$):** $720 \times 0,350 = 252\text{ px}$ (tinggi total oval = $2 \times 252 = 504\text{ px}$).
- **Radius Horizontal ($r_x$):** $252 \times 0,75 = 189\text{ px}$ (lebar total oval = $2 \times 189 = 378\text{ px}$).
- **Kenapa pakai oval 3:4?** Rasio kepala manusia rata-rata adalah 3:4. Dengan membatasi bentuk ini, pengguna diarahkan memposisikan kepala tegak lurus ke kamera.

### Lapis 4: Resolusi Input Pengenal SFace
- **Ukuran Baku Model:** `112 × 112` piksel (ketetapan arsitektur SFace ONNX dari OpenCV Zoo).
- **Proses:** Berdasarkan 5 titik landmark (2 mata, hidung, 2 sudut bibir), citra diputar (*affine transformation*) agar kedua mata sejajar horizontal, lalu di-crop tepat 112×112 px.
- **Output:** Array `1 × 128` bilangan `float32` (vektor ciri biometrik).

---

## 3. Tabel Konversi Resolusi Kamera yang Berbeda

Jika kamera yang dicolokkan bukan 720p, sistem secara otomatis beradaptasi dengan rumus yang sama:

| Resolusi Kamera | Masuk ke YuNet | Faktor Skala (`scale`) | Penghematan Piksel | Radius Oval ($r_x \times r_y$) | Dimensi Total Oval |
|---|---|---|---|---|---|
| **1280 × 720** (Default) | 240 × 135 px | $0,1875$ | **28,4×** | $189 \times 252\text{ px}$ | $378 \times 504\text{ px}$ |
| **640 × 480** | 240 × 180 px | $0,3750$ | **7,1×** | $126 \times 168\text{ px}$ | $252 \times 336\text{ px}$ |
| **480 × 640** (Portrait) | 240 × 320 px | $0,5000$ | **4,0×** | $168 \times 224\text{ px}$ | $336 \times 448\text{ px}$ |
| **1920 × 1080** (FHD) | 240 × 135 px | $0,1250$ | **64,0×** | $283,5 \times 378\text{ px}$ | $567 \times 756\text{ px}$ |

---

## 4. Bagaimana Cara Mencocokkan Koordinat Kotak dengan Piksel Frame Asli?

**Masalah:** YuNet mendeteksi wajah di citra kecil (240×135), tapi bounding box harus digambar di layar besar (1280×720).

**Solusi (Pemetaan Balik):**
Detektor mengeluarkan array 15 angka. Koordinat langsung dibagi kembali dengan `scale`:

```python
# face_engine.py baris 95-96
faces[:, :4]  /= scale     # [x, y, w, h] dikembalikan ke ukuran frame asli
faces[:, 4:14] /= scale    # 5 titik landmark dikembalikan ke ukuran frame asli
```

**Contoh Angka Nyata:**
1. Di frame kecil YuNet, wajah terdeteksi pada $x = 40, y = 30, w = 60, h = 80$.
2. Dibagi `scale = 0.1875` (atau dikali $1280 / 240 = 5,333$):
   $$x = 40 / 0,1875 = 213,3\text{ px}$$
   $$y = 30 / 0,1875 = 160,0\text{ px}$$
   $$w = 60 / 0,1875 = 320,0\text{ px}$$
   $$h = 80 / 0,1875 = 426,7\text{ px}$$
3. Kotak digambar di koordinat piksel frame asli: $(213, 160)$ sampai $(533, 586)$.

---

## 5. Bagaimana Algoritma Menentukan Bounding Box Masuk ke Dalam Oval?

Sistem **tidak** sekadar mengecek titik tengah wajah, melainkan menguji **seluruh 4 sudut kotak wajah** menggunakan persamaan matematis elips (`face_engine.py:132-143`).

### Rumus Geometri Elips (`oval_need`):
1. Cari jarak terjauh sudut kotak dari pusat elips $(w/2, h/2)$:
   $$dx = |c_x - w/2| + \frac{b_w}{2}$$
   $$dy = |c_y - h/2| + \frac{b_h}{2}$$
2. Hitung nilai normalisasi elips:
   $$\text{oval\_need} = \sqrt{\left(\frac{dx}{r_x}\right)^2 + \left(\frac{dy}{r_y}\right)^2}$$

### Interpretasi Angka:
- **`oval_need <= 1.00`** $\rightarrow$ Keempat sudut kotak wajah berada di dalam oval. Status: **`ok`** (Oval berwarna Hijau, izinkan SFace mengenali identitas).
- **`oval_need > 1.00`** $\rightarrow$ Ada bagian wajah/kotak yang keluar garis oval. Status: **`face_outside_oval`** (Oval berwarna Merah, tolak proses pengenalan).

### Contoh Terukur (dijalankan ke `face_engine.oval_need`, 2026-11-05)
Frame 480×720, kotak wajah `[x=110, y=227, w=197, h=267]`, oval $r_x = 189,\ r_y = 252$:
- Pusat kotak: $c_x = 110 + 197/2 = 208,5$; $c_y = 227 + 267/2 = 360,5$.
- $dx = |208,5 - 240| + 98,5 = 130,0$; $dy = |360,5 - 360| + 133,5 = 134,0$.
- $\text{oval\_need} = \sqrt{(130/189)^2 + (134/252)^2} = \mathbf{0,8694} \le 1$ → status **`ok`**.
- Luas wajah: $197 \times 267 / (480 \times 720) = 0,1522$ → wajah menempati **15,22%** frame.

### Cek Tambahan: Wajah Terpotong Tepi Frame (`in_frame`)
- Ambang batas: `EDGE_TOLERANCE = 0.02` (2% dari resolusi).
- Pada 1280×720: toleransi tepi horizontal $1280 \times 0,02 = 25,6\text{ px}$, vertikal $720 \times 0,02 = 14,4\text{ px}$.
- Jika sisi kotak keluar batas ini $\rightarrow$ Status: **`partial_face`** (Cegah wajah terpotong masuk ke SFace karena akan menghasilkan nilai embedding acak/rusak).

---

## 6. Ringkasan Tanya-Jawab Cepat (Cheat Sheet Sidang/Review)

| Pertanyaan | Jawaban Singkat |
|---|---|
| *Berapa resolusi kamera yang dipakai?* | **1280 × 720 piksel (720p HD)** pada rasio 16:9. |
| *Berapa ukuran gambar yang diproses oleh AI YuNet?* | **240 × 135 piksel**, diperkecil dengan faktor skala `0.1875`. |
| *Kenapa tidak langsung proses di 720p?* | Jumlah piksel yang diproses YuNet turun **28,4×** (921.600 → 32.400), jadi deteksi tiap frame tetap ringan di CPU tanpa GPU. |
| *Berapa ukuran oval di layar?* | **378 × 504 piksel** ($r_x = 189\text{ px}, r_y = 252\text{ px}$), rasio tetap 3:4 tegak (*portrait*). |
| *Berapa ukuran citra saat ekstraksi identitas (SFace)?* | **112 × 112 piksel** hasil *align & crop* 5 titik landmark mata, hidung, dan mulut. |
| *Bagaimana AI tahu wajah sudah di dalam oval?* | Melalui fungsi `oval_need`: menghitung jarak 4 sudut terluar kotak terhadap radius elips. Nilai $\le 1.0$ berarti seluruh kotak berada di dalam oval. |

---

## 7. Lampiran: Bagaimana Frame Dibaca (`test_yunet_box.py`)

Dua sumber, satu format: **NumPy array BGR `uint8`, `(tinggi, lebar, 3)`**.

| Mode | Kode (baris) | Arti |
|---|---|---|
| Gambar statis | `frame = cv2.imread(args.image)` (125) | 1 baca dari disk; `None` → `sys.exit` (126) |
| Webcam live | `cap = cv2.VideoCapture(args.camera)` (148) → `ok, frame = cap.read()` (172) tiap iterasi loop | 1 frame per loop dari driver USB; `ok=False` → keluar loop |

Resolusi webcam dikunci sebelum loop (156–157): `cap.set(FRAME_WIDTH, 1280)` dan `cap.set(FRAME_HEIGHT, 720)`
— sama dengan stream web `/camera` sehingga oval Python ≡ oval browser. Resolusi aktual dicetak (160)
karena driver boleh memberi ukuran berbeda dari permintaan.

Aliran satu frame: `cap.read()/imread` → `fe.detect()` → `status_of()` → (bila `ok`) `recognize_box()`
→ `draw_identity` → `draw_status` (oval) → `draw_boxes` (kotak) → `imshow`/`imwrite`.
Semua `draw_*` melukis **in-place** di array frame yang sama.

## 8. Lampiran: Daftar Fungsi `test_yunet_box.py` (urut baris)

- `draw_boxes(frame, faces)` (20) — gambar `cv2.rectangle` hijau + teks `#{n} {skor:.2f}` per wajah.
- `status_of(frame, faces)` (35) — tentukan `ok | face_outside_oval | partial_face | no_face`; pilih
  wajah terluas via `fe.biggest`.
- `recognize_box(frame, face, db)` (50) — 1× `fe.embed` + `fe.recognize` → `(nama|None, skor)`;
  DB kosong → `(None, -1,0)` tanpa memanggil model.
- `draw_identity(frame, face, label)` (57) — tulis label di `y-26` (di atas teks skor di `y-8`).
- `draw_status(frame, faces)` (65) — gambar `cv2.ellipse` (hijau bila `ok`, merah bila tidak) +
  label Indonesia + baris info `frame: WxH | oval: 2rx×2ry px`.
- `report(faces)` (92) — cetak `x= y= w= h= skor=` tiap kotak ke terminal.
- `parse_args()` (100) — `--image --camera --save --no-gui --oval-auto --size`.
- `main()` (121) — mode gambar (124–146) / mode webcam (148–222, SFace ulang hanya bila IoU kotak
  `< 0,6` atau DB berubah); `if __name__ == "__main__"` (225) panggil `main()`.

Ukur ulang semua angka kapan saja: `cd apps/face-service` lalu
`python -c "import face_engine as fe; print(fe.guide_radii(1280,720))"`.
