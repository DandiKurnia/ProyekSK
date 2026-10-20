# Naskah PPT — Website Admin Dashboard Smart Classroom Attendance

> **Dokumen naskah presentasi (slide-by-slide)** untuk demo progres besok.  
> **Scope presentasi:** khusus website Admin Dashboard (design + mockup progres).  
> **Sumber materi:** [prd-admin-dashboard-full.md](prd-admin-dashboard-full.md).  
> **Target durasi:** ~20 menit untuk 13 slide (1.5 menit/slide).

---

## Slide 1 — Judul &amp; Konteks Proyek

**Judul slide:** Smart Classroom Attendance — Admin Dashboard (Website)

**Isi / talking points:**

- Proyek Hybrid AIoT: absensi otomatis siswa via verifikasi biometrik 2 faktor (wajah + sidik jari).
- Bagian yang kami kerjakan: **website Admin Dashboard** — pusat monitoring, manajemen data, dan konfigurasi sistem.
- Status hari ini: **PRD sistem selesai + desain mockup sedang berjalan** (tunjukkan progres).

**VISUAL — TARUH MOCKUP:**  
Logo tim + 2 badge highlight: "PRD Complete" dan "Design In Progress".  
*(Tidak ada mockup halaman di slide ini — cukup logo + badge.)*

---

## Slide 2 — Arsitektur Sistem: Posisi Website

**Judul slide:** Di Mana Posisi Website dalam Sistem?

**Isi / talking points:**

- 5 komponen: Backend Next.js full-stack + Supabase (otak pusat), Edge PC Face Recognition (FastAPI + YuNet/SFace), ESP32 Fingerprint via USB Serial ke laptop (R503), ESP32 Seat Sensor via Wi-Fi (load cell + HX711), dan **Dashboard Web (fokus kami)**.
- Website berkomunikasi dengan cloud via 2 kanal: **REST HTTPS** (query & mutasi data) dan **Supabase Realtime** (update real-time, tanpa WebSocket gateway custom).
- Website **tidak** berkomunikasi langsung dengan perangkat fingerprint — jalur serial USB hanya antara face service PC dan ESP32 (di luar browser).

**VISUAL — TARUH LOGO TEKNOLOGI (bukan diagram kotak polos):**
Diagram arsitektur menggunakan **logo resmi setiap teknologi** agar mudah dikenali teman satu tim dan audiens:

- Logo **Next.js** untuk backend pusat + dashboard (satu project full-stack).
- Logo **Python/FastAPI** untuk edge face recognition.
- Logo **ESP32** (atau ikon chip) untuk 2 perangkat IoT.
- Logo **Supabase/PostgreSQL** (gajah biru) untuk database + Realtime.
- Logo **React/Next.js** untuk dashboard web (fokus kami).

Susun kiri-ke-kanan: `ESP32-FP (logo, via USB ke PC) + FastAPI (logo, PC kelas) + ESP32-Seat (logo, Wi-Fi) → Next.js + Supabase (logo, tengah, HTTPS + Realtime); React (logo) di kanan sebagai bagian project Next.js yang sama.`
Sumber logo: unduh SVG resmi dari situs masing-masing teknologi (gratis, hindari screenshot blur).

---

## Slide 3 — Ruang Lingkup &amp; Batasan

**Judul slide:** Scope Website: Untuk Staf, Bukan Siswa

**Isi / talking points:**

- Pengguna website = **staf sekolah saja**: Admin, Teacher, Observer (3 role).
- **Siswa tidak login** — kehadiran mereka terverifikasi otomatis via biometrik di kelas.
- **Kursi ≠ identitas**: sensor kursi hanya data okupansi fisik (kosong/terisi), tidak dipetakan ke siswa. Absensi resmi hanya dari verifikasi biometrik.
- **Privasi biometrik**: website tidak pernah menampilkan/mengunduh data biometrik mentah (foto, embedding, template) — hanya metadata status.

