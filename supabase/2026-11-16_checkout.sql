-- Absen pulang (check-out) — docs/database.md §8 & §8a.
-- Kolom `attendance.check_out_at` + ambang jam `app_config.checkout_after`.
-- Jalankan sekali di Supabase → SQL Editor (aman diulang: semua idempotent).

alter table public.attendance
  add column if not exists check_out_at timestamptz;

-- Tanpa baris ini POST /api/attendance memakai fallback "12:00" (DEFAULT_CHECKOUT_AFTER).
insert into public.app_config (key, value) values ('checkout_after', '"12:00"'::jsonb)
  on conflict (key) do nothing;

notify pgrst, 'reload schema';
