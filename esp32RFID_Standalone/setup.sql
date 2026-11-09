-- ==================================================
-- Jalankan SEKALI di Supabase SQL Editor.
-- Prasyarat firmware esp32RFID_Standalone.ino (RC522 saja, tanpa R503).
-- Event sidik jari diurus esp32R503_Standalone/setup.sql, bukan di sini.
-- ==================================================

-- 1. Tabel pemetaan kartu -> siswa.
--    Sengaja tabel terpisah (bukan kolom di students) supaya anon hanya
--    bisa membaca UID, tidak ikut membaca nama/telepon wali.
create table if not exists public.rfid_cards (
  uid        text primary key,                    -- "A3:1F:22:04" (huruf besar)
  student_id text not null references public.students(student_id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.rfid_cards enable row level security;

drop policy if exists rficards_read on public.rfid_cards;
create policy rficards_read on public.rfid_cards
  for select to anon, authenticated using (true);

-- Perintah Serial "CARD <student_id>" butuh anon bisa tulis rfid_cards.
-- Risiko: siapa pun yang pegang anon key bisa mengikat kartu ke siswa mana pun
-- (tapi TIDAK bisa membaca/merusak tabel lain). ponytail: cabut policy ini
-- saat fitur "Daftarkan Kartu" sudah ada di website (button login-gated).
drop policy if exists rficards_enroll on public.rfid_cards;
create policy rficards_enroll on public.rfid_cards
  for insert to anon with check (true);

drop policy if exists rficards_rebind on public.rfid_cards;
create policy rficards_rebind on public.rfid_cards
  for update to anon using (true) with check (true);

-- 2. Tabel event tap kartu (audit/display, TIDAK mengubah attendance).
create table if not exists public.rfid_events (
  event_id   uuid primary key default gen_random_uuid(),
  device_id  text not null references public.devices(device_id) on delete cascade,
  uid        text not null,
  status     text not null check (status in ('known', 'unknown')),
  created_at timestamptz not null default now()
);

alter table public.rfid_events enable row level security;

drop policy if exists rfidevents_write on public.rfid_events;
create policy rfidevents_write on public.rfid_events
  for insert to anon with check (true);

drop policy if exists rfidevents_read on public.rfid_events;
create policy rfidevents_read on public.rfid_events
  for select to anon, authenticated using (true);

-- 3. Izinkan tipe pembaca kartu, lalu daftarkan perangkat.
--    daftar tipe yang sah sudah termasuk env_esp32 (dibuat setup lain).
alter table public.devices drop constraint if exists devices_type_check;
alter table public.devices
  add constraint devices_type_check
  check (type in ('face_computer', 'fingerprint_esp32', 'seat_esp32',
                  'env_esp32', 'rfid_esp32'));

insert into public.devices (device_id, name, type, class_id, status, is_active)
values ('EDGE-01', 'ESP32 RC522 RFID', 'rfid_esp32', 'XII-RPL-1', 'online', true)
on conflict (device_id) do update
  set type = excluded.type, class_id = excluded.class_id,
      name = excluded.name, is_active = true;

-- 4. Publikasi realtime untuk website.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['rfid_events'] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- 5. Contoh isi pemetaan kartu (ganti UID + student_id punyamu):
--    insert into public.rfid_cards (uid, student_id)
--    values ('A3:1F:22:04', 'SISWA-001');
