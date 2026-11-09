# PROMPT-AI — template chat AI untuk board **telemetri suhu DHT (ESP32)**

File ini BUKAN dokumentasi teknis. Ini template prompt yang disalin ke chat AI
mana pun (ChatGPT, Claude, Gemini, dsb) supaya teman yang bikin board
**sensor suhu & kelembapan** sendiri langsung dapat kode yang benar tanpa perlu
paham arsitektur proyek dulu.

Khusus board ini: DHT22/DHT11 → tabel `classroom_env` (1 baris per device,
selalu upsert, bukan riwayat event).

## Konsep (baca dulu, 30 detik)

Supabase proyek ini **dipakai bersama, tidak bikin project baru**. Satu project,
banyak board. Teman yang bikin board suhu baru HANYA perlu 2 hal dari pemilik:

1. `SUPABASE_URL` + PUBLISHABLE KEY (diminta lewat chat pribadi — bukan grup).
2. `DEVICE_ID` + `CLASS_ID` yang sudah ada di tabel `devices` / `classes`.

Teman HANYA mengonfigurasi **bagian alatnya**: sensor di pin apa, model sensor
apa, kirim tiap berapa detik. Dia TIDAK membuat project Supabase dan TIDAK
memegang secret key.

Cara pakai: salin blok di bawah garis, ganti placeholder, tempel ke AI, kirim.

---

```
Saya membuat firmware ESP32 (Arduino IDE) untuk sensor suhu & kelembapan DHT.
Firmware membaca sensor tiap 30 detik lalu meng-upsert ke Supabase lewat
HTTPS REST (PostgREST). Bantu saya bikin file .ino lengkap.

=== PIN & HARDWARE ===
- ESP32 DevKit
- Sensor DHT: VCC -> 3V3, GND -> GND, DATA -> GPIO 15
  (resistor pull-up 10k antara VCC-DATA bila modul tidak memilikinya)
- LED onboard ESP32 : GPIO 2 (kedip 1x = kirim sukses)
- Serial Monitor 115200 baud

=== DATA KONFIGURASI (diisi lewat #define di awal kode) ===
1. SUPA_URL      : [minta ke pemilik proyek — URL tanpa trailing slash]
2. SUPA_ANON_KEY : [tulis placeholder <PUBLISHABLE_KEY> — JANGAN kirim key asli ke chat AI]
3. DEVICE_ID     : [contoh: ENV-XII-RPL-1 — harus ada di tabel devices]
4. CLASS_ID      : [contoh: XII-RPL-1 — harus ada di tabel classes]
5. WIFI_SSID & WIFI_PASSWORD : [isi sendiri secara lokal]
6. DHT_MODEL     : DHT22 (atau DHT11 bila modulnya DHT11) — lewat DHT dht(DHT_PIN, DHT_MODEL)

=== PERILAKU SISTEM LENGKAP ===
1. Boot:
   - Serial.begin(115200), pinMode(LED_PIN, OUTPUT), dht.begin(), tls.setInsecure().
   - Kirim "BOOT 1.0dht".
   - Sambung WiFi (timeout 20 dtk).
   - Set lastSend = millis() - SEND_EVERY_MS agar langsung kirim sekali saat nyala.

2. Siklus baca (tiap SEND_EVERY_MS = 30000):
   - hum = dht.readHumidity(), temp = dht.readTemperature().
   - Bila NaN (sensor gagal baca): kirim "[SKIP] sensor gagal baca", JANGAN kirim HTTP.
   - Bila WiFi putus: kirim "[ERR] WiFi putus", JANGAN kirim HTTP.
   - Body: {"device_id":"<DEVICE_ID>","class_id":"<CLASS_ID>","temperature_c":<1 desimal>,"humidity_pct":<1 desimal>}
   - URL: POST /rest/v1/classroom_env?on_conflict=device_id
   - Header: apikey, Authorization Bearer <anon key>, Content-Type application/json,
     Prefer: resolution=merge-duplicates,return=minimal
   - JANGAN kirim kolom updated_at — ada trigger database yang mengisinya
     (ESP32 tanpa NTP tidak tahu jam yang benar).
   - 2xx -> reset failCount, kirim "[OK] <temp>C <hum>%" (1 desimal), kedip LED 1x 150ms.
   - Gagal -> failCount++, kirim "[ERR] HTTP <kode>".
     Bila failCount >= 3: reset counter, WiFi.disconnect(), sambung ulang WiFi
     (recovery koneksi TLS yang basi).

3. Loop utama:
   - Bila belum 30 dtk: delay(500) dan kembali (hemat CPU).
   - Satu iterasi = 1x baca sensor, tidak ada state machine.

=== ATURAN YANG TIDAK BOLEH DILANGGAR ===
- Kode hasilkan dengan #define placeholder (SUPA_URL, SUPA_ANON_KEY) yang saya isi sendiri.
- JANGAN PERNAH pakai SUPABASE_SECRET_KEY di firmware. Hanya publishable key.
  Alasannya: secret key melewati semua aturan RLS dan bisa menghapus seluruh
  database kalau bocor dari chip/flash.
- JANGAN menempelkan SUPABASE_URL / key asli ke chat AI. Pakai placeholder.
- URL PostgREST selalu: SUPABASE_URL + "/rest/v1/" + nama_tabel
- Setiap request WAJIB kirim 2 header:
    apikey: <publishable key>
    Authorization: Bearer <publishable key>
- UPSERT pakai: URL .../rest/v1/classroom_env?on_conflict=device_id
  + Prefer: resolution=merge-duplicates,return=minimal
- JANGAN mengirim updated_at dari firmware (trigger DB yang mengisi).
- Setelah WiFi lama idle, TLS bisa gagal handshake: panggil WiFi.setSleep(false)
  sekali di setup().
- JANGAN pernah bilang "matikan RLS" atau `disable row level security` sebagai
  solusi. RLS tetap ON; yang diperbaiki selalu policy-nya.
- JANGAN hasilkan `DROP TABLE`, `ALTER TABLE ... DROP`, atau perintah hapus apa pun
  terhadap tabel yang sudah ada (`classroom_env` SUDAH ADA).
- JANGAN menyentuh tabel lain (attendance, students, devices selain baris device sendiri).

=== BANTU SAYA HASILKAN ===
1. File .ino lengkap (WiFi + TLS + upsert tiap 30 detik + recovery WiFi).
2. File setup.sql: tipe device env_esp32, INSERT baris device saya,
   policy RLS anon (INSERT + UPDATE classroom_env), trigger touch_updated_at.
   Tabel classroom_env SUDAH ADA — jangan dibuat ulang dari nol.
3. Library: "DHT sensor library" (Adafruit) + dependensinya
   ("Adafruit Unified Sensor") + library bawaan ESP32.
   Catatan: DHT11 dan DHT22 beda presisi; kode harus gampang ganti model lewat #define.
4. Cara verifikasi: query apa di SQL Editor untuk memastikan pembacaan masuk.
5. Contoh JSON body yang BENAR (lihat referensi tabel di bawah — salin persis).
```

