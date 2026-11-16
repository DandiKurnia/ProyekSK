-- Riwayat okupansi kursi (docs/database.md §11).
-- Tabel `seat_status` & `seats` sudah ada di project live; `seat_events` belum.
-- Jalankan sekali di Supabase → SQL Editor, lalu `notify pgrst, 'reload schema';`
-- (skip reload bila Supabase UI sudah memuat ulang otomatis).

create table if not exists public.seat_events (
  event_id   uuid primary key default gen_random_uuid(),
  seat_id    text not null references public.seats (seat_id) on delete cascade,
  old_status text,
  new_status text not null,
  weight_kg  real,
  created_at timestamptz not null default now()
);

create index if not exists seat_events_seat_created_idx
  on public.seat_events (seat_id, created_at desc);

-- Route Handler memakai service-role (bypass RLS); RLS aktif tanpa policy
-- berarti anon/authenticated tidak bisa membaca riwayat langsung.
alter table public.seat_events enable row level security;


-- Realtime belum aktif untuk seat_status (docs/database.md §Realtime: TBD).
-- Tanpa blok ini channel `postgres_changes` tersambung tapi tak mengirim event.
do $$
begin
  alter publication supabase_realtime add table public.seat_status;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.seat_events;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';