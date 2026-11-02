# Cara Kerja Komunikasi 2FA: Face Recognition ↔ Sensor R503

> Penjelasan teknis alur verifikasi dua faktor (wajah + sidik jari) pada sistem Smart Classroom Attendance.
> Dokumen terkait: [fingerprint.md](fingerprint.md), [face-recognition.md](face-recognition.md), [database.md](database.md), [communication-flow.md](communication-flow.md).

---

## 1. Masalah Dasar: Sensor Tidak Mengenal Identitas

Sensor R503 bekerja mandiri di memori Flash internal. Karakteristiknya:
- Hanya menyimpan template biner pada nomor slot `1..200`.
- Tidak menyimpan NIS, nama, atau data diri siswa.
- Mengirim event `MATCH <slot> <confidence>` saat ada jari menempel yang cocok di memorinya.
- Tidak tahu **siapa** yang sedang menempelkan jari.

Oleh karena itu, sistem membutuhkan jembatan perantara: **database Supabase** sebagai pemeta identitas, dan **sesi 2FA di face-service** sebagai wasit pencocokan.

---

## 2. Tiga Lapisan Penyimpanan Data

| Lapisan | Komponen Fisik | Data yang Disimpan | Yang TIDAK Disimpan |
|---|---|---|---|
| **Sensor Sidik Jari** | Flash Internal R503 (DSP chip) | Nomor slot `1..200` + template biner fitur jari | NIS, nama siswa, foto |
| **Database Cloud** | Supabase PostgreSQL (`students`) | Peta relasi: `student_id` ↔ `fingerprint_slot` | Citra mentah / biner template jari |
| **Wasit 2FA (In-Memory)** | `FingerprintBridge` di laptop kelas | Sesi aktif: `student_id`, `slot`, `deadline` (TTL 30 detik) | Data permanen (semua hilang saat restart) |

---

## 3. Urutan Komunikasi & Eksekusi

Proses verifikasi wajib berurutan: **wajah lebih dulu, kemudian sidik jari**.

| Langkah | Komponen | Aksi & Protokol | Penjelasan |
|---|---|---|---|
| **1. Snapshot Wajah** | Browser Kiosk (`/camera`) | `canvas.toDataURL` → JPEG base64 | UI menangkap frame webcam saat wajah ada di area panduan. |
| **2. Deteksi & Identifikasi** | `/camera` → Route Handler → FastAPI | `POST /api/face/recognize` (HTTPS) | FastAPI menjalankan YuNet (deteksi) + SFace (vektor), lalu bandingkan cosine similarity ke database. |
| **3. Perolehan Identitas** | Route Handler → `/camera` | Respon JSON: `student_id`, `full_name`, `fingerprint_slot` | Wajah cocok. Sistem kini tahu siapa siswa tersebut dan slot jarinya. |
| **4. Pembukaan Sesi 2FA** | `/camera` → face-service | `POST /api/fingerprint/session` `{student_id, slot, ttl: 30}` | Mengunci wasit: *"Selama 30 detik ke depan, hanya slot N yang sah"*. |
| **5. Tempel Jari Fisik** | Siswa → Sensor R503 | Sentuhan fisik pada cincin sensor | R503 memindai dan mencocokkan secara 1:N di internal flash. |
| **6. Event Serial ke Laptop** | ESP32 → `fingerprint_serial.py` | USB Serial (115200 baud): `MATCH <slot> <score>\n` | ESP32 melaporkan nomor slot yang terdeteksi ke komputer. |
| **7. Validasi Wasit** | `FingerprintBridge` | Komparasi numerik: `<slot_terbaca> == <slot_sesi>` | Wasit menentukan apakah jari yang ditempel adalah pemilik wajah. |
| **8. Polling Status UI** | `/camera` → Route Handler | `GET /api/fingerprint/session` (interval 500 ms) | UI memperbarui status: `waiting`, `verified`, atau `failed`. |
| **9. Penyelesaian Sesi** | `/camera` → face-service | Sesi otomatis ditutup (`DELETE /fingerprint/session`) | Menghindari penggunaan ulang sesi yang sama. |

---

## 4. Matriks Logika & Penanganan Skenario

Setiap event serial dari R503 dievaluasi oleh fungsi `_apply_match` dengan aturan berikut:

| Skenario | Event Masuk dari R503 | Status Sesi | Hasil Logika | Tampilan UI Kiosk |
|---|---|---|---|---|
| **Normal (Sah)** | `MATCH 5 130` | Aktif (menunggu slot 5) | `verified` (score: 130) | Panel hijau: verifikasi selesai |
| **Salah Orang** (Jari teman) | `MATCH 2 120` | Aktif (menunggu slot 5) | `slot_mismatch`, percobaan +1 | Panel oranye/merah: jari tidak cocok |
| **Jari Tidak Terdaftar** | `NOMATCH` | Aktif (menunggu slot 5) | Percobaan +1 | Panel merah: sidik jari tidak dikenal |
| **Batas Percobaan Habis** | Percobaan ke-3 salah | Aktif | `failed` (sesi dibatalkan) | Wajib scan wajah ulang dari awal |
| **Waktu Habis (TTL)** | Tidak ada jari dalam 30 dtk | Melewati deadline | `expired` | Sesi kedaluwarsa; scan wajah ulang |
| **Tanpa Wajah** (Jari iseng) | `MATCH 5 130` | Tidak ada sesi aktif (`idle`) | Event dibuang (`ignored_matches` +1) | Tidak ada respon (bukan absensi) |
| **Siswa Belum Enroll Jari** | - | `fingerprint_slot` di DB = `NULL` | Sesi 2FA tidak dibuka | Banner: diarahkan enroll sidik jari |

---

## 5. Ringkasan Keamanan Alur Ini

1. **Anti-Titip Absen**: Seseorang tidak bisa menempelkan jari orang lain tanpa pemilik wajah berdiri di depan webcam, karena sesi 2FA hanya menunggu slot pemilik wajah yang terdeteksi.
2. **Anti-Spam Sensor**: Sensor yang disentuh terus-menerus tanpa deteksi wajah hanya akan memicu `ignored_matches` tanpa pernah menuliskan absensi ke database.
3. **Isolasi Biometrik**: Citra sidik jari mentah tidak pernah dikirim ke web browser maupun disimpan di cloud, seluruh pencocokan terjadi di tingkat hardware chip sensor.
