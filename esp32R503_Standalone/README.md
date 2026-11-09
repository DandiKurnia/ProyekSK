# ESP32 + R503 — sensor sidik jari mandiri

Board ini mandiri: jari menempel → verifikasi 1:N di memori flash R503 →
catat event ke Supabase (`fingerprint_events`).
**Event di sini bukan absensi resmi.** Absensi resmi tetap lewat pipeline 2FA
(face-service lokal + R503 via USB Serial → `POST /api/attendance`).
Tabel ini berfungsi sebagai audit/display log dan mode mandiri tanpa PC.

Lihat juga:
- [DATABASE.md](DATABASE.md) — skema tabel, policy, query operasional.
- [PROMPT-AI.md](PROMPT-AI.md) — template prompt chat AI untuk membuat firmware R503 baru.

## Isi folder

| File | Fungsi |
|---|---|
| `esp32R503_Standalone.ino` | Firmware (ESP32 + R503 + HTTPS Supabase) |
| `setup.sql` | Skema tabel `fingerprint_events`, policy RLS anon, dan baris device `FP-STANDALONE-01` |
| `DATABASE.md` | Penjelasan struktur tabel, alasan desain, dan contoh query |
| `PROMPT-AI.md` | Template prompt chat AI untuk membuat firmware R503 baru |

## Pengkabelan

R503 diberi daya **3.3V saja**. Jangan hubungkan ke 5V.

| R503 | ESP32 | Keterangan |
|---|---|---|
| VCC (kabel merah) | 3V3 | Daya sensor 3.3V |
| GND (kabel hitam) | GND | Ground bersama |
| TX (kabel kuning) | GPIO 16 | Serial2 RX pada ESP32 |
| RX (kabel putih)  | GPIO 17 | Serial2 TX pada ESP32 |
| WAKE / WAK (kabel biru) | GPIO 4 | Deteksi sentuh (opsional) |
| 3.3V sensing (kabel hijau) | 3V3 / tidak dipakai | VCC ring LED |
| LED onboard ESP32 | GPIO 2 | Indikator status (HIGH = aktif) |
| Buzzer pasif (I/O) | GPIO 25 | Bip 120ms hanya saat event 2xx terkirim ke Supabase |
| Buzzer pasif (VCC / GND) | 3V3 atau 5V / GND | Ikut modul buzzer; I/O tetap 3.3V |

Pin sensor dapat diubah di 4 baris `#define` pada bagian atas file:
`RX_PIN 16`, `TX_PIN 17`, `WAKEUP_PIN 4`, `BUZZER_PIN 25`. Baud sensor: **57600**.

**Kenapa GPIO 25?** Bebas dari bus yang dipakai (UART2 16/17, tidak memakai SPI),
bukan strapping pin (12/15 aman tidak tersentuh), dan mendukung PWM sehingga
`tone()` bisa membangkitkan frekuensi untuk buzzer **pasif**. Buzzer aktif (2 kaki
polar) juga bisa memakai pin ini, tetapi ganti `tone()` menjadi `digitalWrite()`.

## Library Arduino IDE yang dibutuhkan

- **Adafruit Fingerprint Sensor Library** (Adafruit) — satu-satunya library eksternal.

## Konfigurasi (5 baris di atas file)

```cpp
#define WIFI_SSID     "nama-wifi"
#define WIFI_PASSWORD "password-wifi"
#define SUPA_URL      "https://xxxx.supabase.co"   // tanpa / di akhir
#define SUPA_ANON_KEY "sb_publishable_..."          // publishable key, BUKAN secret
#define DEVICE_ID     "FP-STANDALONE-01"           // samakan dengan setup.sql
```

`SUPA_URL` + `SUPA_ANON_KEY` sama dengan nilai di repo: `NEXT_PUBLIC_SUPABASE_URL`
dan `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` pada `.env.local`.
Ambil yang publishable — **jangan pernah menanam secret key di firmware**
(secret key melewati RLS dan bisa menghapus data bila bocor).

## Cara pakai pertama kali

1. Jalankan `setup.sql` di Supabase SQL Editor (aman diulang, semua idempoten).
2. Isi 5 baris konfigurasi di `esp32R503_Standalone.ino`, lalu flash ke ESP32.
3. Buka Serial Monitor (baud **115200**, `New Line` / `NL & CR`).
4. Tunggu log `READY <jumlah_template>`.
5. Daftarkan jari: kirim `ENROLL 1` (atau ketik `e` lalu ikuti instruksi).
6. Tempelkan jari ke sensor saat LED ring berkedip biru/ungu.

## Perintah Serial Monitor (115200)

Protokol ini kompatibel 100% dengan modul USB Serial kelas (`face-service`):

| Perintah | Hasil | Keterangan |
|---|---|---|
| `PING` atau `m` | `PONG <jumlah>` | Cek koneksi dan jumlah sidik jari terdaftar |
| `ENROLL <id>` | `ENROLLING <id>` → `PLACE` → `REMOVE` → `PLACE` → `ENROLL_OK <id> 0` | Daftarkan jari ke slot 1–200 (2x tempel) |
| `e` | Dialog: "Masukkan ID (1-200):" | Mode interaktif daftar jari |
| `<angka>` (mis. `6`) | `ENROLLING 6` | Shortcut enroll bila menekan angka langsung |
| `DELETE <id>` atau `d <id>` | `DELETE_OK <id> 0` | Hapus template slot tertentu |
| `CLEAR` atau `c` | `CLEAR_OK 0` | Kosongkan seluruh memori R503 |
| `LED_OK` | Tes ring ungu menyala 700ms → `LED_DONE` | Uji fungsi LED sensor |

## Arti log

```
BOOT 1.0fp                    Firmware mulai berjalan
READY 4                       Sensor terdeteksi, ada 4 template di flash R503
SENSOR_FAIL 0                 R503 tidak merespon / kabel TX-RX terbalik
MATCH 1 95                    Jari cocok di slot 1 (confidence 95)
NOMATCH                       Jari tidak dikenali di flash R503
[KIRIM] match slot=1 conf=95  Event berhasil dikirim ke Supabase
[KIRIM] no_match slot=-1 conf=0  Event tidak cocok berhasil dikirim ke Supabase
[ERR] HTTP 401                Publishable key salah atau policy RLS belum di-apply
[ERR] HTTP 409 ... fkey       Device belum ada: setup.sql belum jalan
[ERR] WiFi belum tersambung   WiFi putus, event dilewati (tidak diblokir)
```

## Warna ring LED R503

- **Biru bernapas (breathing)**: Siap / menunggu jari ditempel saat enroll.
- **Ungu menyala (ON)**: Verifikasi sukses (`MATCH`), LED kedip 400ms.
- **Merah berkedip 3x (flashing)**: Verifikasi gagal (`NOMATCH`) atau enroll gagal.
- **Mati**: Kondisi standby normal saat menunggu sentuhan.

## Batas yang disengaja

- `fingerprint_events` hanya log mentah (audit/display). Ia **tidak mengubah tabel attendance**.
- Relasi antara `slot_id` dengan siswa (`students.fingerprint_slot`) dipetakan
  di backend / website, bukan di dalam firmware.
- Retry HTTP dibatasi maks 3x dan **hanya untuk error jaringan/timeout**. Error 4xx
  (format ditolak) tidak pernah diulang.
