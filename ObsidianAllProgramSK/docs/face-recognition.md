# Face Recognition — Pengenalan Wajah

> **Terverifikasi sebagian (2026-10-20)** — pola YuNet-live + SFace-on-demand sudah diuji di `apps/face-service/main.py` (Python 3.10, `opencv-contrib-python` 4.13, CPU). Bagian FastAPI/Route Handler masih rancangan.

## Tujuan

Face recognition adalah **faktor identifikasi pertama**: menentukan *siapa* siswa di depan webcam, sekali per kedatangan. Ia tidak mencatat absensi — hanya mengunci satu kandidat identitas, lalu sesi verifikasi fingerprint (30 detik) yang menentukan. Faktor kedua (fingerprint R503) memutus hasil akhir.

Dokumen terkait: [architecture.md](architecture.md), [backend.md](backend.md), [communication-flow.md](communication-flow.md).

## Keputusan Arsitektur (hasil uji 2026-10-20)

| Keputusan | Pilihan | Bukti uji |
|---|---|---|
| Pola inferensi | **YuNet tiap frame, SFace on-demand 1x** | InsightFace `FaceAnalysis` (4 model/frame @640px) patah-patah; SFace tiap 20 frame masih spike lag tiap bounding box muncul; SFace on-demand → feed mulus |
| Verifikasi | SFace `2021dec`, cosine, threshold `0.40` + margin rank1-rank2 `0.08` | uji 2026-10-21: genuine=1.0 lolos, acak=0.02 ditolak, midpoint ambigu=0.72 ditolak |
| Penyimpanan | `embeddings.npz` lokal PC kelas | Restart-safe (dibuktikan: DB terbaca ulang); tanpa foto, tanpa cloud |

Yang ditolak: `face_recognition`/dlib (build C++ gagal di Windows), MediaPipe (API asing, selisih hemat kecil), DeepFace (>1 GB).

## Teknologi

| Teknologi | Fungsi |
|---|---|
| Python 3.10+ (target 3.11) | Runtime service lokal |
| OpenCV contrib (modul DNN/Face) | YuNet deteksi + SFace embedding, CPU-only |
| YuNet | **Di mana wajahnya** — box + 5 landmark + skor, tiap frame |
| SFace | **Wajah siapa** — embedding 128-dimensi dari crop ter-align, hanya saat verifikasi/enrollment |
| FastAPI *(rencana)* | Membungkus pipeline menjadi API lokal (`/health`, `/recognize`, `/enroll`) |
| Model ONNX | `face_detection_yunet_2023mar.onnx` (~227 KB), `face_recognition_sface_2021dec.onnx` (~37 MB), di `apps/face-service/models/` (git-ignored) |

## Model yang Digunakan (YuNet + SFace)

