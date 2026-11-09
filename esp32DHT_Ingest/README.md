# ESP32 + DHT — telemetri suhu & kelembaban ruang

Board ini membaca sensor suhu/kelembaban (DHT22 atau DHT11) tiap 30 detik
lalu melakukan **upsert satu baris** langsung ke Supabase (`classroom_env`).
Data ini murni telemetri lingkungan — **bukan absensi siswa**. Tujuannya
memberi dashboard konteks kenyamanan ruang (mis. suhu terlalu panas atau AC mati).

Lihat juga:
- [DATABASE.md](DATABASE.md) — skema tabel, policy, trigger, query operasional.
- [PROMPT-AI.md](PROMPT-AI.md) — template prompt chat AI untuk membuat firmware sensor lingkungan baru.

## Isi folder

| File | Fungsi |
|---|---|
| `esp32DHT_Ingest.ino` | Firmware (ESP32 + DHT + HTTPS Supabase) |
| `setup.sql` | Perluas constraint `devices`, baris device `ENV-XII-RPL-1`, policy RLS `classroom_env`, dan trigger `touch_updated_at` |
| `DATABASE.md` | Penjelasan struktur tabel, alasan desain, dan contoh query |
| `PROMPT-AI.md` | Template prompt chat AI untuk membuat firmware lingkungan baru |

## Pengkabelan

Sensor DHT diberi daya **3.3V**. Jangan hubungkan ke 5V.

| Sensor DHT | ESP32 | Keterangan |
|---|---|---|
| VCC / + (pin 1) | 3V3 | Daya modul (bukan 5V) |
| DATA / out (pin 2) | GPIO 15 | Sinyal data satu kabel |
| NC (pin 3, tipe 4 pin) | Tidak disambung | Hanya ada di kemasan DHT22 4-pin |
| GND / - (pin 4) | GND | Ground bersama |
| LED onboard | GPIO 2 | Indikator status (HIGH = aktif) |

> Bila memakai modul DHT 3 pin (sudah di PCB kecil), biasanya sudah ada resistor
> pull-up internal 10kΩ. Bila memakai komponen DHT22 mentah 4 pin, pasang resistor
> pull-up 10kΩ antara VCC dan pin DATA.

Pin sensor dapat diubah di `#define DHT_PIN 15`. Model sensor diatur via
`#define DHT_MODEL DHT22` (ganti jadi `DHT11` bila modulmu biru).

## Library Arduino IDE yang dibutuhkan

- **DHT sensor library** (oleh Adafruit)
- **Adafruit Unified Sensor** (dependensi otomatis dari library di atas)

## Konfigurasi (6 baris di atas file)

```cpp
#define WIFI_SSID     "nama-wifi"
#define WIFI_PASSWORD "password-wifi"
#define SUPA_URL      "https://xxxx.supabase.co"   // tanpa / di akhir
#define SUPA_ANON_KEY "sb_publishable_..."          // publishable key, BUKAN secret
#define DEVICE_ID     "ENV-XII-RPL-1"              // samakan dengan setup.sql
#define CLASS_ID      "XII-RPL-1"                  // samakan dengan setup.sql
```

`SUPA_URL` + `SUPA_ANON_KEY` sama dengan nilai di repo: `NEXT_PUBLIC_SUPABASE_URL`
dan `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` pada `.env.local`.
Ambil yang publishable — **jangan pernah menanam secret key di firmware**
(secret key melewati RLS dan bisa menghapus data bila bocor).

`DEVICE_ID` dan `CLASS_ID` **wajib sudah ada di database** (didaftarkan oleh
`setup.sql` atau tabel `classes`), karena `classroom_env` memiliki foreign key
ke keduanya.

## Cara pakai pertama kali

1. Jalankan `setup.sql` di Supabase SQL Editor (aman diulang, semua idempoten).
2. Isi 6 baris konfigurasi di `esp32DHT_Ingest.ino`, lalu flash ke ESP32.
3. Buka Serial Monitor (baud **115200**).
4. Firmware mengirim pembacaan pertama saat booting (tidak perlu menunggu 30 detik).
5. Pembacaan berikutnya dikirim berkala tiap 30 detik (`SEND_EVERY_MS 30000UL`).

## Arti log

```
BOOT 1.0dht                 Firmware mulai berjalan
WiFi ... OK                 WiFi terhubung
[OK] 26.5C 62.0%            Data terkirim ke Supabase, LED onboard kedip 1x
[SKIP] sensor gagal baca    DHT membaca NaN — kabel kendor / resistor pull-up hilang
[ERR] WiFi putus            WiFi mati, pengiriman dilewati
[ERR] HTTP 400              class_id null atau tidak valid
[ERR] HTTP 403              Policy RLS classroom_env belum di-apply: jalankan setup.sql
[ERR] HTTP 409 ... fkey     DEVICE_ID atau CLASS_ID belum ada di tabel induk
```

Jika terjadi error HTTP berulang 3× berturut-turut, firmware otomatis
memutus WiFi (`WiFi.disconnect()`) dan mencoba reconnect dari awal.

## LED onboard (GPIO2)

- **Kedip 1× 150ms**: Data berhasil diterima Supabase (respon HTTP `2xx`).
- **Mati**: Standby normal selama interval 30 detik.

## Batas yang disengaja

- `classroom_env` **hanya menyimpan satu baris kondisi terkini per device**
  (upsert `on_conflict=device_id`). Firmware **bukan** penyimpan riwayat menit ke menit.
- Payload sengaja **tidak membawa timestamp `updated_at`** — trigger DB
  `classroom_env_touch` mengisi waktu dari jam server Supabase karena ESP32
  tanpa NTP tidak memiliki jam yang akurat.
- Pelaporan diskip bila pembacaan menghasilkan `isnan()` agar server tidak
  pernah menerima data `null` atau merusak nilai sebelumnya.