**VISUAL — TARUH MOCKUP:**  
4 kartu batasan scope + ikon peran (sudah sesuai, tidak berubah).

---

## Slide 4 — Halaman Login (gambar mockup login)

**Judul slide:** Login &amp; Keamanan Sesi

**Isi / talking points:**

- **1 halaman login** (gerbang tunggal, route guard) sebelum masuk ke **7 menu internal**:
Overview, Attendance, Students, Classes &amp; Seats, Device Monitoring, Reports, Settings.
- Input: email/username + password → sesi terautentikasi via Supabase Auth / Route Handler Next.js.
- Tanpa sesi valid: semua route internal diblokir → redirect ke login.

**VISUAL — TARUH MOCKUP (WAJIB):**
**Mockup halaman login** — gambar desain form login: field identifier, field password, tombol "Masuk", plus contoh pesan error inline.

## Slide 5 — Overview Dashboard (gambar mockup overview)

**Judul slide:** Overview — Pusat Monitoring Real-time

**Isi / talking points:**

- 4 blok informasi:
  1. KPI kehadiran hari ini: Total / Present / **Late (dihitung terpisah)** / Absent + persentase kehadiran.
  2. Ringkasan okupansi kursi (Occupied / Empty / Unknown) + catatan "telemetri sensor, bukan absensi".
  3. Log aktivitas verifikasi live (10–20 transaksi terakhir) via Supabase Realtime.
  4. Kesehatan perangkat (Edge PC, ESP32 FP, ESP32 Seat) + last seen.
- Update instan tanpa refresh via Realtime: `attendance` (INSERT/UPDATE), `seat_status` (UPDATE), `devices` (UPDATE).
**VISUAL — TARUH MOCKUP (WAJIB — MOCKUP UTAMA):**  
**Mockup full-page Overview** — gambar desain 4 blok: baris KPI counter di atas, blok okupansi kursi + live feed di tengah, strip status perangkat di bawah. Saat presentasi, tunjuk tiap blok sambil jelaskan.

---

## Slide 6 — Attendance (gambar mockup tabel attendance)

**Judul slide:** Attendance — Audit Catatan Absensi

**Isi / talking points:**

- Tabel seluruh catatan absensi + filter multi-kriteria: rentang tanggal, kelas, status (multi-select), pencarian NIS/nama. Paginasi + ekspor CSV.
- **6 status mutlak**: `Present`, `Late`, `Pending`, `Failed`, `Expired`, `Absent`.
- Koreksi status manual (Admin only, wajib alasan + audit trail) — fitur Planned.

**VISUAL — TARUH MOCKUP (WAJIB):**  
**Mockup halaman Attendance** — gambar desain: panel filter di atas, tabel catatan kehadiran dengan kolom status (tampilkan minimal 3 status berbeda agar terlihat variasinya), tombol ekspor CSV.

---

## Slide 7 — Detail Audit Verifikasi (gambar mockup drawer timeline)

**Judul slide:** Timeline Verifikasi 2 Faktor per Transaksi

**Isi / talking points:**

- Klik satu transaksi → drawer detail audit berisi timeline kronologis:
deteksi wajah (edge PC) → skor similarity SFace → perintah serial `VERIFY` via USB ke ESP32 → verifikasi R503 + slot template → validasi Route Handler Next.js → tersimpan di Supabase PostgreSQL.
- Ini nilai jual teknis: **setiap keputusan absensi bisa diaudit sampai ke akar**.

**VISUAL — TARUH MOCKUP (WAJIB):**  
**Mockup drawer detail audit** — gambar desain drawer terbuka di samping tabel (gelapkan tabel di belakangnya), isi drawer berupa timeline vertikal 6 titik kronologis.

---

## Slide 8 — Students & Enrollment (gambar mockup modal enrollment)

**Judul slide:** Students — Dua Jalur Enrollment yang Terpisah

**Isi / talking points:**

