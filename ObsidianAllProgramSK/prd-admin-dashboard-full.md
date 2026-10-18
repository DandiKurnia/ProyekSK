# PRD Sistem Lengkap — Admin Dashboard Smart Classroom Attendance

> **Dokumen Spesifikasi Fungsional Tunggal (Master System PRD)**  
> Disusun sebagai acuan arsitektur sistem dan data untuk pembuatan antarmuka web, perancangan komponen UI, dan implementasi frontend.  
> **Fokus:** Aliran data, struktur menu/halaman, logika sistem, aksi pengguna, role access (RBAC), integrasi REST/WebSocket, dan penanganan exception.  
> **Bebas styling visual:** Tidak memuat aturan warna hex, tipografi, tema, atau elemen grafis murni.

---

## 1. Konteks Arsitektur & Batasan Sistem

Sistem ini adalah antarmuka web administratif (*Admin Dashboard*) untuk **Smart Classroom Attendance & Monitoring**, berbasis Hybrid AIoT:

1. **Backend Pusat**: NestJS berjalan online (HTTPS REST + WebSocket Gateway), terhubung ke database PostgreSQL. NestJS adalah satu-satunya otak penentu status absensi dan validasi sesi.
2. **Edge Pengenal Wajah**: Komputer kelas lokal menjalankan FastAPI + OpenCV YuNet & SFace. Melakukan deteksi/ekstraksi wajah lokal, lalu mengirim kandidat ID siswa ke NestJS via HTTPS.
3. **Edge Biometrik Sidik Jari**: ESP32 + sensor R503 terhubung ke Wi-Fi sekolah. Melakukan HTTP long-polling ke NestJS untuk mengambil antrian verifikasi sidik jari, mencocokkan template di ROM lokal sensor, dan mengirim hasil cocok/tidak ke NestJS.
4. **Edge Telemetri Kursi**: ESP32 + sensor load cell & modul amplifier HX711 memantau tekanan fisik kursi. Mengirim status keterisian kursi berkala ke NestJS via HTTP POST.
5. **Dashboard Web (Sistem Ini)**: Berjalan di browser staf sekolah (Admin, Guru/Teacher, Observer). Mengambil data via REST HTTPS dan menerima pembaruan instan via WebSocket.

### Batasan Ruang Lingkup (Scope Boundaries)
- **Hanya untuk staf sekolah**: Halaman login dan dashboard hanya untuk peran administratif (`Admin`, `Teacher`, `Observer`).
- **Siswa tidak memiliki akun login**: Siswa tidak login ke dashboard web ini. Kehadiran siswa murni diverifikasi melalui sensor biometrik fisik di ruang kelas.
- **Pemisahan kursi dan identitas**: Sensor kursi memantau okupansi fisik murni (*empty*, *occupied*, *unknown*), **tidak memetakan identitas siswa ke nomor kursi**. Kehadiran resmi siswa hanya berasal dari verifikasi biometrik 2 faktor (wajah + sidik jari).
- **Perlindungan privasi biometrik**: Dashboard web **tidak pernah menerima, menampilkan, atau mengunduh data biometrik mentah** (foto wajah mentah, embedding vektor float, atau template sidik jari). Web hanya berurusan dengan metadata status (*enrolled*, *not enrolled*, waktu enrollment, kualitas/ambang batas).

---

## 2. Model Pengguna & Matriks Hak Akses (RBAC)

Sistem membedakan tiga peran staf:

| Peran (Role) | Deskripsi | Batasan Akses |
|---|---|---|
| **Admin** | Administrator sistem / IT sekolah | Akses mutlak ke seluruh menu, seluruh kelas, aksi destruktif, konfigurasi sistem, dan manajemen akun staf. |
| **Teacher** | Guru mata pelajaran / wali kelas | Akses monitoring dan absensi terbatas hanya pada kelas yang ditugaskan (*assigned classes*). Tidak dapat mengubah konfigurasi sistem atau mengelola akun staf. |
| **Observer** | Kepala sekolah / peninjau tamu / auditor | Akses lihat (*read-only*) ke data monitoring dan laporan. Tidak memiliki hak mutasi data, ekspor, atau pemicu enrollment. |

### Matriks Akses Antar Menu

