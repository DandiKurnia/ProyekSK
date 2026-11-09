-- ==================================================
-- Jalankan SEKALI di Supabase SQL Editor.
-- Prasyarat firmware esp32Seat_LoadCell.ino.
-- ==================================================

-- 1. Daftarkan perangkat kursi. Tipe 'seat_esp32' sudah diizinkan
--    constraint bawaan. GANTI device_id bila berbeda,
--    lalu samakan dengan SEAT_ID di firmware.
--    (Wajib ada karena seats.device_id punya FK ke devices.)
insert into public.devices (device_id, name, type, class_id, status, is_active)
values ('SEAT-ESP-01', 'Sensor Kursi Baris A', 'seat_esp32', 'XII-RPL-1', 'online', true)
on conflict (device_id) do update
  set type = excluded.type, class_id = excluded.class_id,
      name = excluded.name, is_active = true;

-- 2. Kaitkan kursi ke perangkatnya.
update public.seats set device_id = 'SEAT-ESP-01' where seat_id = 'SEAT-01';

-- 3. updated_at otomatis terisi setiap upsert (payload firmware tidak
--    membawa waktu; ESP32 tanpa NTP tidak tahu jam yang benar).
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists seat_status_touch on public.seat_status;
create trigger seat_status_touch
  before insert or update on public.seat_status
  for each row execute function public.touch_updated_at();

-- 4. Izinkan anon (key di firmware) menulis seat_status.
--    Hanya INSERT + UPDATE, tidak bisa hapus, tidak bisa baca tabel lain.
drop policy if exists seatstatus_write on public.seat_status;
create policy seatstatus_write on public.seat_status
  for insert to anon with check (true);

drop policy if exists seatstatus_update on public.seat_status;
create policy seatstatus_update on public.seat_status
  for update to anon using (true) with check (true);
