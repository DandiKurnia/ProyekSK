-- ==================================================
-- Jalankan SEKALI di Supabase SQL Editor.
-- Prasyarat firmware esp32R503_Standalone.ino.
-- ==================================================

-- 1. Tabel event mentah sidik jari.
--    Hanya audit/display log; TIDAK mengubah tabel attendance (alur 2FA tetap terpisah).
create table if not exists public.fingerprint_events (
  event_id    uuid primary key default gen_random_uuid(),
  device_id   text not null references public.devices(device_id) on delete cascade,
  slot_id     smallint,                          -- null bila NOMATCH
  confidence  smallint,                          -- null bila NOMATCH
  status      text not null check (status in ('match', 'no_match')),
  created_at  timestamptz not null default now()
);

alter table public.fingerprint_events enable row level security;

-- 2. Daftarkan perangkat mandiri.
insert into public.devices (device_id, name, type, class_id, status, is_active)
values ('FP-STANDALONE-01', 'Fingerprint Mandiri R503', 'fingerprint_esp32', 'XII-RPL-1', 'online', true)
on conflict (device_id) do update
  set type = excluded.type, class_id = excluded.class_id,
      name = excluded.name, is_active = true;

-- 3. Izin anon: boleh INSERT log event, boleh SELECT (untuk realtime di website).
drop policy if exists fpevents_write on public.fingerprint_events;
create policy fpevents_write on public.fingerprint_events
  for insert to anon with check (true);

drop policy if exists fpevents_read on public.fingerprint_events;
create policy fpevents_read on public.fingerprint_events
  for select to anon, authenticated using (true);

-- 4. Supaya website menerima event saat jari ditempel.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'fingerprint_events') then
    alter publication supabase_realtime add table public.fingerprint_events;
  end if;
end $$;