Dua model ONNX dari [OpenCV Zoo](https://github.com/opencv/opencv_zoo), dimuat lewat modul `cv2` (`FaceDetectorYN` / `FaceRecognizerSF`) — **bukan** PyTorch/TensorFlow, tanpa GPU.

| Komponen | Model | File & ukuran | Peran | Lisensi |
|---|---|---|---|---|
| Detektor | **YuNet** `face_detection_yunet_2023mar` | `models/face_detection_yunet_2023mar.onnx` · 227 KB | Cari kotak wajah + 5 landmark (2 mata, hidung, 2 sudut mulut) | MIT |
| Pengenal | **SFace** `face_recognition_sface_2021dec` | `models/face_recognition_sface_2021dec.onnx` · 36.9 MB | Crop ter-align 112×112 → vektor 128 angka | Apache-2.0 |

Akurasi resmi (evaluasi OpenCV Zoo, `tools/eval`):

| Model | Metrik | Nilai |
|---|---|---|
| YuNet | WIDER Face AP — Easy / Medium / Hard | 0.8844 / 0.8656 / 0.7503 |
| SFace | Akurasi verifikasi (pasangan uji) | 0.9940 |

### Dokumentasi & Sumber

- **YuNet — model card:** https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
- **YuNet — paper:** Wu, Peng, Yu. *YuNet: A Tiny Millisecond-level Face Detector*, Machine Intelligence Research 20(5), 2023 → https://link.springer.com/article/10.1007/s11633-023-1423-y
- **YuNet — kode training:** https://github.com/ShiqiYu/libfacedetection.train
- **YuNet — API OpenCV:** https://docs.opencv.org/4.x/df/d20/classcv_1_1FaceDetectorYN.html
- **SFace — model card:** https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface
- **SFace — paper:** Li et al. *SFace: Sigmoid-Constrained Hypersphere Loss for Robust Face Recognition*, IEEE TIP 2021 → https://arxiv.org/abs/2205.12010
- **SFace — kode asli:** https://github.com/zhongyy/SFace
- **SFace — API OpenCV:** https://docs.opencv.org/4.10.0/da/d09/classcv_1_1FaceRecognizerSF.html
- **Tutorial gabungan YuNet + SFace:** https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html

Catatan model card: SFace yang dipakai adalah **MobileFaceNet** yang dilatih dengan loss SFace; YuNet dapat mendeteksi wajah berukuran ±10×10 sampai 300×300 px.

### Peran OpenCV vs Mengapa Tidak Pakai YOLO

Sistem ini **memakai OpenCV** (`opencv-contrib-python`, diimpor sebagai `cv2`), tetapi **tidak memakai YOLO** (`ultralytics` / PyTorch) dan **tidak memakai Haar Cascade** lama (`haarcascade_frontalface_default.xml`).

| Komponen / Library | Dipakai? | Fungsi di `apps/face-service/` |
|---|---|---|
| **OpenCV (`cv2`)** | **Ya** | 1) Decode gambar Base64 (`cv2.imdecode`) & resize frame (`cv2.resize`)<br>2) Mesin inferensi ONNX bawaan (`cv2.FaceDetectorYN` untuk YuNet, `cv2.FaceRecognizerSF` untuk SFace)<br>3) Alignment wajah 112×112 (`alignCrop`) & hitung kemiripan cosine (`match`) |
| **YuNet (ONNX)** | **Ya** | Detektor wajah pengganti YOLO: langsung menghasilkan kotak wajah (`bbox`) **+ 5 titik landmark** (2 mata, hidung, 2 sudut mulut) |
| **SFace (ONNX)** | **Ya** | Pengenal identitas: mengubah wajah 112×112 menjadi vektor 128 angka (`float32`) |
| **YOLO (`ultralytics` / PyTorch)** | **Tidak** | Tidak dipakai — YOLO standar hanya mengeluarkan kotak objek tanpa 5 titik landmark wajah (padahal `SFace.alignCrop` wajib butuh 5 titik mata/hidung/mulut), serta butuh dependensi PyTorch (~2 GB) |
| **Haar Cascade (OpenCV lama)** | **Tidak** | Tidak dipakai — mudah salah deteksi saat kepala miring/kacamata dan tidak punya 5 landmark |

### Bukti visual (contoh resmi model)

![YuNet — hasil deteksi pada selfie (OpenCV Zoo)](https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/example_outputs/largest_selfie.jpg)

*YuNet: box + 5 landmark per wajah. Sumber: OpenCV Zoo `example_outputs`.*

![SFace — verifikasi identitas (OpenCV Zoo)](https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/example_outputs/demo.jpg)

*SFace: kiri = identitas target, kanan = query. Box hijau = orang sama, merah = berbeda. Sumber: OpenCV Zoo `example_outputs`.*

### Pipeline di `face_engine.py`

```mermaid
flowchart LR
    A[frame webcam 640x480] -->|resize lebar 240 px| B[YuNet detect]
    B -->|bbox + 5 landmark, skala dibalik| C[biggest: wajah terluas]
    C --> D[SFace alignCrop 112x112]
    D --> E[SFace feature: 128 float32]
    E --> F[normalisasi L2]
    F --> G[embedding .npz per student_id]
    E --> H[cosine vs semua kunci .npz]
    H --> I{skor >= 0.40 dan selisih rank1-rank2 >= 0.08?}
    I -- ya --> J[kandidat terkunci]
    I -- tidak --> K[tak dikenal, tanpa kirim]
```

Fakta teknis yang berlaku di kode:

| Aspek | Nilai | Lokasi |
|---|---|---|
| Lebar input deteksi | 240 px (`DET_WIDTH`), koordinat diskalakan balik | `face_engine.py:22`, `detect()` |
| Dimensi embedding | 128 float32 (dibuktikan dari `embeddings_yunet.npz`, shape `(128,)`) | `embed()` |
| Metrik jarak | cosine (`FaceRecognizerSF_FR_COSINE`) | `cosine()` |
| Ambang | `THRESHOLD = 0.40`, `MARGIN = 0.08` | `face_engine.py:20-21` |
| Deteksi tiap frame | hanya YuNet; SFace on-demand (trigger) | `main.py`, `server.py` |
| Unduh model | otomatis sekali via `urllib` bila file `.onnx` belum ada; `.onnx` di-gitignore | `_download()` |