| Menu / Halaman | Admin | Teacher | Observer |
|---|---|---|---|
| `Login` (`/login`) | Akses publik (belum login) | Akses publik (belum login) | Akses publik (belum login) |
| `Overview` (`/overview`) | Semua kelas | Terbatas kelas sendiri | Read-only semua kelas |
| `Attendance` (`/attendance`) | Baca, filter, koreksi manual (`TBD`) | Baca & filter kelas sendiri | Read-only tanpa koreksi |
| `Students` (`/students`) | CRUD penuh + trigger enrollment biometrik | Baca data & ajukan permohonan enrollment | Read-only |
| `Classes & Seats` (`/classes-seats`) | Kelola kelas & denah sensor kursi | Baca denah kelas sendiri | Read-only |
| `Device Monitoring` (`/devices`) | Monitor, uji perintah, rotasi kredensial | Baca status perangkat kelas sendiri | Read-only |
| `Reports` (`/reports`) | Agregasi & ekspor semua kelas | Agregasi & ekspor kelas sendiri | Lihat agregasi, tanpa ekspor |
| `Settings` (`/settings`) | Akses penuh seluruh tab konfigurasi | Ditolak (Hidden / 403 Forbidden) | Ditolak (Hidden / 403 Forbidden) |

---

## 3. Struktur Navigasi & Shell Global

Antarmuka web menggunakan struktur *Application Shell* yang konsisten di seluruh halaman setelah login:

### A. Navigasi Utama (Sidebar / Main Menu)
Menampilkan daftar rute utama dengan indikator halaman aktif:
1. Overview (`/overview`)
2. Attendance (`/attendance`)
3. Students (`/students`)
4. Classes & Seats (`/classes-seats`)
5. Device Monitoring (`/devices`)
6. Reports (`/reports`)
7. Settings (`/settings`) — *Hanya dirender untuk role Admin*.

### B. Header Global
Komponen persisten di bagian atas setiap halaman:
1. **Indikator Konektivitas Pusat**:
   - Status Backend API NestJS (`Connected` / `Degraded` / `Disconnected`).
   - Status Kanal WebSocket (`Live` / `Reconnecting` / `Offline`).
2. **Global Context Filter (Pemilih Kelas & Tanggal)**:
   - Pemilih kelas aktif: menentukan cakupan data yang ditampilkan di halaman saat ini (opsi: "Semua Kelas" untuk Admin, atau daftar kelas terdaftar).
   - Penanda tanggal aktif (default: hari ini).
3. **Pusat Notifikasi Sistem**:
   - Counter peringatan jika ada perangkat offline mendadak atau sesi verifikasi yang gagal/kedaluwarsa.
4. **Profil Sesi Staf & Aksi Keluar**:
   - Menampilkan nama pengguna yang sedang aktif, label role (`Admin` / `Teacher` / `Observer`), dan tombol `Logout`.

---

## 4. Spesifikasi Rinci Setiap Halaman

---

### Halaman 0: Autentikasi Staf (`/login`)

#### 1. Fungsi Halaman
Gerbang pengaman tunggal. Tanpa sesi valid, seluruh rute internal (`/overview`, `/attendance`, dsb.) diblokir dan dialihkan otomatis ke `/login`.

#### 2. Entitas Input & Output
- **Input Pengguna**:
  - `identifier`: Email atau username staf.
  - `password`: Kata sandi akun.
  - Opsi: Penanda sesi panjang ("Ingat Saya" — *opsional/TBD*).
- **Output Sistem**:
  - Sesi terautentikasi (HTTP-only secure cookie atau JWT token sesuai konfigurasi NestJS).
  - Objek identitas staf (`user_id`, `name`, `email`, `role`, `assigned_classes`).
  - Redirect otomatis ke URL tujuan semula (*return URL*) atau default `/overview`.

#### 3. Logika & Aturan Sistem
- Proteksi tebakan akun (*anti-enumeration*): Pesan kegagalan login wajib generik, misalnya *"Identifier atau kata sandi tidak cocok"*.
- Batas percobaan gagal (*rate-limiting*): Kunci sementara form setelah 5 kali kegagalan berturut-turut dalam 15 menit.
- Password tidak boleh dicatat dalam log klien browser.

#### 4. Penanganan Exception & State
- **Kredensial Salah**: Tampilkan pesan error inline di atas tombol login.
- **Akun Dinonaktifkan**: Pesan eksplisit *"Akun Anda telah dinonaktifkan. Hubungi Administrator."*
- **Backend Unreachable**: Indikator koneksi gagal dengan opsi percobaan ulang (*retry*).
- **Session Expired di tengah kerja**: Ketika request API mengembalikan kode `401 Unauthorized`, sistem otomatis mengunci layar, membersihkan state sesi, dan menampilkan prompt login ulang.

