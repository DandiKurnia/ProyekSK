# PROMPT-AI — template chat AI untuk board **RFID ESP32 (RC522)**

File ini BUKAN dokumentasi teknis. Ini template prompt yang disalin ke chat AI
mana pun (ChatGPT, Claude, Gemini, dsb) supaya teman yang bikin board **pembaca
kartu RFID** sendiri langsung dapat kode yang benar tanpa perlu paham
arsitektur proyek dulu.

Khusus board ini: RC522 + `rfid_cards` + `rfid_events`. Untuk board lain
(R503, kursi, DHT) template terpisah akan dibuat menyusul.

Dokumentasi pemasangan & arti log: [README.md](README.md).
Struktur tabel lengkap: [DATABASE.md](DATABASE.md).

## Konsep (baca dulu, 30 detik)

Supabase proyek ini **dipakai bersama, tidak bikin project baru**. Satu project,
banyak board. Teman yang bikin board RFID baru HANYA perlu 2 hal dari pemilik:

1. `SUPABASE_URL` + PUBLISHABLE KEY (diminta lewat chat pribadi — bukan grup).
2. `DEVICE_ID` unik untuk boardnya (disepakati dengan pemilik, dicatat di tabel `devices`).

Teman HANYA mengonfigurasi **bagian alatnya**: RC522 di pin apa, DEVICE_ID apa.
Dia TIDAK membuat project Supabase, TIDAK memegang secret key, dan TIDAK
mengubah tabel milik board lain.

Cara pakai: salin blok di bawah garis, ganti placeholder, tempel ke AI, kirim.

---

