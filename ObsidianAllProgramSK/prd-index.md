# PRD Sistem — Dashboard Web Smart Classroom

> Spesifikasi fungsional antarmuka web sistem Smart Classroom Attendance. Dokumen ini fokus murni pada arsitektur menu, kebutuhan fungsional, aliran data, dan aturan logika sistem tanpa spesifikasi desain visual (warna, tipografi, tema, atau styling).

## 1. Hierarki Menu Navigasi

Sistem antarmuka web terdiri dari halaman autentikasi + 7 menu utama yang diakses melalui navigasi induk setelah login:

0. **Login** (`/login`) — Gerbang autentikasi staf; satu-satunya halaman yang dapat diakses tanpa sesi. Detail: [prd-auth.md](prd-auth.md).

1. **Overview** (`/overview`) — Pusat pemantauan real-time status kehadiran, okupansi kelas, dan perangkat.
2. **Attendance** (`/attendance`) — Manajemen dan inspeksi catatan absensi serta log alur verifikasi biometrik.
3. **Students** (`/students`) — Manajemen data induk siswa dan orkestrasi enrollment biometrik (wajah & sidik jari).
4. **Classes & Seats** (`/classes-seats`) — Manajemen kelas dan monitoring telemetri sensor okupansi kursi.
5. **Device Monitoring** (`/devices`) — Monitoring status perangkat IoT, riwayat heartbeat, dan inspeksi antrian perintah.
6. **Reports** (`/reports`) — Agregasi data historis absensi dan ekspor laporan.
7. **Settings** (`/settings`) — Konfigurasi aturan sistem, ambang batas, kredensial perangkat, dan manajemen pengguna.

- Indikator status konektivitas sistem pusat (koneksi Next.js API & Supabase Realtime).
- Pemilih konteks kelas aktif (global filter).
- Notifikasi sistem (peringatan perangkat offline atau anomali absensi).
- Profil sesi pengguna aktif dan fungsi logout.

> **Keputusan arsitektur (2026-10-20):** NestJS dihapus. Satu project Next.js full-stack (UI + Route Handlers) dengan Supabase (PostgreSQL + Auth + Realtime) sebagai backend. Tanpa WebSocket gateway custom.

## 2. Matriks Hak Akses Menu

Sistem menerapkan Role-Based Access Control (RBAC) dengan 3 peran pengguna. Scope sistem adalah **admin dashboard staf saja**; akun/portal siswa eksplisit out-of-scope (siswa tidak login ke sistem ini — kehadiran mereka diverifikasi via biometrik perangkat kelas).

| Menu | Admin | Teacher | Observer |
|---|---|---|---|
| Overview | Akses penuh (semua kelas) | Terbatas kelas yang diampu | Read-only |
| Attendance | Baca, filter, koreksi manual (`TBD`) | Baca & filter kelas sendiri | Read-only |
| Students | CRUD penuh + trigger enrollment | Baca data siswa & request enrollment | Read-only |
| Classes & Seats | Baca & konfigurasi kursi | Baca status kelas sendiri | Read-only |
| Device Monitoring | Baca, uji perintah, rotasi kredensial | Baca perangkat kelas sendiri | Read-only |
| Reports | Filter & ekspor semua kelas | Filter & ekspor kelas sendiri | Baca tanpa ekspor |
| Settings | Akses penuh | Tidak memiliki akses | Tidak memiliki akses |

## 3. Integrasi Sistem & Penanganan Event Real-time

Antarmuka web berjalan dalam satu project Next.js full-stack yang berkomunikasi dengan Supabase melalui dua kanal:
1. **REST API (HTTPS)**: Route Handlers Next.js (`/api/*`) + Supabase PostgREST untuk autentikasi sesi, query data awal, mutasi data (CRUD), dan pengambilan data historis terpaginasi.
2. **Supabase Realtime (postgres_changes)**: Langganan perubahan tabel `attendance`, `seat_status`, dan `devices` untuk pembaruan status tanpa refresh. Tanpa WebSocket gateway custom.

Event Realtime (sumber tabel) yang wajib ditangani oleh sistem web:

| Event | Sumber Tabel | Reaksi Sistem pada Antarmuka |
|---|---|---|
| `attendance` INSERT/UPDATE | `public.attendance` | Memperbarui counter kehadiran di Overview dan menyisipkan baris pada tabel Attendance. |
| `attendance_sessions` UPDATE | `public.attendance_sessions` | Memperbarui status verifikasi yang sedang berjalan pada timeline inspeksi absensi. |
| `seat_status` UPDATE | `public.seat_status` | Memperbarui status okupansi kursi pada denah kelas dan ringkasan okupansi. |
| `devices` UPDATE | `public.devices` | Mengubah indikator perangkat menjadi offline dan memicu notifikasi peringatan. |

Jika koneksi Realtime terputus:
- Sistem menampilkan status koneksi terdegradasi.
- Mekanisme auto-reconnect dijalankan secara berkala.
- Setelah koneksi pulih, sistem melakukan sinkronisasi ulang state terkini melalui query REST API.

## 4. Indeks Spesifikasi Menu

- [prd-auth.md](prd-auth.md) — Fungsionalitas Login & Sesi Autentikasi
- [prd-overview.md](prd-overview.md) — Fungsionalitas Menu Overview
- [prd-attendance.md](prd-attendance.md) — Fungsionalitas Menu Attendance
- [prd-students.md](prd-students.md) — Fungsionalitas Menu Students
- [prd-classes-seats.md](prd-classes-seats.md) — Fungsionalitas Menu Classes & Seats
- [prd-devices.md](prd-devices.md) — Fungsionalitas Menu Device Monitoring
- [prd-reports.md](prd-reports.md) — Fungsionalitas Menu Reports
- [prd-settings.md](prd-settings.md) — Fungsionalitas Menu Settings