---

## Referensi tabel (diverifikasi dari database live, 2026-11-08)

Bagian ini WAJIB disalin juga ke chat AI. Nama kolom salah = HTTP 400
`PGRST204 column not found`. Baris `ENV-XII-RPL-1` di bawah memang ada di live DB.

### `classroom_env` — telemetri suhu & kelembapan (board DHT)

| Kolom | Tipe | Null? | Catatan |
|---|---|---|---|
| `device_id` | text | tidak | **PK** sekaligus FK → `devices.device_id` |
| `class_id` | text | **ya** | FK → `classes.class_id` |
| `temperature_c` | real | **ya** | °C, satu desimal cukup |
| `humidity_pct` | real | **ya** | %, satu desimal |
| `updated_at` | timestamptz | tidak | default `now()`, diisi trigger — **jangan dikirim** |

```json
{"device_id":"ENV-XII-RPL-1","class_id":"XII-RPL-1","temperature_c":29.4,"humidity_pct":61.2}
```
Upsert: `POST /rest/v1/classroom_env?on_conflict=device_id`. Satu baris per device
(histori tidak disimpan — kalau butuh grafik, minta tabel `_events` terpisah ke pemilik).

### `devices` — baris perangkat untuk board ini

| Kolom | Tipe | Null? | Catatan |
|---|---|---|---|
| `device_id` | text | tidak | **PK**, contoh `ENV-XII-RPL-1` |
| `name` | text | tidak | nama tampil |
| `type` | text | tidak | untuk board ini: `'env_esp32'` |
| `class_id` | text | ya | FK → `classes.class_id` |
| `credential_hash` | text | ya | **jangan pernah diisi dari firmware** |
| `status` | text | tidak | default `'offline'` |
| `firmware_version` | text | ya | opsional |
| `last_seen_at` | timestamptz | ya | opsional |
| `last_data_at` | timestamptz | ya | opsional |
| `is_active` | boolean | tidak | default `true` |

```sql
-- Daftarkan tipe dulu (sekali saja, idempoten):
alter table public.devices drop constraint if exists devices_type_check;
alter table public.devices add constraint devices_type_check
  check (type in ('face_computer', 'fingerprint_esp32', 'seat_esp32', 'env_esp32', 'rfid_esp32'));

insert into public.devices (device_id, name, type, class_id, status, is_active)
values ('ENV-XII-RPL-1', 'Sensor DHT Kelas XII RPL 1', 'env_esp32', 'XII-RPL-1', 'online', true)
on conflict (device_id) do update
  set name = excluded.name, type = excluded.type,
      class_id = excluded.class_id, is_active = true;
```

## Dari mana nilai itu diambil

| Nilai | Asal | Keterangan |
|---|---|---|
| `SUPABASE_URL` | `.env.local` → `NEXT_PUBLIC_SUPABASE_URL` | URL proyek, sama untuk semua board |
| PUBLISHABLE KEY | `.env.local` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Key publik, akses dibatasi RLS |
| `DEVICE_ID` | Bersama pemilik, INSERT ke `devices` | **Case-sensitive**, harus persis sama |
| `CLASS_ID` | Tabel `classes`, sudah ada | Harus cocok, kalau tidak upsert ditolak FK |
| Model sensor | Modul masing-masing (DHT22 vs DHT11) | Presisi beda; cukup ganti `#define DHT_MODEL` |
| Pin DATA | GPIO15 default | Boleh beda per board, cukup `#define DHT_PIN` |

Cadangan: kalau `.env.local` tidak ada, publishable key bisa diambil di
Dashboard Supabase → Project Settings → API → **Publishable key**.

## 3 kalimat yang wajib dipahami sebelum flash

1. Firmware cuma boleh pegang **publishable key**. Secret key hanya untuk server.
2. Board ini menimpa **satu baris yang sama** tiap 30 detik — ia menampilkan
   kondisi terkini, BUKAN menyimpan riwayat.
3. `DEVICE_ID` + `CLASS_ID` harus sudah ada di tabel induk SEBELUM board
   mengirim — kalau tidak, upsert ditolak foreign key.
