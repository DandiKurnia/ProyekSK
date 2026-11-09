# Database DHT — struktur & kebijakan (khusus board ini)

Prasyarat: `setup.sql` dijalankan SEKALI di Supabase SQL Editor.
Idempoten — aman dijalankan ulang (`drop constraint if exists`, `drop policy if exists`, `on conflict do update`).

## Kenapa upsert satu baris, bukan tabel riwayat?

Kebutuhan dashboard adalah **"kondisi ruang saat ini"** untuk badge suhu &
kelembaban, bukan grafik menit-ke-menit. Satu baris per device membuat baca
paling murah: `select * where device_id = ...` tanpa `order by limit 1`.
Konsekuensi: riwayat fluktuasi suhu **tidak tersimpan**. Bila nanti grafik
tren diminta, buat tabel baru (mis. `classroom_env_log`) — jangan ubah pola ini.

## Tabel

### `classroom_env` — kondisi terkini per device

| Kolom | Tipe | Keterangan |
|---|---|---|
| `device_id` | text PK FK → `devices(device_id)` | `ENV-XII-RPL-1` harus ada; kalau tidak upsert ditolak 409 |
| `class_id` | text NOT NULL FK → `classes` | kelas lokasi sensor — **wajib dikirim firmware** (POST 400 bila null) |
| `temperature_c` | numeric | suhu °C, satu desimal (contoh: `26.1`) |
| `humidity_pct` | numeric | kelembaban %RH (contoh: `60.0`) |
| `updated_at` | timestamptz | **diisi trigger, bukan firmware** (lihat bawah) |

Satu-satunya pola tulis — upsert penuh per device:

```http
POST /rest/v1/classroom_env?on_conflict=device_id
Prefer: resolution=merge-duplicates,return=minimal
{"device_id":"ENV-XII-RPL-1","class_id":"XII-RPL-1","temperature_c":26.1,"humidity_pct":60.0}
```

Terbukti di live DB (2026-11-08): anon upsert tanpa `class_id` → `400`
(`23502` not-null violation); dengan `class_id` → `201` dan baris terisi.
Jangan coba "menghemat kolom" — `class_id` wajib.

### `devices` — baris milik board ini

| `device_id` | `name` | `type` | `class_id` | `status` |
|---|---|---|---|---|
| `ENV-XII-RPL-1` | Sensor DHT Kelas XII RPL 1 | `env_esp32` | `XII-RPL-1` | `online` |

Setup §1 memperluas `devices_type_check` dengan `'env_esp32'` (dan tetap
mempertahankan `face_computer`, `fingerprint_esp32`, `seat_esp32` yang sudah
ada). Tanpa ini INSERT device gagal `23514`.

## Trigger `touch_updated_at`

Payload firmware tidak membawa waktu (ESP32 tanpa NTP tidak tahu jam yang
benar). Trigger `BEFORE INSERT OR UPDATE` mengisi `new.updated_at = now()`
dari jam server setiap upsert. Dashboard memakai kolom ini sebagai heartbeat:
`updated_at` yang tidak bergerak > 2× `SEND_EVERY_MS` (±1 menit) = board mati.

## RLS (Row Level Security)

| Policy | Tabel | Akses |
|---|---|---|
| `env_insert` | `classroom_env` | INSERT untuk anon |
| `env_update` | `classroom_env` | UPDATE untuk anon |

Terbukti di live DB: anon INSERT/UPDATE/SELECT semua `2xx`. Anon bisa SELECT
(dibutuhkan badge suhu publik) — tapi tidak bisa DELETE dan tidak menyentuh
tabel lain.

## Realtime website

Perubahan `classroom_env` diterima dashboard lewat `postgres_changes` tanpa
refresh — sudah terdaftar di publikasi `supabase_realtime` di live DB
(diverifikasi via `phx_join` langsung, balas `status: ok`).

## Query operasional

Kondisi seluruh kelas beserta stalenya:

```sql
select c.class_id, e.temperature_c, e.humidity_pct, e.updated_at,
       (e.updated_at < now() - interval '2 minutes') as stale
from public.classroom_env e
right join public.classes c on c.class_id = e.class_id
order by c.class_id;
```

## Error yang pernah terjadi (catatan lapangan)

| Error | Penyebab | Perbaikan |
|---|---|---|
| `400 ... class_id ... not-null` | payload tanpa `class_id` | Selalu kirim `device_id` + `class_id` (firmware sudah benar) |
| `403` | policy `env_insert/env_update` belum ada | Jalankan `setup.sql` |
| `409 ... classroom_env_device_id_fkey` | device/class belum terdaftar | Jalankan `setup.sql` §2 (device), pastikan `classes` memuat `class_id` |
| `[SKIP] sensor gagal baca` di Serial | DHT membaca NaN (kabel kendor / tanpa pull-up 10kΩ) | Cek wiring; modul PCB 3-pin sudah punya pull-up internal |