---

### Halaman 1: Overview Dashboard (`/overview`)

#### 1. Fungsi Halaman
Pusat kontrol pemantauan operasional real-time harian. Menampilkan performa kehadiran hari ini, status okupansi kursi kelas saat ini, log aktivitas verifikasi langsung, dan ringkasan kondisi perangkat kelas.

#### 2. Entitas Data yang Ditampilkan
1. **Ringkasan Metrik Kehadiran Hari Ini (KPI Counters)**:
   - Total Siswa Terdaftar (pada kelas aktif).
   - Jumlah Siswa Hadir Tepat Waktu (`Present`).
   - Jumlah Siswa Terlambat (`Late`).
   - Jumlah Siswa Belum/Tidak Hadir (`Absent`).
   - Persentase Tingkat Kehadiran Kumulatif: `((Present + Late) / Total) * 100%`.
2. **Ringkasan Telemetri Okupansi Kursi (Sensor Load Cell)**:
   - Total Kursi Terdaftar.
   - Kursi Berstatus Terisi (`Occupied`).
   - Kursi Berstatus Kosong (`Empty`).
   - Kursi Anomali / Sensor Tidak Terbaca (`Unknown`).
   - *Catatan sistem:* Teks penjelas eksplisit bahwa data kursi adalah telemetri sensor murni, bukan absensi resmi.
3. **Log Aktivitas Verifikasi Langsung (Real-time Feed)**:
   - Daftar 10-20 transaksi verifikasi biometrik terakhir.
   - Data kolom: Timestamp, Nama Siswa, Kelas, Hasil Wajah, Hasil Fingerprint, Status Akhir Sesi.
4. **Ringkasan Kesehatan Perangkat Terhubung**:
   - Status online/offline untuk: Edge PC Face Recognition, ESP32 Fingerprint, ESP32 Load Cell.
   - Timestamp pelaporan data terakhir (*last seen*).

#### 3. Sumber Data & Aliran Event
- Pemuatan awal via REST: `GET /api/v1/dashboard/overview-summary?class_id=...&date=...`.
- Pembaruan instan via WebSocket:
  - Event `attendance.created`: Memperbarui counter kehadiran dan menyisipkan baris teratas pada log aktivitas.
  - Event `seat.status_changed`: Memperbarui counter okupansi kursi.
  - Event `device.offline`: Mengubah status indikator perangkat menjadi peringatan offline.

#### 4. Aksi Pengguna
- Mengganti filter kelas aktif.
- Mengganti filter tanggal (default: hari ini).
- Menekan tombol penyegaran data (*manual refresh*).
- Mengklik baris log aktivitas untuk membuka drawer detail audit di Halaman Attendance.

#### 5. Penanganan Exception & State
- **Pemuatan Awal**: Tampilkan indikator loading pada masing-masing blok metrik secara independen.
- **Koneksi WebSocket Terputus**: Indikator peringatan "Mode Data Basi (WebSocket Terputus) — Mencoba menyambung kembali". Data tidak direset, sistem melakukan polling cadangan via REST setiap 30 detik.
- **Nol Data**: Tampilkan *empty state* informatif jika belum ada kegiatan absensi pada tanggal yang dipilih.

---

### Halaman 2: Attendance Management (`/attendance`)

#### 1. Fungsi Halaman
Pusat pencarian, audit, dan peninjauan seluruh catatan absensi siswa. Menyediakan riwayat mendalam tentang bagaimana keputusan absensi diambil melalui verifikasi 2 faktor (wajah + sidik jari) serta alur koreksi administratif.

#### 2. Entitas Data yang Ditampilkan
1. **Tabel Utama Catatan Kehadiran**:
   - Kolom Data: ID Transaksi, Tanggal/Jam Catat, NIS/Student ID, Nama Lengkap Siswa, Kelas, Status Wajah, Status Fingerprint, Status Akhir Kehadiran, Aksi Detail.