```
Saya membuat firmware ESP32 (Arduino IDE) untuk pembaca kartu RFID RC522.
Firmware mengirim event tap ke Supabase lewat HTTPS REST (PostgREST).
Bantu saya bikin file .ino lengkap yang perilakunya sama dengan arsitektur ini.

=== PIN & HARDWARE ===
- ESP32 DevKit V1 (30 atau 38 pin)
- Modul RFID RC522 via SPI (3.3V SAJA, jangan 5V):
    SDA / SS   : GPIO 5
    SCK        : GPIO 18
    MOSI       : GPIO 23
    MISO       : GPIO 19
    RST        : GPIO 22
    3.3V & GND : hubungkan ke 3V3 & GND ESP32
- LED onboard  : GPIO 2 (LED biru/indikator)
- Buzzer PASIF (modul 3 pin: VCC, GND, I/O): I/O -> GPIO 25, VCC -> 3V3/5V, GND -> GND
  Bunyi hanya saat event 2xx terkirim ke Supabase: tone(BUZZER_PIN, 2000, 120), non-blocking.
  pinMode(BUZZER_PIN, OUTPUT) di setup. Jangan pakai digitalWrite: buzzer pasif butuh PWM.
- Serial       : 115200 baud

=== DATA KONFIGURASI (diisi lewat #define di awal kode) ===
1. SUPA_URL      : [minta ke pemilik proyek — URL tanpa trailing slash]
2. SUPA_ANON_KEY : [tulis placeholder <PUBLISHABLE_KEY> — JANGAN kirim key asli ke chat AI]
3. DEVICE_ID     : [contoh: EDGE-01 — harus ada di tabel devices]
4. WIFI_SSID & WIFI_PASSWORD : [isi sendiri secara lokal]

=== PERILAKU SISTEM LENGKAP ===
1. Boot:
   - Serial.begin(115200), pinMode(LED_PIN, OUTPUT), pinMode(BUZZER_PIN, OUTPUT).
   - Kirim baris: "BOOT 1.0rfid".
   - SPI.begin(18, 19, 23, 5), rfid.PCD_Init(), rfid.PCD_DumpVersionToSerial().
   - Kirim baris: "READY".
   - Pastikan WiFi tersambung (timeout 20 dtk).
   - Panggil WiFi.setSleep(false) sekali di setup (cegah TLS idle handshake drop).

2. Tap Kartu (debounce 2000 ms per UID sama agar kartu ditahan tidak spam):
   - Saat kartu terdeteksi, baca UID dan format jadi hex huruf besar dipisah titik dua ("A3:1F:22:04").
   - Segera kirim baris ke Serial: "RFID <UID>".
   - Cek ke Supabase: GET /rest/v1/rfid_cards?select=uid&uid=eq.<UID>&limit=1
     - Bila HTTP 200 dan respon bukan "[]":
       Kirim "KNOWN <UID>", LED hijau (kedip 1x 150ms), lalu POST ke /rest/v1/rfid_events:
       {"device_id":"<DEVICE_ID>","uid":"<UID>","status":"known"}
       Bila POST sukses (2xx): kirim "[KIRIM] known uid=<UID>", bip buzzer 2000Hz 120ms (bipOk), dan kedip LED 1x.
     - Bila HTTP 200 dan respon "[]":
       Kirim "UNKNOWN <UID>", LED merah (kedip 2x), lalu POST status "unknown":
       {"device_id":"<DEVICE_ID>","uid":"<UID>","status":"unknown"}
       Bila POST sukses: kirim "[KIRIM] unknown uid=<UID>", bip buzzer 2000Hz 120ms (bipOk), dan kedip LED 1x.
     - Bila jaringan gagal (timeout/bukan 200):
       Kirim "OFFLINE <UID>", LED kedip 2x, JANGAN kirim event apa pun (jangan catat 'unknown' palsu).

3. Pendaftaran Kartu lewat Serial Monitor:
   - Perintah "CARD <student_id>" atau "R <student_id>" (validasi: huruf/angka/-/_ saja, maks 32 char).
   - Mode cepat: ketik "r" lalu Enter -> firmware membalas "Masukkan student_id (contoh: 40123292 atau S001):",
     lalu baca baris berikutnya sebagai student_id.
   - Kirim "TAP_CARD <student_id>", LED onboard HIGH terus (menandakan sibuk/menunggu).
   - Tunggu kartu ditempel maksimum 15 detik (timeout -> kirim "CARD_TIMEOUT", LED mati).
   - Bila kartu ditempel:
     UPSERT ke /rest/v1/rfid_cards?on_conflict=uid
     Body: {"uid":"<UID>","student_id":"<student_id>"}
     Header: Prefer: resolution=merge-duplicates,return=minimal
     Sukses -> kirim "CARD_OK <UID> <student_id>", LED kedip 1x.
     Gagal  -> kirim "CARD_FAIL <UID> (cek student_id ada di tabel students)", LED kedip 2x.
     Matikan LED, set lastUid = uid dan lastTap = millis() agar tap daftar tidak langsung terbaca sebagai absen.

4. Perintah Serial Tambahan:
   - "PING"   -> balas "PONG rfid".
   - "LED_OK" -> kedip LED 1x (700ms), lalu balas "LED_DONE".
   - Lainnya  -> balas "ERR_UNKNOWN <perintah>".

5. Loop utama:
   - Selalu cek Serial.available() dulu; setiap baris masuk di-trim lalu diproses sebagai perintah.
   - Bila tidak ada perintah, panggil cekKartu() (non-blocking, tanpa delay panjang).
   - delay(50) di akhir loop.

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
- INSERT event pakai header tambahan:  Prefer: return=minimal
- Error 4xx (400/401/409) JANGAN diulang (retry tidak ada gunanya);
  ulangi maksimum 3x HANYA untuk error jaringan/timeout.
- Error 401 = key salah atau RLS belum mengizinkan anon.
  Error 409 ..._fkey = device_id belum ada di tabel devices.
- TLS di ESP32 rapuh: buat objek WiFiClientSecure BARU di setiap percobaan
  (jangan dipakai ulang), panggil tls.setInsecure().
- Setelah WiFi lama idle, TLS bisa gagal handshake: panggil WiFi.setSleep(false)
  sekali di setup().
- JANGAN pernah bilang "matikan RLS" atau `disable row level security` sebagai
  solusi. RLS tetap ON; yang diperbaiki selalu policy-nya (tambah policy baru,
  jangan ubah/hapus policy milik board lain).
- JANGAN hasilkan `DROP TABLE`, `ALTER TABLE ... DROP`, atau perintah hapus apa pun
  terhadap tabel yang sudah ada. Butuh tabel baru? Beri nama unik dan minta
  pemilik meninjau setup.sql-nya sebelum dijalankan.

=== BANTU SAYA HASILKAN ===
1. File .ino lengkap (WiFi + TLS + POST + parser perintah Serial).
2. File setup.sql: policy RLS anon seminimal mungkin (INSERT rfid_events,
   SELECT rfid_cards, INSERT+UPDATE rfid_cards) + INSERT baris device saya.
   Tabel rfid_cards & rfid_events SUDAH ADA — jangan dibuat ulang dari nol
   tanpa memberi tahu saya.
3. Daftar library Arduino yang harus diinstal.
4. Cara verifikasi: query apa di SQL Editor untuk memastikan event masuk.
5. Contoh JSON body yang BENAR (lihat referensi tabel di bawah — salin persis,
   jangan mengarang nama kolom).
```

