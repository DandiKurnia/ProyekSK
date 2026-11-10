# Prompt Claude — Pembuatan Manual Book Smart Classroom Attendance

> Salin seluruh isi blok di bawah ke Claude (Projects / New Chat) untuk membuat **Buku Panduan Pengguna & Pengembang (Manual Book / User & Technical Guide)** yang lengkap, rapi, dan siap lampirkan di laporan tugas akhir / proyek SK Gunadarma.

---

```markdown
Kamu adalah Technical Writer dan Embedded/AIoT Engineer senior. Buatkan DOKUMEN MANUAL BOOK LENGKAP (Panduan Pengguna & Pengembang) untuk sistem "Smart Classroom Attendance System berbasis IoT dan Biometrik 2-Faktor (Wajah YuNet/SFace + Sidik Jari R503 ESP32 + Monitoring Kursi HX711)".

Target dokumen: profesional, terstruktur rapi, siap pakai sebagai buku manual / lampiran Tugas Akhir Teknik Komputer Universitas Gunadarma.
Bahasa: Bahasa Indonesia formal & teknis.
Format output: Markdown lengkap dengan placeholder gambar `![Gambar X: Deskripsi](path/ke/foto.png)`, tabel pinout mendalam, diagram ASCII/Mermaid, dan langkah operasional langkah-demi-langkah.

Berikut spesifikasi teknis dan struktur yang HARUS ada:

---

## SPESIFIKASI SISTEM UNTUK MANUAL BOOK

### 1. Komponen Hardware & Pinout Lengkap
Jelaskan detail per modul, fungsi kabel/pin, level tegangan (3.3V vs 5V), peringatan keselamatan (jangan sampai salah polaritas), dan tabel pinout:

#### A. ESP32 DevKit V1 (30-pin) + Sensor Fingerprint R503
- Komunikasi: UART Serial2 (Hardware Serial ESP32)
- Baudrate: 57600 bps
- Tabel Pinout (wajib ada):
  | Warna Kabel R503 | Nama Pin R503 | Pin ESP32 (GPIO) | Level Tegangan | Keterangan / Fungsi |
  |---|---|---|---|---|
  | Merah | VCC | 3V3 / Vin (5V)* | 3.3V - 5V | Daya modul (*rekomendasi 3.3V jika dari ESP32) |
  | Hitam | GND | GND | 0V | Ground bersama |
  | Kuning | TXD (Sensor) | GPIO16 (RX2) | 3.3V Logic | Data keluar dari R503 menuju ESP32 |
  | Hijau | RXD (Sensor) | GPIO17 (TX2) | 3.3V Logic | Perintah dari ESP32 menuju R503 |
  | Biru | WAKEUP / Touch Sense | GPIO4 (Input) | 3.3V Logic | Sinyal interupsi sentuhan jari (opsional) |
  | Putih | Touch Power 3V3 | 3V3 | 3.3V | Daya sirkuit deteksi sentuhan cincin LED |
- Topologi Koneksi: ESP32 terhubung ke Komputer Kelas via **Kabel USB Serial** (misal `COM5` di Windows / `/dev/ttyUSB0` di Linux), baudrate USB CDC 115200 bps. Tidak memakai Wi-Fi polling untuk jalur absensi utama (USB Serial latency rendah & anti-drop jaringan).
- Panduan arti ring LED R503 (Biru = standby/siap, Ungu/Kuning = membaca/proses, Hijau = verifikasi cocok, Merah = gagal/timeout).

#### B. ESP32 DevKit V1 + Modul Sensor Kursi (Load Cell + HX711)
- Komunikasi: Two-Wire serial khusus HX711 (bukan I2C murni)
- Koneksi ke Backend: HTTPS Wi-Fi ke Route Handler Next.js / Supabase
- Tabel Pengkabelan Load Cell (4 Kawat) ke Board HX711:
  | Warna Kawat Load Cell | Terminal HX711 | Fungsi |
  |---|---|---|
  | Merah | E+ (Excitation +) | Tegangan eksitasi positif |
  | Hitam | E- (Excitation -) | Tegangan eksitasi negatif / Ground |
  | Putih | A- (Signal -) | Sinyal diferensial minus |
  | Hijau | A+ (Signal +) | Sinyal diferensial plus |
- Tabel Pinout HX711 ke ESP32:
  | Pin HX711 | Pin ESP32 (GPIO) | Keterangan |
  |---|---|---|
  | VCC | 5V (Vin) / 3V3 | Catu daya penguat analog |
  | GND | GND | Ground |
  | DT (Data) | **[ISI: GPIO ESP32-mu, mis. GPIO21]** | Sinyal data serial digital dari ADC |
  | SCK (Clock)| **[ISI: GPIO ESP32-mu, mis. GPIO22]** | Pulsa clock pembacaan |
- Prosedur Kalibrasi & Tare:
  1. Tare kosong (tanpa beban).
  2. Beban kalibrasi standar (misal 5 kg / 10 kg).
  3. Perhitungan `calibration_factor`.
  4. Logika filter histeresis threshold (misal > 15 kg = `occupied`, < 10 kg = `empty`, rentang antara = pertahankan status lama untuk redam fluktuasi).

#### C. Kamera & Host PC Kelas
- Webcam USB (minimal 720p / 1080p, disarankan 30 fps stabil).
- Komputer Kelas (Host PC) menjalankan:
  - Python FastAPI Service (`:8000`) — model YuNet (deteksi) & SFace (ekstraksi embedding 128-d).
  - Bridge USB Serial ke ESP32 Fingerprint (`fingerprint_serial.py`).

---

### 2. Arsitektur Perangkat Lunak & Aliran Data
Gambarkan arsitektur end-to-end:
1. **Frontend / Dashboard**: Next.js 14 App Router, Tailwind CSS, Lucide icons, Supabase Client & Realtime.
2. **Backend**: Next.js Route Handlers (`/api/...`) sebagai satu-satunya single-source-of-truth status absensi.
3. **Database**: Supabase PostgreSQL + Supabase Auth (Role: Admin, Teacher, Observer) + Realtime channels (`attendance`, `seat_status`, `devices`).
4. **Local Face Service**: FastAPI (`apps/face-service/server.py`) di port 8000 dengan OpenCV Zoo (YuNet + SFace). File database vektor `embeddings_yunet.npz` (vektor 128 dimensi per siswa). Vektor biometrik TIDAK melintasi internet ke cloud (privacy-by-design).

Alur Verifikasi 2-Faktor (2FA):
- Step 1: Siswa berdiri di depan kamera (panduan oval portrait rasio 3:4 di web `/camera`).
- Step 2: Kamera kirim frame base64 -> Route Handler -> FastAPI `:8000/recognize`.
- Step 3: YuNet deteksi wajah + validasi kualitas (`in_frame`, `in_guide` oval, `oval_need <= 1.0`). SFace ekstrak embedding -> Cosine similarity vs `.npz` (threshold 0.40, margin 0.08).
- Step 4: Jika wajah terverifikasi -> PC kelas kirim perintah serial `VERIFY <student_id> <timeout_ms>` ke ESP32 Fingerprint.
- Step 5: Ring LED R503 menyala biru/ungu -> siswa menempelkan sidik jari -> ESP32 mencocokkan template R503 -> respon `MATCH` / `NO_MATCH` / `TIMEOUT`.
- Step 6: PC kelas kompilasi hasil final 2FA dan POST ke Route Handler `/api/attendance` -> masuk PostgreSQL Supabase -> status `Present` / `Late` -> Dashboard update real-time via WebSocket.

---

### 3. Struktur Bab Dokumen Manual Book yang Harus Dihasilkan

Buat dokumen manual book dengan bab-bab berikut secara sangat detail dan terstruktur:

# BUKU PANDUAN PENGGUNA DAN PENGEMBANG (MANUAL BOOK)
## SMART CLASSROOM ATTENDANCE SYSTEM BERBASIS IoT & BIOMETRIK 2-FAKTOR

### BAB 1: PENDAHULUAN
1.1 Deskripsi Umum Sistem
1.2 Tujuan & Manfaat
1.3 Batasan Sistem
1.4 Arsitektur Global (Sertakan Diagram ASCII / Mermaid)

### BAB 2: SPESIFIKASI DAN PANDUAN HARDWARE
2.1 Daftar Kebutuhan Perangkat Keras (BOM - Bill of Materials)
2.2 Pinout Lengkap ESP32 DevKit V1 (Tabel detail seluruh pin yang dipakai + pin bebas yang bisa diekspansi)
2.3 Pengkabelan ESP32 ke Sensor Fingerprint R503 (Tabel pin, skema warna, catatan pull-up/tegangan)
    - Tempatkan: `![Gambar 2.1: Skema Pengkabelan ESP32 ke R503](manual-images/wiring-esp32-r503.png)`
2.4 Pengkabelan ESP32 ke Load Cell + Modul HX711 (Tabel 4 kawat strain gauge + kabel DT/SCK ke GPIO)
    - Tempatkan: `![Gambar 2.2: Skema Pengkabelan Load Cell dan HX711](manual-images/wiring-loadcell-hx711.png)`
2.5 Spesifikasi Kamera & Penempatan Fisik di Ruang Kelas (Jarak ideal, sudut, pencahayaan)
    - Tempatkan: `![Gambar 2.3: Tata Letak Fisik Kamera, Scanner, dan Kursi di Kelas](manual-images/layout-ruang-kelas.png)`

### BAB 3: INSTALASI DAN SETUP LINGKUNGAN PENGEMBANGAN
3.1 Prasyarat Sistem (Node.js v18+, Python 3.10+, Arduino IDE / PlatformIO, Git)
3.2 Setup Firmware ESP32 (Konfigurasi baudrate, library Adafruit-Fingerprint, flashing via Arduino IDE)
3.3 Setup Backend & Database Supabase (Variabel env, migrasi schema SQL, RLS Policy)
3.4 Setup Face Recognition Service (Instalasi `requirements.txt`, unduh model ONNX YuNet & SFace, verifikasi `:8200/health`)
3.5 Setup Dashboard Web Next.js (Konfigurasi `.env.local`, `npm install`, `npm run dev`)

### BAB 4: PANDUAN PENGOPERASIAN DASHBOARD WEB (ADMIN & GURU)
Setiap menu harus ada penjelasan: Fungsi, Elemen Antarmuka, Langkah Operasional, dan Placeholder Screenshot:
4.1 Halaman Autentikasi / Login (`/login`)
    - Tempatkan: `![Gambar 4.1: Antarmuka Login Dashboard](manual-images/dashboard-00-login.png)`
4.2 Menu Overview (`/overview` atau `/`) — KPI kehadiran, okupansi kelas real-time, aktivitas terbaru
    - Tempatkan: `![Gambar 4.2: Tampilan Dashboard Overview Real-time](manual-images/dashboard-01-overview.png)`
4.3 Menu Kiosk Absensi Kamera (`/camera`) — Oval panduan 3:4, indikator deteksi wajah, petunjuk suara/visual
    - Tempatkan: `![Gambar 4.3: Halaman Kiosk Scanner Wajah dengan Panduan Oval](manual-images/dashboard-02-camera.png)`
4.4 Menu Attendance (`/attendance`) — Log absensi, filter tanggal/kelas/status, rincian skor 2FA
    - Tempatkan: `![Gambar 4.4: Tabel Riwayat Absensi dan Status 2FA](manual-images/dashboard-03-attendance.png)`
4.5 Menu Students & Enrollment (`/students`, `/students/enroll`) — Manajemen data siswa, pendaftaran foto wajah & fingerprint
    - Tempatkan: `![Gambar 4.5: Daftar Siswa dan Status Enrollment Biometrik](manual-images/dashboard-04-students.png)`
    - Tempatkan: `![Gambar 4.6: Alur Form Enrollment Wajah](manual-images/dashboard-04-enroll-face.png)`
4.6 Menu Classes & Seats (`/classes-seats`) — Denah kursi, status okupansi load cell (`occupied`/`empty`/`unknown`), berat kg
    - Tempatkan: `![Gambar 4.7: Peta Visual Okupansi Kursi Kelas](manual-images/dashboard-05-classes-seats.png)`
4.7 Menu Device Monitoring (`/devices`) — Status koneksi ESP32, PC kelas, status port COM serial, heartbeat
    - Tempatkan: `![Gambar 4.8: Panel Monitoring Kesehatan Perangkat IoT](manual-images/dashboard-06-devices.png)`
4.8 Menu Reports (`/reports`) — Rekap absensi mingguan/bulanan, ekspor data CSV/Excel
    - Tempatkan: `![Gambar 4.9: Rekapitulasi Laporan dan Ekspor Data](manual-images/dashboard-07-reports.png)`
4.9 Menu Settings (`/settings`) — Pengaturan jam masuk, toleransi keterlambatan, threshold sensor
    - Tempatkan: `![Gambar 4.10: Konfigurasi Sistem dan Ambang Batas](manual-images/dashboard-08-settings.png)`

### BAB 5: PROSEDUR OPERASIONAL STANDAR (SOP)
5.1 SOP Pendaftaran Siswa Baru (Enrollment Wajah & Sidik Jari)
5.2 SOP Pelaksanaan Absensi Harian di Awal Jam Pelajaran
5.3 SOP Penanganan Siswa Terlambat atau Gagal Verifikasi
5.4 SOP Kalibrasi Ulang Sensor Kursi (Tare Beban Nol)

### BAB 6: PANDUAN PEMECAHAN MASALAH (TROUBLESHOOTING)
6.1 Masalah Hardware ESP32 & R503 (Sensor tidak merespon, LED mati, baudrate mismatch, error serial)
6.2 Masalah Sensor HX711 (Nilai berat melayang/drift, pembacaan 0 kg terus menerus, noise kabel)
6.3 Masalah Face Recognition (Wajah tidak terdeteksi, false accept/reject, webcam tidak terbuka, port 8200 crash)
6.4 Masalah Koneksi & Supabase (Realtime disconnected, CORS error, data stale)
6.5 Tabel Kode Kesalahan (Error Code Matrix) dan Solusi Cepat

### BAB 7: PEMELIHARAAN SISTEM & BACKUP
7.1 Backup Database Supabase & File Embedding `.npz`
7.2 Prosedur Update Firmware ESP32
7.3 Pembersihan Fisik Sensor R503 dan Kamera

---

Tuliskan seluruh isi manual book ini secara komprehensif, teknis, lugas, tanpa bagian yang terpotong (jangan gunakan komentar seperti "...tuliskan sisanya di sini..."). Sediakan tabel yang detail dan bahasa instruksional yang jelas.
```