2. **Koleksi Nilai Status Kehadiran (6 Status Mutlak)**:
   - `Present`: Terverifikasi 2 faktor tepat waktu sebelum batas toleransi keterlambatan.
   - `Late`: Terverifikasi 2 faktor setelah batas toleransi keterlambatan yang ditentukan.
   - `Pending`: Verifikasi wajah berhasil, sistem sedang menunggu respon sidik jari dari ESP32.
   - `Failed`: Terjadi ketidakcocokan biometrik (misal wajah milik siswa A, sidik jari milik siswa B).
   - `Expired`: Sesi verifikasi melewati batas waktu tunggu (*timeout*, misal 30 detik) tanpa sentuhan jari.
   - `Absent`: Siswa tidak memiliki riwayat absensi hingga jendela waktu sesi kelas ditutup.
3. **Drawer / Modal Detail Audit Transaksi**:
   - ID Sesi Verifikasi (`session_id`).
   - Timeline runut waktu (kronologis):
     - Waktu deteksi wajah oleh edge PC.
     - Kandidat siswa yang diidentifikasi oleh model SFace beserta skor similarity.
     - Waktu pengiriman perintah polling verifikasi ke antrian ESP32.
     - Waktu verifikasi sidik jari di sensor R503 beserta nomor template ID.
     - Keputusan akhir validasi oleh NestJS.
     - Timestamp penulisan catatan permanen ke database PostgreSQL.

#### 3. Aksi Pengguna
- **Filter Multi-Kriteria**:
  - Rentang tanggal (tanggal mulai s/d tanggal selesai).
  - Pilihan kelas.
  - Pilihan status kehadiran (multi-select dari 6 status).
  - Kolom pencarian teks (mencari berdasarkan NIS atau nama siswa).
- **Paginasi Data**: Pengaturan limit per halaman (10, 25, 50, 100 baris) dan navigasi halaman.
- **Ekspor Data**: Tombol ekspor data tabel terfilter ke file CSV.
- **Koreksi Status Manual (Khusus Admin)**: Form dialog perubahan status kehadiran dengan kewajiban mengisi alasan koreksi (*audit trail log*). Fitur bertanda `TBD/Planned`.

#### 4. Penanganan Exception & State
- Hasil pencarian kosong: Tampilkan pesan *empty search state* dengan opsi reset filter.
- Kegagalan pengambilan data: Indikator error dengan tombol coba lagi (*retry query*).
- Transaksi sedang berjalan (`Pending`): Indikator status bergerak dinamis, memperbarui otomatis jika event WebSocket `attendance.updated` diterima.

---

### Halaman 3: Student Management & Biometric Enrollment (`/students`)

#### 1. Fungsi Halaman
Pengelolaan direktori induk siswa serta orkestrasi pendaftaran (*enrollment*) data biometrik siswa (wajah dan sidik jari).

#### 2. Entitas Data yang Ditampilkan
1. **Tabel Direktori Siswa**:
   - NIS / Student ID (kunci unik).
   - Nama Lengkap Siswa.
   - Kelas Terdaftar.
   - Status Enrollment Wajah (`Enrolled` / `Not Enrolled`).
   - Status Enrollment Fingerprint (`Enrolled` / `Not Enrolled`).
   - Status Akun Siswa (`Active` / `Inactive`).
   - Aksi: Edit Data, Hapus/Nonaktifkan Siswa, Menu Enrollment Biometrik.
2. **Formulir Data Induk Siswa**:
   - Field: NIS, Nama Lengkap, Kelas, Jenis Kelamin, Kontak/Email Wali Murid.

#### 3. Logika Alur Kerja Enrollment Biometrik (Wajib Dipisah)

Enrollment Wajah dan Sidik Jari **tidak boleh disatukan dalam satu form**, karena jalur teknologinya berbeda:

```
[Workflow 1: Enrollment Wajah]
Operator unggah foto / tangkap webcam kelas
               ↓
POST /api/v1/face/enroll (FastAPI)
               ↓
Validasi: Deteksi wajah YuNet (harus tepat 1 wajah, pencahayaan cukup)
               ↓
Ekstraksi vektor embedding via SFace (128-d float)
               ↓
Simpan embedding di penyimpanan lokal Edge PC
               ↓
Callback status berhasil ke NestJS & Dashboard
```