**Catatan akurasi enroll:** tiap sampel datang sebagai request terpisah, dan `enroll_embedding()` menyimpan `(vektor_lama + vektor_baru) / 2` lalu L2-normalize. Artinya bobot sampel lama mengecil tiap enroll baru — sampel terakhir paling dominan. Ini sengaja dipilih karena sederhana; bila hasil verifikasi terasa tidak stabil, naikkan ke penyimpanan multi-vektor (simpan semua sampel, bandingkan ke rata-rata penuh) tanpa mengubah kontrak endpoint.

### Catatan Deteksi Kacamata (Dihapus)

Sempat diuji coba heuristik piksel-gelap di band mata untuk mendeteksi kacamata dan memberi saran "lepas kacamata". Fitur ini **dihapus total** per 2026-11-01 setelah divalidasi langsung pada data webcam nyata (871 frame di `apps/face-service/kalibrasi.csv`):
- Rata-rata rasio gelap mata:pipi untuk wajah tanpa-kacamata = `1.005` vs berkacamata = `1.014`.
- Median justru terbalik (`1.067` vs `0.843`) akibat pantulan cahaya di permukaan lensa.
- Ambang heuristik apa pun menghasilkan prediksi salah.

Keputusan: heuristik dihapus, field `glasses` dibuang dari response `POST /recognize`, dan alert di UI web dihilangkan. Deteksi kacamata tidak menjadi syarat sistem absensi; bila kelak dihidupkan kembali, harus menggunakan classifier berbasis model terpisah (mis. ONNX terlatih).

### Validasi Posisi Wajah di Oval Panduan (Bounding Box Extent)

Pengecekan apakah wajah berada di dalam oval panduan dihitung dari **seluruh kotak wajah (bounding box YuNet)**, bukan hanya titik tengahnya:
- Keempat sudut kotak wajah harus berada di dalam elips panduan (`GUIDE_RX` dan `GUIDE_RY`).
- Nilai `oval_need` merepresentasikan radius vertikal minimum yang dibutuhkan agar kotak wajah termuat penuh di oval dengan rasio tetap (0.8).
- Kalibrasi ukuran oval: jalankan `python test_yunet_box.py --oval-auto` selama ~10 detik. Saat keluar, skrip menghitung kuantil 95% dari distribusi `oval_need` dan otomatis memperbarui nilai `GUIDE_RX, GUIDE_RY` di `face_engine.py` (via `fit_oval.py`).
- Komponen web di `/camera` mengambil nilai geometri oval secara dinamis dari endpoint `GET /health` sehingga UI klien dan server selalu seirama.
- Wadah video web mengikuti rasio kamera aktual (`videoAspect`) dan `object-contain` (tanpa crop), sehingga proporsi oval FE 100% identik dengan koordinat Python. Gunakan flag `--size LxT` pada `test_yunet_box.py` bila ingin mengunci resolusi sama persis dengan stream browser.

## Kebutuhan Perangkat dan Model

| Kebutuhan | Terverifikasi |
|---|---|
| Webcam 720p, cahaya depan | Ya — capture diset 640×480 agar decode cepat |
| CPU multi-core, RAM 8 GB | Ya — tanpa GPU |
| Model ONNX | Auto-download sekali via `urllib` saat start bila file belum ada |
| Penyimpanan embedding | `apps/face-service/embeddings_yunet.npz` — map nama → vektor float32 ter-normalisasi |

## Alur Enrollment Wajah Siswa

Terverifikasi di `main.py` (mode keyboard `e`):

1. Operator menekan `e` saat tepat satu wajah valid di frame (terbesar dipilih bila >1).
2. YuNet mendeteksi → SFace menghitung 1 embedding dari crop ter-align.
3. Embedding dirata-rata dengan sampel sebelumnya untuk nama yang sama, lalu dinormalisasi ulang (L2).
4. Disimpan ke `embeddings_yunet.npz`. Ulangi 3–5x dari sudut berbeda (lurus, kiri, kanan, mundur).
5. Versi FastAPI: `POST /enroll` dengan `student_id` + liste frame; `DELETE /enroll/{student_id}` menghapus barisnya (mis. siswa pindah).

