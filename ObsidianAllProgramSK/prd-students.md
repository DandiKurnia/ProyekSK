# PRD Menu 3 — Students

## 1. Fungsi Menu

Manajemen data induk siswa dan orkestrasi enrollment biometrik dua faktor. Menu ini memiliki dua workflow enrollment teknis yang berbeda sesuai arsitektur: enrollment wajah (via layanan FastAPI lokal) dan enrollment fingerprint (via perintah polling ESP32 + sensor R503).

## 2. Entitas Data yang Ditampilkan

1. **Data Siswa (Students)**:
   - Student ID (unik), nama lengkap, kelas, email (opsional), status akun (`Active` / `Inactive`).

2. **Status Enrollment Biometrik**:
   - Face Enrollment: `Enrolled` / `Not Enrolled` / `Pending`.
   - Fingerprint Enrollment: `Enrolled` / `Not Enrolled` / `Pending`.
   - Status agregat enrollment: `Complete` / `Face Required` / `Fingerprint Required` / `Incomplete`.

3. **Workflow Enrollment Wajah** (sesuai `docs/face-recognition.md`):
   - Step 1: Capture/upload foto (1+ sampel) dari operator.
   - Step 2: Layanan lokal deteksi wajah (YuNet).
   - Step 3: Quality check (ukuran, kejelasan, jumlah wajah dalam frame).
   - Step 4: Ekstraksi embedding (SFace) dan pemetaan ke `student_id`.
   - Step 5: Tersimpan & status `Enrolled`.
   - Tiap step memiliki status (`pending`, `running`, `success`, `failed`) dan pesan kegagalan bila ada.

4. **Workflow Enrollment Fingerprint** (sesuai `docs/fingerprint.md`):
   - Step 1: Backend membuat perintah enrollment (diambil ESP32 via polling).
   - Step 2: ESP32 meminta siswa menempelkan jari di R503 (1–2x).
   - Step 3: Sensor membentuk template & mengembalikan `template_id`.
   - Step 4: Backend menyimpan relasi `student_id ↔ template_id`.
   - Status perintah live: `sent` → `picked_up` → `waiting_finger` → `matched/template_created` → `mapped`, atau `timeout` / `error`.
   - Countdown timeout sesi enrollment.

5. **Riwayat Kehadiran per Siswa**:
   - Daftar record absensi historis: tanggal, check-in, status final (`Present`/`Late`/`Absent`/`Failed`).

## 3. Sumber Data & Aliran Event

- CRUD siswa via REST API.
- Trigger enrollment wajah: upload data → layanan FastAPI lokal → callback status.
- Trigger enrollment fingerprint: backend membuat perintah; status diambil via polling REST atau event WebSocket.
- Riwayat kehadiran diambil via REST endpoint paginasi.

## 4. Aturan Logika Sistem

1. Student ID wajib unik; duplikasi ditolak backend.
2. Siswa baru otomatis berstatus enrollment `Incomplete`.
3. Re-enrollment menimpa data lama; penghapusan data biometrik memerlukan konfirmasi eksplisit (perubahan bersifat destruktif).
4. Enrollment hanya dapat dimulai oleh Admin atau Teacher dengan konfirmasi; Observer read-only.
5. Backend tidak pernah mengembalikan citra wajah atau template fingerprint ke antarmuka.

## 5. Aksi Pengguna

- Tambah siswa baru (form: Student ID, nama, kelas, email opsional, status).
- Import CSV (validasi struktur kolom sebelum commit).
- Edit / nonaktifkan siswa (konfirmasi).
- Memulai, mengulang, atau menghapus enrollment biometrik.
- Melihat detail siswa (profil, enrollment, riwayat kehadiran).

## 6. Keadaan Sistem yang Ditangani

- Pemuatan daftar siswa paginasi (loading).
- Tidak ada siswa / filter tanpa hasil (empty state).
- Kegagalan CRUD (error + retry).
- Enrollment wajah gagal quality check (pesan penyebab + opsi ulang).
- Enrollment fingerprint timeout (countdown habis + kirim ulang perintah).
- Validasi form: ID duplikat, field wajib kosong.