```
[Workflow 2: Enrollment Sidik Jari]
Operator memilih siswa & menekan "Daftarkan Sidik Jari"
               ↓
NestJS membuat perintah: { command: "ENROLL", student_id: X, slot: N }
               ↓
ESP32 mengambil perintah saat polling berikutnya
               ↓
Sensor R503 menyala, meminta jari ditempel 2 kali untuk pembuatan template
               ↓
R503 menyimpan template di flash sensor internal
               ↓
ESP32 mengirim laporan sukses ke NestJS beserta Slot ID
               ↓
NestJS mencatat pemetaan student_id -> fingerprint_slot_id
               ↓
WebSocket mengirim event sukses ke Dashboard web
```

#### 4. Aksi Pengguna
- Tambah data siswa baru secara manual.
- Unggah berkas CSV untuk import data massal (*bulk import*).
- Buka modal **Enrollment Wajah**: Unggah gambar resolusi tinggi atau pemicu capture dari webcam kelas.
- Buka modal **Enrollment Sidik Jari**: Pilih perangkat ESP32 tujuan, kirim perintah, dan pantau status countdown penempelan jari (maksimal 30 detik).
- Reset/Hapus data biometrik siswa (khusus Admin, membutuhkan konfirmasi keamanan ganda).

#### 5. Penanganan Exception & State
- **Enrollment Wajah Gagal**: Tampilkan alasan kegagalan spesifik (misal: "Wajah tidak terdeteksi", "Ditemukan lebih dari 1 wajah", "Resolusi terlalu rendah").
- **Enrollment Sidik Jari Timeout**: Tampilkan indikator waktu habis jika siswa tidak menempelkan jari dalam batas waktu sensor, dengan tombol kirim ulang perintah.
- **Duplikasi NIS**: Peringatan validasi form instan jika NIS yang dimasukkan telah terdaftar.

---

### Halaman 4: Classes & Seats (`/classes-seats`)

#### 1. Fungsi Halaman
Manajemen data ruang kelas dan visualisasi tata letak sensor beban kursi (load cell + HX711) untuk memantau status okupansi fisik ruangan.

#### 2. Entitas Data yang Ditampilkan
1. **Daftar Kelas**: ID Kelas, Nama Kelas, Lokasi Ruangan, Kapasitas Kursi, Total Kursi Terpasang Sensor.
2. **Visual Denah Tata Letak Kursi (Seat Map)**:
   - Representasi grid atau matriks tata letak meja/kursi di kelas yang dipilih.
   - Status individual setiap kursi:
     - `Empty`: Beban di bawah batas minimum (misal < 5 kg).
     - `Occupied`: Beban stabil terdeteksi di atas batas duduk siswa (misal >= 15 kg).
     - `Unknown`: Sensor mengalami anomali pembacaan data atau kabel sensor terputus.
   - Penanda Data Basi (*Stale Warning*): Jika ESP32 pengirim kursi tersebut tidak melapor dalam 2 menit terakhir.
3. **Panel Detail Sensor Kursi (Saat Kursi Diklik)**:
   - ID Kursi (`seat_id`).
   - Kode Modul ESP32 Pengendali (`device_id`).
   - Nilai pembacaan beban saat ini (dalam satuan kg).
   - Timestamp pembaruan data sensor terakhir.
   - Riwayat log perubahan status kursi hari ini (tabel event: status sebelumnya -> status baru -> jam).
   - **PENTING:** Panel ini **TIDAK** menampilkan nama/foto siswa, menegaskan bahwa kursi tidak diikat ke identitas siswa.

#### 3. Aksi Pengguna
- Memilih ruang kelas yang ingin dipantau.
- Mengklik modul kursi pada peta untuk memeriksa pembacaan beban dan log kestabilan sensor.
- Tambah / Edit konfigurasi denah kelas (khusus Admin): Mengatur nomor baris, kolom, dan mengasosiasikan ID load cell ke nomor kursi fisik.

#### 4. Penanganan Exception & State
- Sensor membaca nilai negatif atau fluktuasi ekstrem: Tampilkan status `Unknown` dengan label bantuan *"Sensor membutuhkan kalibrasi tare"*.
- Hilang sinyal ESP32: Kursi yang dikendalikan oleh modul bersangkutan ditandai visual sebagai *offline/stale*.

---

### Halaman 5: Device Monitoring (`/devices`)

#### 1. Fungsi Halaman
Pusat inventarisasi, pemantauan kesehatan konektivitas, dan diagnosis teknis untuk seluruh perangkat keras fisik IoT dan komputer edge yang terdaftar di sistem.