## Alur Deteksi dari Frame Webcam

Pola on-demand (bukan tiap frame):

```
Webcam → Capture (640x480) → YuNet @240px tiap frame → gambar box (selalu mulus)
  → [trigger: wajah baru / tombol v / API] → SFace 1x → cosine vs DB lokal
  → Skor >= threshold → kunci kandidat → VERIFY serial ke ESP32 → POST hasil final ke Route Handler (sesi lokal 30 dtk)
  → Skor < threshold → "tak dikenal", tanpa pengiriman
```

Detail tahap:

1. **Capture** — 640×480, decode cepat.
2. **YuNet live** — deteksi di frame downscale 240px, box diskala balik ke penuh. Satu-satunya kerja tiap frame.
3. **Quality check** — tolak bila: tidak ada wajah, wajah terlalu kecil/blur, skor deteksi rendah.
4. **Trigger verifikasi** — SFace jalan 1x hanya saat: wajah baru masuk (IoU < 0.3 vs box sebelumnya), label kedaluwarsa, atau panggilan API. Tidak ada embedding periodik tanpa trigger.
5. **Compare** — cosine similarity vs seluruh embedding terdaftar, ambil tertinggi.
6. **Threshold check** — lolos → kandidat; gagal → "tak dikenal".
7. **Selesaikan 2FA lokal** — kandidat → `VERIFY` serial ke ESP32 via USB; hasil `MATCH`/`NO_MATCH`/`TIMEOUT` → 1 POST final ke Route Handler.

## Aturan Label / Anti-Stale (terverifikasi)

Bug yang ditemukan saat uji: label nama menempel global sehingga wajah berikutnya (mis. foto Elon) mewarisi nama sebelumnya. Aturan yang berlaku di `main.py` dan wajib di versi FastAPI:

1. **Wajah hilang dari frame → label langsung kosong.** Siswa berikutnya mulai dari tanpa nama.
2. **Ganti orang (IoU box < 0.3) → label kosong.** Posisi/ukuran melompat drastis = orang berbeda.
3. **Label kedaluwarsa (TTL 5 detik) → label kosong.** Butuh verifikasi ulang walau orang sama.

## Threshold dan Kalibrasi

- Threshold **MUST** dikalibrasi dari data nyata (skor genuine pemilik vs skor impostor), bukan default pustaka.
- Nilai awal `0.40`. Prosedur: catat skor diri sendiri vs skor orang lain/foto, pasang threshold di tengah (dugaan awal `0.50–0.55`, tunggu angka uji).
- Tinjau ulang tiap penambahan batch siswa baru.

## Penanganan Kasus Khusus

| Kasus | Penanganan |
|---|---|
| Skor < threshold | Tidak mengirim kandidat; log lokal; arahkan ke enrollment |
| Banyak wajah dalam frame | Proses wajah terbesar; antrean satu orang di depan kamera |
| Skor zona abu-abu | Minta ulangi capture atau lanjut fingerprint manual |
| Wajah terhalang (masker, tangan) | Tolak di quality check |
| Wajah belum enroll | Box polos tanpa nama (aturan anti-stale); bukan nama siswa lain |

## Penyelesaian 2FA Lokal + Pengiriman Hasil Final

Face service tidak mengirim kandidat mentah ke cloud. Ia memutus 2FA sendiri via USB Serial ke ESP32 (lihat [fingerprint.md](fingerprint.md)), lalu mengirim **1 hasil final** ke Route Handler:

`POST /api/attendance` (HTTPS, kredensial perangkat):

```json
{
  "device_id": "class-pc-01",
  "student_id": "STD-2024-001",
  "face_confidence": 0.71,
  "fingerprint_slot": 12,
  "fingerprint_score": 180,
  "captured_at": "2026-10-20T07:01:22+07:00"
}
```

Respons: record absensi tersimpan (`present`/`late`) atau ditolak (duplikat/aturan) — detail di [backend.md](backend.md).

## Endpoint Service Lokal

> `main.py` saat ini memakai keyboard (`v`/`e`/`c`/`q`). Tabel di bawah adalah kontrak FastAPI yang menggantikannya — **belum diimplementasikan**.

