# Backlog — Sinkronisasi Enrollment & Sisa Website

> Dibuat 2026-10-22. Aturan emas: **Supabase = sumber kebenaran identitas; `.npz` + R503 = kunci fisik yang mengikuti Supabase** (daftar saat ditambah, hapus saat dihapus). Vektor wajah dan template jari TIDAK PERNAH ke cloud.

## A. Enrollment Wajah ↔ Supabase (kritis, tanpa hardware)

 - [x] **A1. Form enroll pilih siswa dari Supabase** — SELESAI 2026-10-22. Dropdown kandidat `GET /api/students` di `/students/enroll`; pilih → isi otomatis `studentId`+`fullName`; ketik manual tetap fallback; pre-fill `?student_id=` sinkronkan nama. (Dandi 40123292 via flow ini → `face_status=enrolled`.)
 - [x] **A2. Tulis `face_status` setelah `:8200/enroll` sukses** — SELESAI 2026-10-22. `POST /api/face/enroll` → `UPDATE students SET face_status='enrolled', face_enrolled_at=now()` via service-role; UI hanya sukses bila sinkron.
 - [x] **A3. Rollback `.npz` bila update DB gagal** — SELESAI 2026-10-22. Jika update 0 baris / DB error → `DELETE :8200/enroll/{id}` lalu 422 (diuji: update ID fiktif → `data:[]` → orphan terdeteksi → tidak ada entri yatim).

## B. Enrollment Sidik Jari R503 (butuh hardware ESP32+R503)

- [x] **B1. Firmware `esp32R503_Serial/esp32R503_Serial.ino`** — SELESAI (firmware v1.0, commit ini): parser `PING` / `ENROLL <id>` / `DELETE <id>` / `CLEAR` / `LED_OK`, event `MATCH <id> <conf>` / `NOMATCH` / `PLACE` / `REMOVE` / `ENROLL_OK` / `BOOT` / `READY` / `SENSOR_FAIL 0`. Scan 1:N kontinu, **tanpa** `VERIFY`. Spek sinkron di `docs/fingerprint.md`.
- [ ] **B2. `apps/face-service/fingerprint_serial.py`** — buka COM port via `pyserial`, kirim perintah, tunggu respons dengan timeout; parser event sesuai firmware.
- [ ] **B3. Endpoint `server.py`: `POST /fingerprint/enroll {slot}`**, `GET /fingerprint/status`, `DELETE /fingerprint/{slot}` — sesi 2FA 30 dtk dikelola di service (firmware tidak punya `VERIFY`).
- [ ] **B4. Route Next.js `POST /api/fingerprint/enroll`** → teruskan ke `:8200`, lalu `UPDATE students SET fingerprint_slot, fingerprint_status='enrolled'`.
- [ ] **B5. UI `/students/enroll` step 2** — tombol "Daftarkan Sidik Jari" + status `pending` + countdown + hasil slot. Hanya aktif setelah wajah `enrolled`.

## C. Menu Dashboard yang masih mati (`Sidebar.tsx` `href="#"`)

- [ ] **C1. `/classes-seats`** — denah kursi + telemetri `seat_status` (PRD: `prd-classes-seats.md`).
- [ ] **C2. `/devices`** — daftar `devices` + flag `stale` + inspeksi per perangkat (PRD: `prd-devices.md`).
- [ ] **C3. `/reports`** — agregat kehadiran + ekspor CSV (PRD: `prd-reports.md`).
- [ ] **C4. `/settings`** (ADMIN) — kelola `app_config`: threshold, batas late (PRD: `prd-settings.md`).
- [x] **C5. Tabel induk `Students`** — SELESAI 2026-11-01: list + tambah + hapus permanen (purge `.npz` + `attendance` + baris induk). Edit/nonaktif belum ada; masa testing sengaja hard delete. Lihat `daily/2026-11-01.md` §7.

## D. Keamanan (sebelum sidang/demo publik)

- [ ] **D1. Auth + `middleware.ts`** — semua route dashboard terbuka tanpa sesi.
- [ ] **D2. Aktifkan kembali RLS + policy per role** (sekarang dimatikan sementara).
- [ ] **D3. Aktifkan Realtime Replication** (`attendance`, `seat_status`, `devices`) di dashboard Supabase.

## E. Housekeeping

- [ ] **E1. Commit oval-crop `camera/page.tsx`** (sudah `tsc` bersih, belum di-commit).
- [ ] **E2. Sinkronkan `daily/2026-10-20.md`** dengan § baru bila A/B selesai.

### Urutan saran
`A1 → A2 → A3 → C1 → C2 → C5 → D1 → D2 → C3 → C4 → B1..B5 (saat hardware ada) → E1 duluan (sekarang)`