#### 2. Entitas Data yang Ditampilkan
1. **Daftar Perangkat Fisik Terdaftar**:
   - Nama Perangkat (misal: `PC-Kelas-X-RPL`, `ESP32-FP-Pintu-1`, `ESP32-Seat-Baris-A`).
   - Tipe Perangkat:
     - `Face Recognition PC` (Komputer lokal FastAPI).
     - `Fingerprint Scanner` (ESP32 + R503).
     - `Seat Occupancy Hub` (ESP32 + HX711).
   - ID Perangkat Fisik / MAC Address.
   - Lokasi Penempatan (Ruang Kelas).
   - Status Konektivitas: `Online` (Heartbeat aktif) atau `Offline` (Melewati ambang batas tidak melapor).
   - Waktu Terakhir Terlihat (*Last Seen Timestamp*).
   - Versi Firmware / Versi Layanan.
2. **Inspeksi Antrian Perintah (Command Queue Tracker)**:
   - Tabel antrian perintah yang dikirim backend ke ESP32:
     - `command_id`: Identitas unik transaksi perintah.
     - Target `device_id`.
     - Tipe Aksi: `VERIFY` atau `ENROLL`.
     - Waktu Dibuat vs Waktu Diambil (*Polled*).
     - Status Perintah: `QUEUED`, `PROCESSING`, `COMPLETED`, `EXPIRED`.
3. **Log Kejadian Kesalahan Perangkat (Device Error Log)**:
   - Catatan anomali: kegagalan sensor R503 membaca template, kegagalan koneksi socket, atau lonjakan pembacaan HX711.

#### 3. Aksi Pengguna
- **Uji Perintah (Ping / Test Command)**: Mengirim sinyal tes ke perangkat untuk mengukur latensi respon (*Admin only*).
- **Rotasi Token Kredensial Perangkat**: Menghasilkan ulang API key atau secret token untuk perangkat tertentu (*Admin only*).
- **Restart / Hapus Antrian Tertahan**: Menghapus paksa antrian perintah yang kedaluwarsa atau macet (*Admin only*).
- **Registrasi Perangkat Baru**: Form pendaftaran MAC address, nama, tipe perangkat, dan kelas tempat perangkat dipasang.

#### 4. Penanganan Exception & State
- Perangkat `Offline`: Tampilkan durasi keterputusan (misal: "Offline sejak 42 menit yang lalu").
- Antrian Perintah Menumpuk: Peringatan jika terdapat lebih dari 5 perintah berstatus `QUEUED` tanpa diambil oleh ESP32 (mengindikasikan ESP32 terputus dari jaringan Wi-Fi lokal).

---

### Halaman 6: Reports & Analytics (`/reports`)

#### 1. Fungsi Halaman
Agregasi data historis absensi dan okupansi kelas untuk keperluan audit bulanan, evaluasi kehadiran siswa, dan pembuatan laporan formal tanpa pemodelan analitik fiktif.

#### 2. Entitas Data yang Ditampilkan
1. **Filter Ruang Lingkup Laporan**:
   - Pemilih Rentang Waktu (Minggu Ini, Bulan Ini, Semester Berjalan, atau Custom Date Range).
   - Pemilih Kelas (Semua Kelas atau Satu Kelas Spesifik).
2. **Ringkasan Angka Kumulatif Periode**:
   - Rata-rata Persentase Kehadiran Kelas.
   - Total Siswa Tepat Waktu (`Present`).
   - Total Siswa Terlambat (`Late`) — *Wajib dihitung terpisah dari Present agar tidak menyamarkan kedisiplinan*.
   - Total Siswa Tanpa Keterangan (`Absent`).
3. **Tabel Distribusi Kehadiran Harian**:
   - Baris per tanggal: Tanggal, Kelas, Jumlah Siswa Hadir, Jumlah Terlambat, Jumlah Absen, Rasio Keterisian Kursi Rata-rata.
4. **Rekapitulasi Kehadiran per Siswa**:
   - NIS, Nama Siswa, Total Hadir, Total Terlambat, Total Absen, Persentase Kehadiran Individu.
5. **Log Keandalan Konektivitas Perangkat (Uptime Summary)**:
   - Persentase uptime perangkat per kelas selama periode laporan untuk validasi apakah ada absensi yang terlewat akibat sistem down.

#### 3. Aksi Pengguna
- Ekspor Laporan Lengkap: Mengunduh data rekapitulasi ke berkas CSV atau Spreadsheet.
- Unduh Ringkasan Cetak (PDF — *Fitur Planned/TBD*).

