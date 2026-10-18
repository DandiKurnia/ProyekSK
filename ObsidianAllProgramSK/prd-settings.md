# PRD Menu 7 — Settings

## 1. Fungsi Menu

Konfigurasi aturan sistem, ambang batas, kredensial perangkat, dan manajemen pengguna. Hanya diakses role Admin; menu ini tidak tampil bagi Teacher/Observer. Setiap setting yang belum didukung backend ditandai `TBD` dan tampil disabled dengan label "Planned — not yet implemented".

## 2. Entitas Data & Sub-Menu (Tab)

### 2.1 General
- Nama institusi/sekolah.
- Zona waktu sistem (referensi konsistensi timestamp).
- Kelas default (kelas aktif awal saat login).

### 2.2 Classrooms
- Daftar kelas: nama, tingkat, tahun ajaran.
- Tambah / edit / nonaktifkan kelas (konfirmasi).
- Assign perangkat ke kelas (dropdown perangkat terdaftar).

### 2.3 Attendance Rules
| Setting | Status Arsitektur |
|---|---|
| Jendela waktu absensi sah (mis. H-15 s/d H+30 mnt) | `TBD` — `docs/backend.md` |
| Ambang batas keterlambatan → status `Late` | `TBD` |
| Kebijakan absensi duplikat (per siswa/kelas/hari) | Didukung unique constraint — `docs/database.md` |
| Verification timeout (menunggu fingerprint) | `TBD` — `docs/backend.md` |
| Penanganan sesi pending (auto-expire / review manual) | `TBD` |

### 2.4 Device Configuration
- Assignment perangkat ↔ kelas.
- Polling interval ESP32 (`TBD`, contoh default 5 detik).
- Ambang batas status perangkat (kapan dinyatakan offline/warning) — `TBD`.
- Rotasi kredensial perangkat: secret baru ditampilkan **sekali saja** + konfirmasi.

### 2.5 User Management
- Daftar pengguna: nama, email, role (`Admin` / `Teacher` / `Observer`), status, kelas terkait (untuk Teacher).
- Tambah/edit user, ubah role, nonaktifkan (konfirmasi).
- Matriks permission sebagai referensi (konsisten dengan `prd-index.md`):

| Kemampuan | Admin | Teacher | Observer |
|---|---|---|---|
| Lihat semua halaman | Ya | Kelas sendiri | Ya (read) |
| Kelola students | Ya | Minta enrollment | Tidak |
| Koreksi attendance manual | Ya (`TBD`) | Tidak | Tidak |
| Kelola devices | Ya | Tidak | Tidak |
| Kelola settings & users | Ya | Tidak | Tidak |
| Ekspor laporan | Ya | Kelas sendiri | Tidak |

### 2.6 Security
- Daftar sesi admin aktif + revoke.
- Manajemen kredensial perangkat: daftar (nama, last used) tanpa menampilkan secret tersimpan; rotate/revoke dengan konfirmasi.
- Ringkasan RBAC.

## 3. Sumber Data & Aliran Event

- Read/write konfigurasi via REST API (endpoint konfigurasi `TBD` di backend).
- Tidak berlangganan WebSocket; halaman bersifat konfiguratif.

## 4. Aturan Logika Sistem

1. Hanya Admin dapat membuka menu ini; role lain tidak melihat item navigasi Settings.
2. Setting bertanda `TBD` tampil disabled + label "Planned — not yet implemented" (tidak seolah berfungsi).
3. Semua aksi sensitif (rotate kredensial, revoke sesi, nonaktifkan user/kelas) memerlukan dialog konfirmasi.
4. Secret/password/token tidak pernah ditampilkan setelah dibuat; hanya sekali saat pertama kali dibuat.
5. Perubahan aturan absensi memengaruhi perilaku backend sejak saat itu; perubahan tidak berlaku retroaktif pada record yang sudah tersimpan.

## 5. Aksi Pengguna

- Mengubah konfigurasi General / Classrooms / Attendance Rules / Device Configuration.
- Menambah, mengedit, menonaktifkan user; mengubah role.
- Rotasi kredensial perangkat; revoke sesi admin.

## 6. Keadaan Sistem yang Ditangani

- Pemuatan konfigurasi (loading state).
- Kegagalan simpan (error + retry, nilai tidak berubah).
- Validasi input (field wajib, format, ambang batas logis).
- Setting belum didukung backend (disabled + label).
- Aksi destruktif (dialog konfirmasi sebelum eksekusi).