- Direktori siswa: CRUD, import CSV, status enrollment wajah &amp; fingerprint ditampilkan terpisah.
- **Enrollment Wajah**: upload foto/webcam → deteksi YuNet (harus tepat 1 wajah) → embedding SFace disimpan di edge PC.
- **Enrollment Fingerprint**: kirim perintah ke antrian ESP32 → sensor R503 aktif → jari ditempel 2x → template tersimpan di sensor → callback sukses.
- Dua workflow **tidak boleh digabung dalam satu form** — jalur teknologinya berbeda.

**VISUAL — TARUH MOCKUP (WAJIB):**  
**Dua mockup modal berdampingan**:  

- Kiri: modal Enrollment Wajah (area upload/preview foto + tombol validasi).  
- Kanan: modal Enrollment Fingerprint (pemilih perangkat ESP32 + countdown 30 detik + status sensor).

---

## Slide 9 — Classes & Seats (gambar mockup seat map)

**Judul slide:** Classes &amp; Seats — Telemetri Okupansi Kursi

**Isi / talking points:**

- Daftar kelas + **seat map** grid per ruangan.
- Status per kursi: `Empty` (&lt;5 kg), `Occupied` (≥15 kg stabil), `Unknown` (anomali/kabel lepas) + penanda data basi jika ESP32 tidak melapor 2 menit.
- Klik kursi → panel detail: berat kg saat ini, timestamp, riwayat perubahan status hari ini.
- Tegas: panel ini **tanpa nama/foto siswa**.

**VISUAL — TARUH MOCKUP (WAJIB):**  
**Mockup seat map** — gambar desain grid kursi 4×6 dengan 3 variasi status warna + 1 panel detail kursi di sisi kanan (berat kg, timestamp, log status hari ini).

---

## Slide 10 — Device Monitoring (gambar mockup device monitoring)

**Judul slide:** Device Monitoring — Kesehatan Perangkat IoT

**Isi / talking points:**

- Inventaris 3 tipe perangkat: Face Recognition PC, Fingerprint Scanner (ESP32+R503 via USB), Seat Occupancy Hub (ESP32+HX711 via Wi-Fi) — status Online/Offline + last seen.
- **Status Serial / Fallback Tracker**: pantau koneksi COM port USB untuk fingerprint lokal; tabel command queue hanya aktif bila arsitektur memakai fallback Wi-Fi.
- Log error perangkat + aksi Admin: uji koneksi, rotasi kredensial, tandai inspeksi fisik.

**VISUAL — TARUH MOCKUP (WAJIB):**
**Mockup halaman Devices** — gambar desain: kartu daftar 3 perangkat dengan badge Online/Offline di atas, strip status port USB/serial di bawah.

---

## Slide 11 — Reports (gambar mockup halaman reports)

**Judul slide:** Reports — Agregasi &amp; Ekspor Laporan

**Isi / talking points:**

- Filter periode (minggu/bulan/semester/custom) + kelas.
- Output: ringkasan persentase kehadiran (Late terpisah dari Present), tabel distribusi harian, rekap per siswa, dan **uptime perangkat** (untuk validasi absensi yang terlewat saat sistem down).
- Ekspor CSV; PDF = Planned.

**VISUAL — TARUH MOCKUP (WAJIB):**  
**Mockup halaman Reports** — gambar desain: filter periode &amp; kelas di atas, ringkasan angka, tabel rekap harian, tombol ekspor CSV.

---

## Slide 12 — Settings (gambar mockup halaman settings)

**Judul slide:** Settings — Konfigurasi Tata Kelola Sistem

**Isi / talking points:**

- 5 tab: **General** (institusi, timezone, tahun ajaran) · **Attendance Rules** (jendela jam absensi, batas Late, timeout verifikasi, kebijakan duplikat) · **Device Config** (threshold offline, ambang beban kursi) · **User Management** (CRUD staf, role, lockout protection) · **Security** (revoke sesi, regenerasi API key).

**VISUAL — TARUH MOCKUP (WAJIB):**  
**Mockup halaman Settings** — gambar desain dengan tab "Attendance Rules" aktif: form jam absensi, input batas Late, dropdown timeout, toggle kebijakan duplikat. 4 tab lain tampil sebagai tab header.