| Method & Path | Fungsi |
|---|---|
| `GET /health` | Status service + versi model + jumlah wajah terdaftar |
| `POST /recognize` | Satu frame → kandidat identitas (SFace 1x) |
| `POST /enroll` | Daftarkan/perbarui embedding siswa |
| `DELETE /enroll/{student_id}` | Hapus data wajah siswa |

Contoh `GET /health` → `200 OK`:

```json
{
  "status": "ok",
  "models": { "detector": "yunet_2023mar", "recognizer": "sface_2021dec" },
  "registered_faces": 1
}
```

Contoh `POST /recognize` request:

```json
{
  "image_base64": "<base64 JPEG>",
  "min_confidence": 0.5
}
```

Response cocok:

```json
{
  "faces_detected": 1,
  "match": true,
  "student_id": "S-2026-0042",
  "confidence": 0.71,
  "threshold_used": 0.5
}
```

Response tidak dikenal:

```json
{
  "faces_detected": 1,
  "match": false,
  "student_id": null,
  "confidence": 0.32,
  "threshold_used": 0.5,
  "reason": "below_threshold"
}
```

Contoh `POST /enroll`:

```json
{
  "student_id": "S-2026-0042",
  "images_base64": ["<base64>", "<base64>"]
}
```

```json
{
  "student_id": "S-2026-0042",
  "enrolled": true,
  "samples_used": 2
}
```

## Diagram Flowchart

```mermaid
flowchart TB
    A[Webcam: Capture 640x480] --> B[YuNet tiap frame @240px]
    B --> C{Ada wajah?}
    C -- Tidak --> Z[Reset label, tanpa absensi]
    C -- Ya --> D[Gambar box + cek IoU/TTL]
    D --> E{Wajah baru / trigger?}
    E -- Tidak --> D
    E -- Ya --> F[SFace 1x + compare DB]
    F --> G{Skor >= threshold?}
    G -- Tidak --> Z
    G -- Ya --> H[Kunci kandidat + VERIFY via USB Serial]
    H --> I[Sesi lokal 30 dtk, POST final ke cloud]
```

## Sequence Diagram

```mermaid
sequenceDiagram
    participant W as Webcam
    participant F as Service Lokal
    participant B as Route Handler Next.js
    participant E as ESP32 R503
    W->>F: Frame (YuNet live)
    alt Skor >= threshold
        F->>E: Serial VERIFY (USB, ms)
        E-->>F: Serial MATCH slot + skor
        F->>B: POST hasil final 2FA
        B-->>F: Record tersimpan (present/late)
    else Skor < threshold
        F->>F: Label tak dikenal, tanpa pengiriman
    end
```

## Penanganan Error dan Troubleshooting

| Gejala | Penyebab terverifikasi | Tindakan |
|---|---|---|
| `ValueError: truth value of array ambiguous` | `detector.detect` kembalikan ndarray; `if faces:` gagal | Kembalikan list baris (`[row for row in faces]`), cek `len()` — sudah diperbaiki |
| Gerakan patah saat box muncul | SFace jalan otomatis tiap N frame | Matikan embedding periodik; SFace hanya on-demand — sudah diperbaiki |
| Label nama menempel ke wajah lain | Label global tanpa reset | Terapkan 3 aturan anti-stale (hilang/IoU/TTL) — sudah diperbaiki |
| Selalu "tidak dikenal" | Threshold tinggi / belum enroll / cahaya buruk | Kalibrasi ulang, enroll 4 sudut, perbaiki cahaya |
| Model gagal dimuat | Path salah saat run dari folder lain | Path absolut ke `BASE_DIR` — sudah diperbaiki |
| `GET /health` gagal (nanti) | Service belum jalan / port salah | Cek proses, port, log startup |

## Privasi Data Biometrik dan Pengamanan Akses

- Simpan **embedding** (vektor), bukan foto. Foto hanya hidup di RAM sesaat.
- `embeddings.npz` + `models/*.onnx` di-gitignore — tidak pernah ke-commit.
- Service lokal **MUST NOT** diekspos ke internet; hanya localhost/LAN kelas.
- Kandidat ke Route Handler via HTTPS + kredensial perangkat (detail di [communication-flow.md](communication-flow.md)).
- Tidak ada endpoint yang membuang seluruh DB embedding.
- Hapus siswa = hapus baris embedding lokal + template R503 + nonaktifkan di Supabase.
