-- ==================================================
-- Jalankan SEKALI di Supabase SQL Editor (project crflhxkaqqsrywqtfjef).
-- Prasyarat firmware esp32DHT_Ingest.ino. Tiga langkah, tidak ada RPC.
-- ==================================================

-- 1. Izinkan tipe device 'env_esp32'.
alter table public.devices drop constraint if exists devices_type_check;
alter table public.devices add constraint devices_type_check
  check (type in ('face_computer', 'fingerprint_esp32', 'seat_esp32', 'env_esp32'));

-- 2. Daftarkan perangkat. GANTI device_id/class_id bila berbeda,
--    lalu samakan dengan #define di firmware.
--    (Wajib ada karena classroom_env punya FK ke devices.)
insert into public.devices (device_id, name, type, class_id, status, is_active)
values ('ENV-XII-RPL-1', 'Sensor DHT Kelas XII RPL 1', 'env_esp32', 'XII-RPL-1', 'online', true)
on conflict (device_id) do update
  set type = excluded.type, class_id = excluded.class_id,
      name = excluded.name, is_active = true;

-- 3. Izinkan anon (key di firmware) menulis classroom_env.
--    Hanya INSERT + UPDATE, tidak bisa hapus, tidak bisa baca tabel lain.
drop policy if exists env_write on public.classroom_env;
create policy env_write on public.classroom_env
  for insert to anon with check (true);

drop policy if exists env_update on public.classroom_env;
create policy env_update on public.classroom_env
  for update to anon using (true) with check (true);

-- 4. updated_at otomatis terisi setiap upsert (payload firmware tidak
--    membawa waktu; ESP32 tanpa NTP tidak tahu jam yang benar).
--    Jalankan ulang bagian ini saja bila langkah 1-3 sudah dijalankan.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists classroom_env_touch on public.classroom_env;
create trigger classroom_env_touch
  before insert or update on public.classroom_env
  for each row execute function public.touch_updated_at();
