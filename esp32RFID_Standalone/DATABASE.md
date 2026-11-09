# Database RFID — struktur & kebijakan (khusus board ini)

Prasyarat: `setup.sql` dijalankan SEKALI di Supabase SQL Editor.
Idempoten — aman dijalankan ulang (`if not exists`, `drop if exists`).

## Kenapa tabel terpisah, bukan kolom di `students`?

Firmware membaca UID lewat anon key. Kalau UID disimpan sebagai kolom di
`students`, anon otomatis bisa membaca seluruh kolom itu: nama, kelas, no.
telepon wali. Tabel `rfid_cards` terpisah membuat yang terekspos cuma UID.

Alur baca: `rfid_cards` boleh dibaca anon (hanya UID + student_id).
Alur tulis event: `rfid_events` boleh INSERT oleh anon.

## Tabel

### `rfid_cards` — pemetaan kartu → siswa

| Kolom | Tipe | Keterangan |
|---|---|---|
| `uid` | text PK | `"A3:1F:22:04"`, huruf besar, format dari `bacaUid()` |
| `student_id` | text FK → `students(student_id)`, ON DELETE CASCADE | salah ketik = ditolak 409 |
| `created_at` | timestamptz, default now() | |

Satu kartu = satu baris. Daftar ulang kartu yang sama **memindahkan** ikatan
ke siswa baru (upsert `on_conflict=uid`), bukan duplikat.
Hapus siswa → kartunya ikut terhapus (CASCADE).

### `rfid_events` — log tap kartu

| Kolom | Tipe | Keterangan |
|---|---|---|
| `event_id` | uuid PK, default gen_random_uuid() | |
| `device_id` | text FK → `devices` | Device `EDGE-01` harus ada, kalau tidak: HTTP 409 |
| `uid` | text | UID yang ditempel, terdaftar atau tidak |
| `status` | `'known'` / `'unknown'` | hasil cek `rfid_cards` saat tap |
| `created_at` | timestamptz | urutan kronologis tap |

Tabel ini **bukan absensi** — hanya bukti kartu ditempel. Absensi resmi tetap
dari pipeline 2FA wajah + sidik jari.

### `devices` — baris milik board ini

| `device_id` | `name` | `type` | `class_id` | `status` |
|---|---|---|---|---|
| `EDGE-01` | ESP32 RC522 RFID | `rfid_esp32` | `XII-RPL-1` | `online` |

Setup juga memperluas `devices_type_check` dengan `'rfid_esp32'` (beserta
`'env_esp32'` yang sudah dipakai setup lain tapi belum ada di dokumen skema).
Tanpa ini INSERT device gagal 23514.

## RLS (Row Level Security)

| Policy | Tabel | Akses |
|---|---|---|
| `rficards_read` | `rfid_cards` | SELECT untuk anon + authenticated |
| `rficards_enroll` | `rfid_cards` | INSERT untuk anon (agar perintah Serial `CARD` jalan) |
| `rficards_rebind` | `rfid_cards` | UPDATE untuk anon (agar daftar ulang memindahkan ikatan) |
| `rfidevents_write` | `rfid_events` | INSERT untuk anon |
| `rfidevents_read` | `rfid_events` | SELECT untuk anon + authenticated |

Risiko yang diterima: anon key di firmware bisa mengikat kartu ke siswa mana
pun. Tidak bisa membaca tabel lain. `ponytail:` cabut `rficards_enroll` dan
`rficards_rebind` saat pendaftaran kartu pindah ke website (button login-gated),
ganti dengan policy INSERT untuk role authenticated saja.

## Realtime website

`rfid_events` didaftarkan ke publikasi `supabase_realtime`, jadi halaman web
bisa subscribe `postgres_changes` tanpa refresh. `rfid_cards` tidak perlu
realtime (diubah jarang, hanya saat pendaftaran).

## Query operasional

Daftarkan satu kartu (setara perintah Serial `CARD`):

```sql
insert into public.rfid_cards (uid, student_id)
values ('A3:1F:22:04', '40123292')
on conflict (uid) do update set student_id = excluded.student_id;
```

Daftarkan banyak kartu sekaligus (salin UID dari Serial Monitor ke Excel dulu):

```sql
insert into public.rfid_cards (uid, student_id) values
  ('A3:1F:22:04', '40123292'),
  ('55:00:AA:11', '40123233')
on conflict (uid) do update set student_id = excluded.student_id;
```

Lihat tap terakhir beserta nama siswa:

> Catatan PostgREST: tidak bisa embed otomatis `rfid_events -> rfid_cards`
> karena `uid` di `rfid_events` sengaja BUKAN foreign key (kartu unknown tidak
> ada di `rfid_cards`). Dari Next.js nanti ambil dua kali atau buat view SQL.

```sql
select e.created_at, e.uid, e.status, s.full_name
from public.rfid_events e
left join public.rfid_cards c on c.uid = e.uid
left join public.students s on s.student_id = c.student_id
order by e.created_at desc limit 20;
```

Lepaskan kartu dari siswa (tanpa menghapus event lama):

```sql
delete from public.rfid_cards where uid = 'A3:1F:22:04';
```

## Error yang pernah terjadi (catatan lapangan)

| Error | Penyebab | Perbaikan |
|---|---|---|
| `409 ... rfid_events_device_id_fkey` | `setup.sql` belum jalan, device `EDGE-01` tidak ada | Jalankan `setup.sql` |
| `23514 ... devices_type_check` | `type` baru (`rfid_esp32`) belum diizinkan constraint | Sudah ditangani setup §3 |
| `CARD_TIMEOUT` | Kartu ditempel setelah jendela 15 dtk tutup | Tempel setelah `TAP_CARD` muncul |
