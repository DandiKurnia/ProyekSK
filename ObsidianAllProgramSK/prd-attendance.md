# PRD Menu 2 — Attendance

## 1. Fungsi Menu

Pusat manajemen catatan absensi yang menyimpan seluruh history verifikasi biometrik dua faktor (wajah + sidik jari). Menu ini menggabungkan tampilan tabular untuk audit, filter multi-dimensi, dan inspeksi timeline verifikasi per sesi.

## 2. Entitas Data yang Ditampilkan

1. **Catatan Absensi (Attendance Records)**:
   - Student ID, nama siswa, kelas.
   - Tanggal & waktu check-in.
   - Hasil deteksi wajah (kandidat + confidence score).
   - Hasil verifikasi fingerprint (`matched` / `no_match` / `timeout`).
   - Status final absensi.

2. **Status Absensi**:
   - `Present` — kedua verifikasi cocok, tersimpan di PostgreSQL, dalam jendela waktu sah.
   - `Late` — terverifikasi tetapi di luar ambang batas keterlambatan (rujuk Menu Settings).
   - `Absent` — tidak ada catatan kehadiran pada tanggal & kelas aktif.
   - `Pending` — kandidat wajah diterima, menunggu verifikasi fingerprint.
   - `Failed` — wajah & fingerprint mengenali siswa berbeda atau fingerprint gagal.
   - `Expired` — sesi verifikasi melewati batas waktu sebelum fingerprint selesai.

3. **Timeline Verifikasi per Sesi** (detail inspeksi):
   - Step 1: Face Detected (layanan lokal FastAPI).
   - Step 2: Candidate Identified (student ID + confidence).
   - Step 3: Fingerprint Requested (perintah dikirim ke ESP32).
   - Step 4: Fingerprint Verified (`matched` via R503).
   - Step 5: Saving Attendance (backend menyimpan ke PostgreSQL).
   - Step 6: Status Final (`Present` / `Late` / `Failed` / `Expired`).
   - Tiap step memiliki timestamp, `session_id`, dan `command_id` terkait.

4. **Summary Counters**:
   - Total present, late, absent, pending, failed, expired dalam rentang filter.

## 3. Sumber Data & Aliran Event

- Query REST API paginasi untuk data historis dengan filter kombinasi: rentang tanggal, kelas, status, pencarian nama/student ID, urutan kolom.
- Event WebSocket `attendance.created` menambahkan baris baru; `attendance.updated` memperbarui status pada sesi berjalan.
- Detail timeline verifikasi diambil via REST endpoint sesi per `session_id`.

## 4. Aturan Logika Sistem

1. Status `Present`/`Late` hanya ditampilkan setelah konfirmasi backend bahwa record tersimpan.
2. Backend tidak mengembalikan citra wajah atau template fingerprint; hanya confidence score numerik dan hasil kecocokan.
3. Aksi koreksi manual hanya tersedia untuk role Admin (flag `TBD` di arsitektur backend).
4. Filter tanggal, kelas, dan status bekerja sebagai kombinasi AND; perubahan filter reset pagination.

## 5. Aksi Pengguna

- Menerapkan filter (rentang tanggal, kelas, status).
- Mencari berdasarkan nama atau student ID.
- Mengurutkan kolom, bernavigasi paginasi.
- Membuka detail timeline verifikasi per sesi.
- Ekspor hasil filter ke CSV (sesuai role).
- Koreksi manual record (Admin, `TBD`).

## 6. Keadaan Sistem yang Ditangani

- Pemuatan data historis (loading state).
- Filter tanpa hasil (empty state).
- Kegagalan query REST (error + retry).
- Sesi verifikasi yang masih berjalan (status `Pending` dengan indikator proses aktif).
- Ekspor volume besar (progress indicator `TBD`).