---

## Slide 13 — Penutup: Ketahanan Sistem & Progres Tim (gambar mockup state UI)

**Judul slide:** Siap Gagal dengan Anggun + Roadmap Tim

**Isi / talking points:**

- 4 state UI wajib di setiap komponen: **Loading**, **Empty**, **Error (retry)**, **Stale/Reconnecting** (exponential backoff + resinkronisasi REST saat Realtime pulih).
- **Progres tim (khusus bagian website):**
  - ✅ PRD sistem lengkap selesai (arsitektur 1-project Next.js + USB Serial, 8 halaman, event Realtime, exception).
  - 🔄 Design/mockup halaman — sedang dikerjakan (sebut % yang sudah jadi).
  - ⏭️ Berikutnya: implementasi frontend (Next.js + Supabase), integrasi REST & Realtime.

**VISUAL — TARUH MOCKUP (WAJIB):**  
**4 mockup state UI dalam satu baris** (screenshot desain komponen yang sama dalam 4 keadaan: skeleton loading / empty state / error dengan tombol retry / banner reconnecting) + timeline progres tim di bawahnya (done / in progress / next).

---

## Lampiran A — Cadangan Slide (Backups, tampilkan hanya jika ditanya)


| Slide cadangan               | Isi                                                   | Trigger                     |
| ---------------------------- | ----------------------------------------------------- | --------------------------- |
| A1. Matriks RBAC lengkap     | Tabel 8×3 dari PRD §2 (dihapus dari urutan utama)     | Ditanya soal hak akses      |
| A2. Event Supabase Realtime  | Payload postgres_changes per tabel dari PRD §6        | Ditanya soal real-time      |
| A3. State machine verifikasi | Diagram 8 langkah dari PRD §5                         | Ditanya alur absensi detail |
| A4. Keamanan login           | Rate-limit, anti-enumeration, session handling        | Ditanya keamanan            |
| A5. Aturan load cell         | Threshold 5/15 kg, histeresis 3 detik, kalibrasi tare | Ditanya sensor kursi        |


---

## Lampiran B — Checklist Mockup per Slide (Untuk Pembuatan PPT)

Legend: **[MOCKUP]** = taruh gambar design halaman website. **[LOGO]** = taruh logo teknologi. **[DIAGRAM]** = taruh diagram sederhana.


| Slide | Item visual yang harus disiapkan                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------- |
| 1     | \[LOGO\] Logo tim + 2 badge teks                                                                           |
| 2     | \[LOGO\] Logo Next.js, FastAPI, ESP32, Supabase/Postgres, React disusun jadi diagram arsitektur |
| 3     | \[DIAGRAM\] 4 kartu scope + ikon peran                                                                     |
| 4     | **\[MOCKUP\] Halaman login** — WAJIB                                                                       |
| 5     | **\[MOCKUP\] Overview full-page (4 blok)** — WAJIB, mockup utama                                           |
| 6     | **\[MOCKUP\] Attendance: filter + tabel + 3 variasi status** — WAJIB                                       |
| 7     | **\[MOCKUP\] Drawer timeline audit** — WAJIB                                                               |
| 8     | **\[MOCKUP\] 2 modal enrollment (wajah &amp; fingerprint)** — WAJIB                                        |
| 9     | **\[MOCKUP\] Seat map grid + panel detail** — WAJIB                                                        |
| 10    | **\[MOCKUP\] Device list + status serial port** — WAJIB                                                    |
| 11    | **\[MOCKUP\] Reports: filter + tabel rekap** — WAJIB                                                       |
| 12    | **\[MOCKUP\] Settings tab Attendance Rules** — WAJIB                                                       |
| 13    | **\[MOCKUP\] 4 state UI sebaris + timeline progres** — WAJIB                                               |


**Total mockup yang harus disiapkan: 10 gambar halaman/komponen + 1 diagram logo + 1 diagram scope.**

---