#### 4. Penanganan Exception & State
- Periode tanpa catatan: Tampilkan *empty state* dengan instruksi pemilihan rentang tanggal lain.
- Rentang waktu terlalu panjang (> 1 tahun): Peringatan untuk mempersempit rentang demi menjaga performa ekspor data database.

---

### Halaman 7: System Settings (`/settings`) — *Khusus Admin*

#### 1. Fungsi Halaman
Pusat konfigurasi tata kelola parameter bisnis absensi, pengaturan ambang batas toleransi perangkat keras, dan manajemen akses akun staf.

#### 2. Sub-Menu / Struktur Tab Konfigurasi

##### Tab 1: Konfigurasi Umum (General)
- Nama Institusi / Sekolah.
- Zona Waktu Sistem (wajib sinkron antara server dan perangkat edge, misal: `Asia/Jakarta`).
- Tahun Ajaran & Semester Aktif.

##### Tab 2: Aturan Absensi (Attendance Rules)
- **Jendela Jam Absensi (Attendance Window)**: Jam buka dan jam tutup absensi pagi (misal: 06:30 - 07:30).
- **Batas Toleransi Keterlambatan (Late Threshold)**: Waktu tepat di mana kehadiran berubah dari status `Present` menjadi `Late` (misal: pukul 07:00).
- **Batas Waktu Tunggu Sesi Verifikasi (Verification Timeout)**: Durasi maksimal jeda antara deteksi wajah hingga sidik jari harus ditempelkan (default: 30 detik). Jika terlampaui, sesi otomatis ditandai `Expired`.
- **Kebijakan Absensi Berulang (Duplicate Policy)**: Aturan sistem jika siswa memverifikasi diri dua kali dalam hari yang sama (opsi: "Abaikan verifikasi berikutnya" atau "Perbarui catatan waktu").

##### Tab 3: Pengaturan Perangkat & Sensor (Device & Sensor Config)
- **Polling Interval ESP32 Fingerprint**: Interval waktu ESP32 menanyakan antrian ke NestJS (default: 2 detik).
- **Threshold Offline Perangkat**: Batas waktu hening sebelum perangkat dinyatakan offline oleh sistem (default: 60 detik).
- **Ambang Batas Beban Kursi (Load Cell Thresholds)**:
  - Bobot minimum terisi (`Occupied Threshold`): misal 15 kg.
  - Waktu histeresis stabilisasi: durasi beban harus bertahan konstan sebelum status kursi berpindah dari kosong ke terisi (misal: 3 detik).

##### Tab 4: Manajemen Pengguna Staf (User Management)
- Tabel Akun Staf: Nama, Username/Email, Role (`Admin`, `Teacher`, `Observer`), Status Akun, Daftar Kelas Binaan (untuk Teacher).
- Aksi: Tambah Staf Baru, Edit Role, Reset Kata Sandi, Nonaktifkan Akun.
- Ketetapan: Sistem melarang Admin menonaktifkan akun miliknya sendiri untuk mencegah penguncian sistem (*lockout protection*).

##### Tab 5: Keamanan & Kredensial API (Security)
- Manajemen Sesi Aktif: Daftar sesi browser staf yang sedang login dengan opsi putus paksa (*Revoke Session*).
- Regenerasi Master API Key untuk komunikasi antar-layanan (NestJS <-> FastAPI Face PC).

#### 3. Logika & Proteksi Aksi Destruktif
- Seluruh perubahan konfigurasi krusial (reset data, penghapusan akun, rotasi API key) wajib melalui **Dialog Konfirmasi Modal eksplisit**.
- Pengaturan yang belum diimplementasikan di backend wajib diberi label visual **`Planned / TBD`** dan dalam keadaan field nonaktif (*disabled*).

---

## 5. Aliran Verifikasi Absensi 2 Faktor & State Machine

Sistem web memantau status absensi yang bergerak melalui mesin status (*state machine*) berikut:

