# Rencana: Pipeline Absensi 2FA (`feat/attendance-2fa-pipeline`)

> Parent: `feat/fingerprint-serial-bridge` (sesi `verified` sudah ada, belum menulis absensi).
> **Status: SELESAI (2026-11-02).** Realisasi: freshness 120 dtk (bukan 60), audit `failed`/`expired` insert-only via upsert `ignoreDuplicates` (409 hanya untuk pantulan sesi bekas pakai, bukan `failed`), LED setelah tulis via `LED_OK`, cooldown scan-ulang 30 dtk + auto-reset 3.5 dtk di `/camera`. E2E: verified → baris `late` tercatat (id sama = idempoten), replay → 409, sesi terkonsumsi, `LED_OK` terkirim. `tsc` + `build` bersih.

## Kontrak `POST /api/attendance`

- **Masuk:** `{ student_id }` (hanya NIS; skor/slot tidak dipercaya dari browser).
- **Verifikasi server-side** (urutan, berhenti di gagal pertama):
  1. Ambil `slot` dari `students.fingerprint_slot`; NULL → 403 `no_slot`.
  2. `GET {FACE_URL}/fingerprint/session` — harus `state=verified`, `student_id` sama, `matched_slot == slot`. Selain itu → 409 (`pending`/`failed`/`expired`).
  3. Freshness: `verified_at` ≤ 60 dtk (anti-replay sesi basi).
- **Penentuan status:** baca `app_config.late_threshold` (`{"time":"HH:MM"}` WIB). `check_in_at > batas` → `late`, else `present`. Key hilang/rusak → fallback `present`.
- **Tulis:** `upsert(students+class+date)` memakai unique constraint → idempoten (scan ganda = 1 baris).
- **Sesudah tulis:** `DELETE` sesi (konsumsi 1x) + `POST {FACE_URL}/fingerprint/led` bila ada `LED_OK` (best-effort, abaikan gagal).

## Kontrak event gagal

- `failed`/`expired` sesi → baris audit `{ status: 'failed' | 'expired', face_confidence }` via `POST /api/attendance { student_id, outcome }` (hanya bila verifikasi wajah itu sah: `slot == siswa`, tanpa replay baru karena sesi masih aktif).
- `GET /api/attendance`: tambah `status=` (AND dengan filter lain), hapus mock Pending dari kode.

## Perubahan file (±5)

1. `apps/face-service/server.py` — `POST /fingerprint/led` (~8 baris).
2. `apps/web/.../api/attendance/route.ts` — `POST` handler (~60 baris) + `status` di GET.
3. `apps/web/.../camera/page.tsx` — panggil POST saat `verified`, tampil hasil, reset 3 dtk.
4. `apps/web/.../attendance/page.tsx` — filter status nyata.
5. `ObsidianAllProgramSK/docs/plan-...` — file ini.

## Tugas Berikutnya / Tidak dikerjakan

- **Absensi pulang (check-out) — BACKLOG (2026-11-02).** Sistem kini hanya mencatat kedatangan (`check_in_at`); tidak ada kolom `check_out_at`. Bila dibutuhkan: migrasi Supabase (kolom `check_out_at` / tabel terpisah) → bedakan scan kedua hari yang sama sebagai pulang di `POST /api/attendance` → tampilkan jam pulang di `/attendance` + Overview. Kerjakan di branch baru terpisah (mis. `feat/attendance-checkout`), bukan di branch ini.
- Tugas lain yang tidak dikerjakan: `attendance_sessions` (fallback Wi-Fi only), RLS/policy, koreksi manual admin, ekspor CSV.
