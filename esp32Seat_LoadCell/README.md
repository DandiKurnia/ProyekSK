# ESP32 + HX711 — sensor okupansi kursi

Board ini mengukur berat di atas kursi lewat load cell + HX711, menahan
state machine hysteresis di firmware, lalu meng-upsert status ke Supabase
(`seat_status`). **Status kursi bukan absensi siswa.** Okupansi hanya telemetri
sensor — siswa yang hadir tetap dicatat lewat pipeline 2FA
(face-service lokal → `POST /api/attendance`).

Lihat juga:
- [DATABASE.md](DATABASE.md) — skema tabel, policy, trigger, query operasional.
- [PROMPT-AI.md](PROMPT-AI.md) — template prompt chat AI untuk membuat firmware kursi baru.

## Isi folder

| File | Fungsi |
|---|---|
| `esp32Seat_LoadCell.ino` | Firmware (ESP32 + HX711 + UPSERT Supabase) |
| `setup.sql` | Device `SEAT-ESP-01` + trigger `touch_updated_at` + policy RLS seat_status |
| `DATABASE.md` | Penjelasan struktur tabel, alasan desain, dan contoh query |
| `PROMPT-AI.md` | Template prompt chat AI untuk membuat firmware kursi baru |

## Pengkabelan

HX711 diberi daya **3.3V**.

| HX711 | ESP32 | Keterangan |
|---|---|---|
| VCC | 3V3 | Daya modul |
| GND | GND | Ground bersama |
| DT / DOUT | GPIO 19 | Pin data digital |
| SCK / CLK | GPIO 18 | Pin clock serial |
| E+ / E- | Kabel Merah / Hitam | Eksitasi load cell |
| A+ / A- | Kabel Hijau / Putih | Sinyal diferensial load cell |

Pin HX711 dapat diubah di 2 `#define`: `HX711_DOUT_PIN 19`, `HX711_SCK_PIN 18`.

Kalibrasi beban dilakukan offline di sketsa [`../load_cell/`](../load_cell/):
cari `CALIBRATION_FACTOR` dulu, baru masukkan ke file `.ino` ini.

## Library Arduino IDE yang dibutuhkan

- **HX711 Arduino Library** (oleh bogde) — satu-satunya library eksternal.

## Konfigurasi (5 baris di atas file)

```cpp
#define WIFI_SSID     "nama-wifi"
#define WIFI_PASSWORD "password-wifi"
#define SUPA_URL      "https://xxxx.supabase.co"   // tanpa / di akhir
#define SUPA_ANON_KEY "sb_publishable_..."          // publishable key, BUKAN secret
#define SEAT_ID       "SEAT-01"                     // harus ada di tabel seats
```

`SUPA_URL` + `SUPA_ANON_KEY` sama dengan nilai di repo: `NEXT_PUBLIC_SUPABASE_URL`
dan `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` pada `.env.local`.
Ambil yang publishable — **jangan pernah menanam secret key di firmware**
(secret key melewati RLS dan bisa menghapus data bila bocor).

## Cara pakai pertama kali

1. Pastikan sketsa kalibrasi [`../load_cell/`](../load_cell/) sudah menghasilkan
   `CALIBRATION_FACTOR` yang benar untuk load cell ini.
2. Jalankan `setup.sql` di Supabase SQL Editor (aman diulang, semua idempoten).
3. Isi 5 baris konfigurasi + `CALIBRATION_FACTOR`, flash ke ESP32.
4. Buka Serial Monitor (baud **115200**).
5. Pastikan kursi **kosong** saat nyala — firmware melakukan `tare(20)` otomatis.
6. Tunggu `"Tare selesai. Kirim pertama saat status stabil."`

## Ambang dan timing (boleh diubah)

```cpp
#define CALIBRATION_FACTOR 1109.4f  // dari kalibrasi load_cell/
#define ZERO_DEADBAND_G 3.0f        // |gram| <= 3 dianggap 0
#define OCCUPIED_THRESHOLD_G 20.0f  // >= 20 g stabil 1 dtk = terisi
#define EMPTY_THRESHOLD_G    10.0f  // <= 10 g mulai timer kosong
#define RECOVERY_THRESHOLD_G 15.0f  // >= 15 g batalkan timer kosong
#define OCCUPIED_CONFIRM_MS 1000UL
#define ABSENCE_DELAY_MS    5000UL
#define HEARTBEAT_MS        60000UL // kirim ulang status tiap 60 dtk
```

## Arti log

```
BOOT 1.0seat
Tare selesai. Kirim pertama saat status stabil.
[KIRIM] occupied 24.6 g    status berubah → upsert ke Supabase
[KIRIM] empty 1.2 g        kursi kosong setelah timer 5 dtk habis
[ERR] HTTP 403             policy RLS seat_status belum jalan: jalankan setup.sql
[ERR] HTTP 409 ... fkey    SEAT_ID tidak ada di tabel seats
[ERR] WiFi putus            WiFi mati, pembacaan dilewati (tidak diblokir)
[SKIP] HX711 nilai invalid  pembacaan NaN/Inf — tidak dikirim (JSON tetap valid)
HX711 belum terbaca. Periksa VCC, GND, DT/DOUT, SCK/CLK.
```

## LED onboard (GPIO2)

Kedip 1× 150ms = kirim sukses (`2xx`). Sunyi = tidak ada perubahan status
(hanya heartbeat tiap 60 dtk yang berkedip).

## Batas yang disengaja

- Anon key hanya bisa INSERT/UPDATE `seat_status` (dua policy terpisah). Tidak
  bisa menghapus, tidak bisa membaca/menulis tabel lain.
- Payload tidak membawa `updated_at` — trigger `seat_status_touch` mengisi
  dari jam server, karena ESP32 tanpa NTP tidak tahu jam yang benar.
- Kirim hanya saat status berubah atau heartbeat 60 dtk — hemat baterai/data,
  dan dashboard tetap tahu board hidup lewat `updated_at` yang bergerak.
- `EMPTY_PENDING` (timer berjalan) tetap dilaporkan `occupied` ke server.
  Timer 5 dtk adalah urusan firmware, bukan kolom database.
