# PRD Menu 1 — Overview

## 1. Fungsi Menu

Pusat pemantauan real-time yang menggabungkan ringkasan kehadiran harian, status okupansi sensor kursi, log aktivitas verifikasi terbaru, dan kesehatan perangkat yang dilaporkan ke backend.

Filter konteks global: tanggal aktif (default: tanggal berjalan) dan kelas aktif (default: kelas pertama yang ditetapkan). Perubahan filter memicu query ulang ke backend dan me-reset state tampilan.

## 2. Entitas Data yang Ditampilkan

1. **Ringkasan Kehadiran (KPI Kehadiran)**:
   - Total siswa terdaftar pada kelas aktif.
   - Jumlah kehadiran terverifikasi hari ini (agregat status `Present` + `Late`).
   - Jumlah absen (siswa tanpa catatan verifikasi pada tanggal aktif).
   - Status kehadiran per siswa untuk hari berjalan.

2. **Ringkasan Okupansi Sensor**:
   - Total kursi terpantau pada kelas aktif.
   - Jumlah kursi berstatus `occupied` vs `empty` (berdasarkan pembacaan load cell terakhir).
   - Status kegagalan sensor (`unknown` / error perangkat).

3. **Log Aktivitas Verifikasi Terbaru**:
   - Daftar kejadian verifikasi terbaru (waktu check-in).
   - Hasil deteksi wajah (kandidat `student_id` + confidence score).
   - Hasil verifikasi fingerprint (`matched` / `no_match` / `timeout`).
   - Status akhir sesi (`Verified`, `Late`, `Pending Fingerprint`, `Verification Failed`, `Expired`).

4. **Status Perangkat Terdaftar**:
   - Komputer face recognition lokal (status online + heartbeat terakhir).
   - ESP32 fingerprint (status koneksi + aktivitas perintah terakhir).
   - ESP32 monitoring kursi (status koneksi + pembaruan data terakhir).

## 3. Sumber Data & Aliran Event

- Data awal dimuat via query REST API ke backend NestJS.
- Pembaruan asinkron diterima via event WebSocket `attendance.created`, `seat.status_changed`, dan `device.offline`.
- Backend tidak mengembalikan citra wajah mentah atau template fingerprint ke antarmuka; hanya kandidat identitas dan hasil kecocokan.

## 4. Aturan Logika Sistem

1. Status kehadiran `Late` dihitung terpisah tetapi diagregasikan ke total kehadiran harian (rujukan ambang batas di Menu Settings).
2. Status `Present`/`Late` tidak pernah ditampilkan sebelum backend mengonfirmasi penyimpanan record ke PostgreSQL.
3. Data okupansi kursi dan data kehadiran siswa diperlakukan sebagai dua entitas independen; status kursi `occupied` tidak mengubah status kehadiran.
4. Data perangkat yang tidak mengirim heartbeat melewati ambang batas dinyatakan stale/offline.

## 5. Aksi Pengguna

- Mengubah filter tanggal dan kelas aktif.
- Melakukan sinkronisasi ulang data (refresh query REST).
- Navigasi ke detail record absensi pada Menu Attendance.
- Membuka inspeksi perangkat pada Menu Device Monitoring.
- Pencarian cepat pada log aktivitas berdasarkan nama atau student ID.

## 6. Keadaan Sistem yang Ditangani

- Pemuatan awal data (loading state per blok entitas).
- Kegagalan query REST (error + retry).
- Koneksi WebSocket terputus (mode data basi + auto-reconnect).
- Tidak ada catatan kehadiran pada tanggal aktif (empty state).
- Perangkat offline (indikator peringatan + timestamp terakhir terlihat).