```
[1. Siaga] 
     ↓
[2. Wajah Terdeteksi] (FastAPI membaca wajah via YuNet)
     ↓
[3. Pencocokan Wajah] (SFace menghasilkan kemiripan >= threshold)
     ↓
     ├── Tidak Cocok / Tidak Dikenali → [Status: Failed / Unknown]
     ↓
[4. Sesi Dibuat di NestJS] → Dashboard menampilkan status: "Pending"
     ↓
[5. Perintah Polling Diambil ESP32] → Sensor R503 menyala berkedip
     ↓
     ├── Siswa tidak menempelkan jari hingga 30 detik → [Status: Expired]
     ├── Sidik jari milik siswa lain / tidak cocok   → [Status: Failed]
     ↓
[6. Sidik Jari Cocok] (Template R503 cocok dengan siswa yang sama)
     ↓
     ├── Waktu verifikasi <= Batas Keterlambatan   → [Status: Present]
     └── Waktu verifikasi > Batas Keterlambatan    → [Status: Late]
     ↓
[7. Catatan Permanen Tersimpan di PostgreSQL]
     ↓
[8. Event WebSocket "attendance.created" Disiarkan ke Web Dashboard]
```

---

## 6. Protokol Integrasi & Event WebSocket

Dashboard web mendengarkan event WebSocket pada namespace `/ws/attendance`:

### 1. Event: `attendance.created`
Dipancarkan saat verifikasi 2 faktor sukses atau gagal secara permanen.
```json
{
  "event": "attendance.created",
  "data": {
    "attendance_id": "uuid-v4",
    "session_id": "sess-9921",
    "student_id": "STD-2024-001",
    "student_name": "Ahmad Rizky",
    "class_id": "CLS-10-RPL-1",
    "status": "Present",
    "verification_time": "2026-10-17T07:12:45.120Z",
    "face_confidence": 0.94,
    "fingerprint_slot": 12
  }
}
```

### 2. Event: `attendance.updated`
Dipancarkan untuk memperbarui progres sesi verifikasi yang sedang berlangsung.
```json
{
  "event": "attendance.updated",
  "data": {
    "session_id": "sess-9921",
    "student_id": "STD-2024-001",
    "step": "WAITING_FINGERPRINT",
    "timeout_seconds_remaining": 22
  }
}
```

### 3. Event: `seat.status_changed`
Dipancarkan saat status okupansi sensor beban berubah secara stabil.
```json
{
  "event": "seat.status_changed",
  "data": {
    "seat_id": "SEAT-10-RPL-1-B03",
    "class_id": "CLS-10-RPL-1",
    "device_id": "ESP32-SEAT-01",
    "status": "Occupied",
    "weight_kg": 54.2,
    "timestamp": "2026-10-17T07:13:01.000Z"
  }
}
```

### 4. Event: `device.offline`
Dipancarkan saat backend mendeteksi perangkat gagal mengirim heartbeat melewati batas threshold.
```json
{
  "event": "device.offline",
  "data": {
    "device_id": "ESP32-FP-01",
    "device_name": "ESP32-Fingerprint-Kelas-10",
    "last_seen": "2026-10-17T07:05:00.000Z",
    "reason": "HEARTBEAT_TIMEOUT"
  }
}
```

---

## 7. Ketahanan Sistem, Pemulihan Koneksi, dan Status UI

Antarmuka web wajib memiliki penanganan konsisten untuk 4 kondisi data dasar di setiap komponen:

1. **State Memuat (Loading State)**:
   - Tampilkan placeholder struktural saat menunggu respon REST awal.
   - Pemuatan antar-komponen wajib bersifat asinkron independen (kegagalan memuat widget perangkat tidak boleh menggagalkan render tabel kehadiran).
2. **State Kosong (Empty State)**:
   - Jika tabel atau filter tidak mengembalikan baris data, sediakan deskripsi yang jelas tentang alasan kekosongan data dan aksi untuk mereset kriteria filter.
3. **State Error (Error State)**:
   - Tangkap seluruh respon HTTP `4xx` dan `5xx`.
   - Sediakan tombol coba lagi (*Retry*) tanpa memaksa pengguna menyegarkan (*hard reload*) seluruh halaman browser.
4. **State Koneksi Terdegradasi (Stale / Reconnecting State)**:
   - Ketika koneksi WebSocket terputus, antarmuka tetap menampilkan data terakhir yang berhasil diterima dengan memberi label peringatan bahwa data belum diperbarui secara real-time.
   - Klien browser wajib menjalankan algoritma *Exponential Backoff Reconnection*.
   - Saat koneksi WebSocket berhasil tersambung kembali (*reconnected*), sistem otomatis memicu query REST latar belakang untuk mengambil perubahan data yang terlewat selama masa terputus.
