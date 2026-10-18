# PRD Menu 0 — Autentikasi (Login & Sesi)

## 1. Fungsi Menu

Gerbang masuk tunggal sebelum navigasi utama dapat diakses. Sistem memverifikasi identitas pengguna staf (Admin / Teacher / Observer), menerbitkan sesi terautentikasi, dan menegakkan guard pada seluruh 7 menu. Tanpa sesi valid, seluruh route internal tidak dapat diakses.

Scope dokumen ini hanya autentikasi staf admin dashboard. Akun siswa (student-facing / portal siswa) eksplisit **out-of-scope** dan tidak dibahas di PRD mana pun.

## 2. Entitas Data yang Ditangani

1. **Kredensial Login**:
   - Identifier: email atau username (salah satu, konsisten di backend — pilihan final `TBD`).
   - Password (tidak pernah disimpan di klien; hanya dikirim via HTTPS saat login).
2. **Sesi Terautentikasi**:
   - Token sesi (mekanisme `TBD`: session cookie httpOnly atau JWT — diputuskan backend NestJS).
   - Identitas pengguna: user ID, nama, role (`Admin` / `Teacher` / `Observer`), daftar kelas terkait (untuk Teacher).
   - Masa berlaku sesi + timestamp login terakhir.
3. **Manajemen Sesi Aktif** (rujuk Menu Settings → tab Security):
   - Daftar sesi aktif per pengguna + aksi revoke.

## 3. Sumber Data & Aliran Sistem

- Login: `POST` kredensial via HTTPS ke backend NestJS → backend memvalidasi hash password di PostgreSQL → menerbitkan sesi/token.
- Validasi sesi: setiap request REST menyertakan kredensial sesi; backend menolak (`401`) bila sesi invalid/kedaluwarsa.
- Logout: klien memanggil endpoint logout backend (invalidasi sisi server) lalu menghapus state sesi lokal.
- Guard route: sebelum render menu mana pun, klien memeriksa sesi valid; bila tidak valid → redirect ke `/login` dengan parameter return URL.

## 4. Aturan Logika Sistem

1. Seluruh 7 menu wajib di belakang guard autentikasi — tidak ada halaman internal yang dapat diakses anonim.
2. Role ditentukan backend saat login dan tidak dapat diubah dari klien; matriks akses mengikuti `prd-index.md`.
3. Kredensial salah → pesan generik ("Email/username atau password salah") tanpa membocorkan mana yang salah; tidak ada enumerasi akun.
4. Brute-force: rate limiting + lockout sementara setelah N percobaan gagal (`TBD` — mis. 5x dalam 15 menit).
5. Sesi kedaluwarsa saat idle melewati batas (`TBD`) → redirect ke login dengan pesan "Sesi berakhir, silakan login kembali"; state filter konteks tidak wajib dipertahankan.
6. Password tidak pernah ditampilkan, di-cache, atau di-log di sisi klien.

## 5. Aksi Pengguna

- Login (identifier + password + submit).
- Logout (via menu profil di header global).
- Opsional tahap awal: "ingat saya" / tampil-sembunyi password (`TBD`).
- Lupa password / reset via email: `TBD` — ditandai "Planned", bukan bagian rilis awal kecuali backend menyediakannya.

## 6. Keadaan Sistem yang Ditangani

- Pemuatan awal: cek sesi tersimpan → langsung masuk bila valid, ke login bila tidak.
- Kredensial salah (error inline, tanpa lockout permanen).
- Akun dinonaktifkan (pesan "Akun dinonaktifkan, hubungi administrator").
- Backend tidak terjangkau (error koneksi + retry).
- Sesi kedaluwarsa di tengah penggunaan (redirect login + pesan).
- Akses langsung via URL tanpa sesi (redirect login + return URL).
