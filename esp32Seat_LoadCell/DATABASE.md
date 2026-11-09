# Database kursi — struktur & kebijakan (khusus board ini)

Prasyarat: `setup.sql` dijalankan SEKALI di Supabase SQL Editor.
Idempoten — aman dijalankan ulang (kecuali `UPDATE seats` yang hanya
menimpa kursi milik board ini).

## Kenapa dua tabel, bukan satu?

- `seats` = **denah statis** (kursi fisik milik kelas mana). Diisi sekali oleh
  operator, jarang berubah.
- `seat_status` = **telemetri hidup** (status + berat + waktu update). Diubah
  board setiap ada perubahan, tanpa perlu tahu apa-apa soal denah.

Pemisahan ini berarti anon key hanya menyentuh `seat_status` — tidak bisa
mengacak-acak denah kelas.

## Tabel

### `seats` — denah kursi (hanya dibaca board, tidak ditulis)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `seat_id` | text PK | mis. `SEAT-01` — harus cocok dengan `SEAT_ID` di firmware |
| `class_id` | text FK → kelas | kelas pemilik kursi |
| `device_id` | text FK → `devices(device_id)` | pemilik sensor; diisi `setup.sql` §2 |
| `row_no` / `col_no` | int | posisi di denah kelas (baris 1 kolom 1) |
| `is_monitored` | boolean | `false` = abaikan dari agregat dashboard |

Baris live (contoh): `SEAT-01` milik `XII-RPL-1`, `device_id = 'SEAT-ESP-01'`,
baris 1 kolom 1, terpantau.

### `seat_status` — telemetri terakhir per kursi

| Kolom | Tipe | Keterangan |
|---|---|---|
| `seat_id` | text PK FK → `seats(seat_id)` | satu baris per kursi, dioverwrite terus |
| `status` | `'occupied'` / `'empty'` / `'unknown'` | CHECK constraint — nilai lain ditolak 400 |
| `weight_kg` | numeric, **null-able** | berat terakhir (kg); `null` = belum ada pembacaan |
| `updated_at` | timestamptz | **diisi trigger, bukan firmware** (lihat bawah) |

Baris `seat_id` yang belum pernah dikirimi board boleh belum ada (contoh live:
`SEAT-02` ada dengan `status='empty'`, `weight_kg=null`). Dashboard harus
memperlakukan "tidak ada baris" = belum terpantau, bukan kosong.

Satu-satunya pola tulis: **upsert penuh per kursi**:

```http
POST /rest/v1/seat_status?on_conflict=seat_id
Prefer: resolution=merge-duplicates,return=minimal
{"seat_id":"SEAT-01","status":"occupied","weight_kg":24.6}
```

### `devices` — baris milik board ini

| `device_id` | `name` | `type` | `class_id` | `status` |
|---|---|---|---|---|
| `SEAT-ESP-01` | Sensor Kursi Baris A | `seat_esp32` | `XII-RPL-1` | `online` |

`seat_esp32` sudah termasuk `devices_type_check` bawaan, jadi tidak perlu
`ALTER TABLE` tambahan. Wajib ada **sebelum** board mengirim — `seat_status`
memiliki jalur FK tidak langsung (`seat_status → seats → devices`).

## Trigger `seat_status_touch`

Firmware tidak mengirim `updated_at` (ESP32 tanpa NTP tidak tahu jam yang
benar). Trigger `BEFORE INSERT OR UPDATE` mengisi `new.updated_at = now()`
dari jam server setiap upsert. Artinya `updated_at` selalu bisa dipercaya
sebagai "terakhir board melapor" — dashboard memakai kolom ini untuk
penanda stale (mis. tidak bergerak > 2× `HEARTBEAT_MS` = board mati).

## RLS (Row Level Security)

| Policy | Tabel | Akses |
|---|---|---|
| `seatstatus_write` | `seat_status` | INSERT untuk anon |
| `seatstatus_update` | `seat_status` | UPDATE untuk anon |

Terbukti di live DB: anon INSERT/UPDATE/SELECT semua `2xx`. Perhatikan anon
juga bisa SELECT (dibutuhkan dashboard realtime publik) — tapi tidak bisa
DELETE, dan tidak bisa menyentuh `seats`/`devices`.

## Realtime website

Perubahan `seat_status` dibaca dashboard lewat REST polling dan/atau
`postgres_changes` (publikasi `supabase_realtime`). `seats` tidak perlu
realtime (denah jarang berubah).

## Query operasional

Status semua kursi satu kelas beserta denahnya:

```sql
select s.row_no, s.col_no, s.seat_id,
       st.status, st.weight_kg, st.updated_at
from public.seats s
left join public.seat_status st on st.seat_id = s.seat_id
where s.class_id = 'XII-RPL-1' and s.is_monitored
order by s.row_no, s.col_no;
```

Kursi yang boardnya mati (tidak melapor > 2 menit):

```sql
select s.seat_id, st.status, st.updated_at
from public.seats s
left join public.seat_status st on st.seat_id = s.seat_id
where s.class_id = 'XII-RPL-1' and s.is_monitored
  and (st.updated_at is null or st.updated_at < now() - interval '2 minutes');
```

## Error yang pernah terjadi (catatan lapangan)

| Error | Penyebab | Perbaikan |
|---|---|---|
| `403` | policy `seatstatus_write/update` belum ada | Jalankan `setup.sql` §4 |
| `409 ... fkey` | `SEAT_ID` tidak ada di `seats` / device belum terdaftar | Jalankan `setup.sql` §1–§2, samakan `SEAT_ID` |
| `400 ... check` | `status` di luar `occupied/empty/unknown` | Jangan tambah status baru tanpa ubah constraint |