---

## Referensi tabel (diverifikasi dari database live, 2026-11-08)

Bagian ini WAJIB disalin juga ke chat AI. Nama kolom salah = HTTP 400
`PGRST204 column not found`. Disalin langsung dari OpenAPI PostgREST project,
bukan dari hafalan.

### `rfid_events` — log tap kartu

| Kolom | Tipe | Null? | Catatan |
|---|---|---|---|
| `event_id` | uuid | tidak | PK, default `gen_random_uuid()` — **jangan dikirim** |
| `device_id` | text | tidak | FK → `devices.device_id` |
| `uid` | text | tidak | `"A3:1F:22:04"`, huruf besar |
| `status` | text | tidak | `'known'` / `'unknown'` (CHECK) |
| `created_at` | timestamptz | tidak | default `now()` |

```json
{"device_id":"EDGE-01","uid":"A3:1F:22:04","status":"known"}
```

### `rfid_cards` — pemetaan kartu → siswa

| Kolom | Tipe | Null? | Catatan |
|---|---|---|---|
| `uid` | text | tidak | **PK** |
| `student_id` | text | tidak | FK → `students.student_id`, ON DELETE CASCADE |
| `created_at` | timestamptz | tidak | default `now()` |

```json
{"uid":"A3:1F:22:04","student_id":"40123292"}
```
Upsert: `POST /rest/v1/rfid_cards?on_conflict=uid`.

### `devices` — baris perangkat untuk board ini

| Kolom | Tipe | Null? | Catatan |
|---|---|---|---|
| `device_id` | text | tidak | **PK**, harus sama persis dengan `#define DEVICE_ID` |
| `name` | text | tidak | nama tampil |
| `type` | text | tidak | untuk board ini: `'rfid_esp32'` |
| `class_id` | text | ya | FK → `classes.class_id` |
| `credential_hash` | text | ya | **jangan pernah diisi dari firmware** |
| `status` | text | tidak | default `'offline'`, isi `'online'` / `'offline'` |
| `firmware_version` | text | ya | opsional |
| `last_seen_at` | timestamptz | ya | opsional |
| `last_data_at` | timestamptz | ya | opsional |
| `is_active` | boolean | tidak | default `true` |

```sql
insert into public.devices (device_id, name, type, class_id, status, is_active)
values ('RFID-RUANG-2', 'ESP32 RC522 Ruang 2', 'rfid_esp32', 'XII-RPL-1', 'online', true)
on conflict (device_id) do update
  set name = excluded.name, type = excluded.type, is_active = true;
```

`devices.type` punya CHECK constraint. Daftar yang sah di database live:
`face_computer`, `fingerprint_esp32`, `seat_esp32`, `env_esp32`, `rfid_esp32`.
Jangan mengubah constraint ini — sudah mencakup `rfid_esp32`.

## Dari mana nilai itu diambil

| Nilai | Asal | Keterangan |
|---|---|---|
| `SUPABASE_URL` | `.env.local` → `NEXT_PUBLIC_SUPABASE_URL` | URL proyek, sama untuk semua board |
| PUBLISHABLE KEY | `.env.local` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Key publik, akses dibatasi RLS |
| `DEVICE_ID` | Ditentukan bersama pemilik, lalu INSERT ke `devices` | **Case-sensitive**, harus persis sama |
| Pin RC522 | SDA=GPIO5, SCK=GPIO18, MOSI=GPIO23, MISO=GPIO19, RST=GPIO22 | Boleh beda per board, cukup ubah `#define` |
| Pin buzzer | I/O=GPIO25 (pasif), VCC=3V3/5V, GND=GND | Bebas dari bus SPI, bukan strapping pin; butuh PWM (`tone()`) |

Cadangan: kalau `.env.local` tidak ada, publishable key bisa diambil di
Dashboard Supabase → Project Settings → API → **Publishable key** (diawali
`sb_publishable_`). Key lama `anon public` (diawali `eyJ`) juga masih bisa dipakai.

## 3 kalimat yang wajib dipahami sebelum flash

1. Firmware cuma boleh pegang **publishable key**. Secret key hanya untuk
   server (`.env.local` → `SUPABASE_SECRET_KEY`), tidak pernah masuk ke ESP32.
2. Anon key hanya bisa melakukan apa yang **policy RLS izinkan**. Kalau dapat
   401/409, yang diperbaiki adalah `setup.sql`, bukan kodenya.
3. `DEVICE_ID` harus sudah ada di tabel `devices` SEBELUM board pertama kali
   mengirim — kalau tidak, semua INSERT ditolak foreign key.
