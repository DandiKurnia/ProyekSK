-- Aktifkan Realtime untuk tabel yang dibaca live oleh dashboard.
-- Gejala tanpa ini: channel `postgres_changes` tersambung (SUBSCRIBED) tapi
-- tidak pernah mengirim event → UI hanya berubah setelah refresh manual.
-- Jalankan sekali di Supabase → SQL Editor.

do $$
declare
  t text;
begin
  foreach t in array array[
    'attendance', 'seat_status', 'seat_events', 'devices', 'fingerprint_events', 'rfid_events'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_table then null;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';