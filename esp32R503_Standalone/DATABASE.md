# Database R503 — struktur & kebijakan (khusus board ini)

Prasyarat: `setup.sql` dijalankan SEKALI di Supabase SQL Editor.
Idempoten — aman dijalankan ulang (`if not exists`, `drop policy if exists`).

## Kenapa hanya satu tabel event?

Firmware tidak butuh tabel peserta: verifikasi 1:N dilakukan di **memori flash
R503**, dan hasilnya hanya nomor slot (`slot_id`) + skor (`confidence`).
Yang perlu disimpan cuma jejak kejadiannya. Payload sekecil ini juga berarti
anon key hanya butuh INSERT — tidak ada tabel siswa yang terekspos.

## Tabel

### `fingerprint_events` — log verifikasi jari

| Kolom | Tipe | Keterangan |
|---|---|---|
| `event_id` | uuid PK, default `gen_random_uuid()` | jangan dikirim dari firmware |
| `device_id` | text FK → `devices(device_id)`, ON DELETE CASCADE | `FP-STANDALONE-01` harus ada, kalau tidak HTTP 409 |
| `slot_id` | smallint, **null-able** | nomor slot flash R503 (1–200); `null` saat tidak cocok |
| `confidence` | smallint, **null-able** | 0–255; `null` saat tidak cocok |
| `status` | `'match'` / `'no_match'` | CHECK constraint |
| `created_at` | timestamptz, default `now()` | urutan kronologis |

Tidak ada FK dari `slot_id` ke `students.fingerprint_slot`. Pemetaan slot → siswa
adalah urusan aplikasi/web, bukan constraint DB. Alasan: board mandiri tetap
bisa mencatat event walau siswa belum didaftarkan di tabel `students`.

Tabel ini **bukan absensi** — hanya bukti jari ditempel. Absensi resmi tetap
dari pipeline 2FA wajah + sidik jari (`POST /api/attendance`).

### `devices` — baris milik board ini

| `device_id` | `name` | `type` | `class_id` | `status` |
|---|---|---|---|---|
| `FP-STANDALONE-01` | Fingerprint Mandiri R503 | `fingerprint_esp32` | `XII-RPL-1` | `online` |

`fingerprint_esp32` sudah termasuk dalam `devices_type_check`, jadi tidak perlu
`ALTER TABLE` tambahan (beda dengan `rfid_esp32`).

## RLS (Row Level Security)

| Policy | Tabel | Akses |
|---|---|---|
| `fpevents_write` | `fingerprint_events` | INSERT untuk anon |
| `fpevents_read` | `fingerprint_events` | SELECT untuk anon + authenticated |

Anon hanya bisa menambah baris dan membacanya. Tidak ada UPDATE/DELETE —
event adalah log append-only. Risiko diterima: siapa pun yang memegang anon key
bisa menyuntik event palsu. Tidak bisa merusak tabel lain.

## Realtime website

`fingerprint_events` didaftarkan ke publikasi `supabase_realtime`, jadi dashboard
bisa subscribe `postgres_changes` dan menampilkan `MATCH`/`NOMATCH` tanpa refresh.
`setup.sql` mengecek dulu apakah tabel sudah ada di publikasi agar blok itu aman
dijalankan berulang.

## Query operasional

Jejak tap terakhir:

```sql
select created_at, device_id, slot_id, confidence, status
from public.fingerprint_events
order by created_at desc
limit 20;
```

Event cocok hari ini per slot (agregat cepat):

```sql
select slot_id, count(*) as jumlah
from public.fingerprint_events
where status = 'match'
  and created_at >= current_date
group by slot_id
order by jumlah desc;
```

Event dengan nama siswa (slot dipetakan lewat `students.fingerprint_slot`):

> Catatan PostgREST: tidak bisa embed otomatis `fingerprint_events → students`
> karena `slot_id` sengaja BUKAN foreign key. Dari Next.js ambil dua kali atau
> buat view SQL.

```sql
select e.created_at, e.slot_id, e.confidence, e.status, s.full_name
from public.fingerprint_events e
left join public.students s on s.fingerprint_slot = e.slot_id
order by e.created_at desc limit 20;
```

Bersihkan event lama (di luar jangkauan anon — pakai secret key / SQL Editor):

```sql
delete from public.fingerprint_events
where created_at < now() - interval '30 days';
```

## Error yang pernah terjadi (catatan lapangan)

| Error | Penyebab | Perbaikan |
|---|---|---|
| `409 ... fingerprint_events_device_id_fkey` | device `FP-STANDALONE-01` belum ada | Jalankan `setup.sql` |
| `401` | publishable key salah / policy belum di-apply | Cek key + jalankan `setup.sql` |
| `SENSOR_FAIL 0` di Serial | R503 tidak menjawab (TX/RX tertukar, VCC 5V, baud salah) | Tukar kabel TX↔RX, pastikan 3V3, baud 57600 |
| `ENROLL_FAIL <id> 255` | ID di luar 1–200 atau sensor tidak siap | Pakai slot 1–200, cek `PING` dulu |
