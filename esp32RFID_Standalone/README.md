# ESP32 RC522 RFID — pembaca kartu mandiri

Board ini RFID-only: tap kartu → cek UID di Supabase → catat event.
**Tap kartu di sini bukan absensi.** Absensi resmi tetap lewat pipeline 2FA
(face-service + sketch R503 mandiri). File ini hanya log/display.


Lihat juga:
- [DATABASE.md](DATABASE.md) — struktur tabel, policy, cara isi massal.
- [PROMPT-AI.md](PROMPT-AI.md) — template prompt untuk board RFID ESP32 (RC522) lain.

## Isi folder

| File | Fungsi |
|---|---|
| `esp32RFID_Standalone.ino` | Firmware (RC522 saja, tanpa R503) |
| `setup.sql` | Skema + policy + device `EDGE-01` — jalankan SEKALI di SQL Editor |
| `DATABASE.md` | Tabel, RLS, alasan desain, contoh query |
| `PROMPT-AI.md` | Template prompt chat untuk board RFID ESP32 (RC522) lain |

## Pengkabelan

RC522 **3.3V saja**. Jangan hubungkan ke 5V.

| RC522 | ESP32 | Keterangan |
|---|---|---|
| SDA (SS) | GPIO5 | chip select |
| SCK | GPIO18 | clock SPI |
| MOSI | GPIO23 | data keluar |
| MISO | GPIO19 | data masuk |
| RST | GPIO22 | reset |
| 3V3 | 3V3 | **bukan 5V** |
| GND | GND | |
| Buzzer pasif (I/O) | GPIO 25 | Bip 120ms hanya saat event 2xx terkirim ke Supabase |
| Buzzer pasif (VCC / GND) | 3V3 atau 5V / GND | Ikut modul buzzer; I/O tetap 3.3V |

Ubah pin sensor cukup di 5 baris `#define RC522_*` di atas file, serta `#define BUZZER_PIN 25`.

**Kenapa GPIO 25?** Bebas dari bus SPI RC522 (GPIO 5, 18, 19, 22, 23), bukan
strapping pin, dan mendukung PWM sehingga `tone()` bisa membangkitkan nada untuk buzzer **pasif**.

> Catatan: GPIO5 itu strapping pin (harus HIGH saat boot). Sebagai SS aman
> karena RC522 tidak menariknya LOW. Kalau board gagal boot, pindah SS ke GPIO21.

## Library Arduino IDE yang dibutuhkan

- **MFRC522** (GithubCommunity) — satu-satunya library. Tidak butuh library fingerprint.

## Konfigurasi (5 baris di atas file)

```cpp
#define WIFI_SSID     "nama-wifi"
#define WIFI_PASSWORD "password-wifi"
#define SUPA_URL      "https://xxxx.supabase.co"   // tanpa / di akhir
#define SUPA_ANON_KEY "sb_publishable_..."          // publishable key, BUKAN secret
#define DEVICE_ID     "EDGE-01"                     // samakan dengan setup.sql
```

`SUPA_URL` + `SUPA_ANON_KEY` sama dengan nilai di repo: `NEXT_PUBLIC_SUPABASE_URL`
dan `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` pada `.env.local`.
Ambil yang publishable — **jangan pernah menanam secret key di firmware**
(secret key melewati RLS dan bisa menghapus data bila bocor).

## Cara pakai pertama kali

1. Jalankan `setup.sql` di Supabase SQL Editor (aman diulang, semua idempoten).
2. Isi 5 baris config, flash ke ESP32 (baud Serial Monitor 115200).
3. Daftarkan kartu: `CARD 40123292` → tunggu `TAP_CARD` → tempel kartu → `CARD_OK`.

## Perintah Serial Monitor (115200)

| Perintah | Hasil |
|---|---|
| `CARD <student_id>` | Buka jendela 15 dtk → tempel kartu → `CARD_OK <uid> <student_id>` |
| `r` | Sama, tapi tanya `student_id` dulu secara interaktif |
| `PING` | Balas `PONG rfid` |
| `LED_OK` | Tes LED onboard → `LED_DONE` |

## Arti log

```
RFID A3:1F:22:04        UID terbaca (selalu dicetak, UID apa pun)
KNOWN A3:1F:22:04      UID terdaftar → LED kedip 1x + bip buzzer, event 'known' terkirim
UNKNOWN A3:1F:22:04    Kartu asing → LED kedip 2x + bip buzzer, event 'unknown' terkirim
OFFLINE A3:1F:22:04    WiFi mati → TIDAK dicatat (bukan dianggap unknown)
CARD_OK A3:1F:22:04 S001      Pendaftaran berhasil
CARD_FAIL ... (cek student_id...)   student_id tidak ada di tabel students
CARD_TIMEOUT           Tidak ada kartu ditempel dalam 15 dtk
[ERR] HTTP 409 ... rfid_events_device_id_fkey   Device belum ada: setup.sql belum jalan
[ERR] HTTP 409 ... rfid_cards ... students      student_id salah / belum ada
```

Jendela `TAP_CARD` hanya 15 detik: tempel kartu **setelah** `TAP_CARD` muncul,
jangan sebelum. LED onboard menyala terus = jendela masih buka.

## LED onboard (GPIO2)

Satu LED, arti lewat pola: kedip 1× = sukses/terdaftar, kedip 2× = gagal/asing,
menyala terus = menunggu kartu (mode daftar). Warna tidak bisa dibedakan.
`ponytail:` bila tim butuh warna, tambah LED RGB eksternal di 3 pin bebas.

## Batas yang disengaja

- Anon key boleh INSERT/UPDATE `rfid_cards` agar perintah `CARD` bisa jalan
  dari Serial. Risiko: siapa pun yang pegang key bisa mengikat kartu ke siswa
  mana pun (tidak bisa membaca/merusak tabel lain). Cabut policy ini saat fitur
  "Daftarkan Kartu" sudah pindah ke website di balik login admin (lihat DATABASE.md).
