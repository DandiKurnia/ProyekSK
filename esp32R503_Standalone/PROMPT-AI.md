# PROMPT-AI — template chat AI untuk board **sidik jari R503 ESP32**

File ini BUKAN dokumentasi teknis. Ini template prompt yang disalin ke chat AI
mana pun (ChatGPT, Claude, Gemini, dsb) supaya teman yang bikin board
**sensor sidik jari R503** sendiri langsung dapat kode yang benar tanpa perlu
paham arsitektur proyek dulu.

Khusus board ini: R503 + `fingerprint_events`.

## Konsep (baca dulu, 30 detik)

Supabase proyek ini **dipakai bersama, tidak bikin project baru**. Satu project,
banyak board. Teman yang bikin board sidik jari baru HANYA perlu 2 hal dari pemilik:

1. `SUPABASE_URL` + PUBLISHABLE KEY (diminta lewat chat pribadi — bukan grup).
2. `DEVICE_ID` unik untuk boardnya (disepakati dengan pemilik, dicatat di tabel `devices`).

Teman HANYA mengonfigurasi **bagian alatnya**: R503 di pin apa, DEVICE_ID apa.
Dia TIDAK membuat project Supabase, TIDAK memegang secret key, dan TIDAK
mengubah tabel milik board lain.

Cara pakai: salin blok di bawah garis, ganti placeholder, tempel ke AI, kirim.

---

```
Saya membuat firmware ESP32 (Arduino IDE) untuk sensor sidik jari R503.
Firmware memverifikasi jari 1:N di memori flash R503 lalu mengirim event ke
Supabase lewat HTTPS REST (PostgREST). Bantu saya bikin file .ino lengkap.

=== PIN & HARDWARE ===
- ESP32 DevKit, sensor R503 (modul bunder/kapasitif, 3.3V SAJA)
- R503 VCC -> 3V3, GND -> GND
  TX R503 -> GPIO 16 (Serial2 RX ESP32)
  RX R503 -> GPIO 17 (Serial2 TX ESP32)
  WAKEUP  -> GPIO 4
- Buzzer PASIF (modul 3 pin: VCC, GND, I/O): I/O -> GPIO 25, VCC -> 3V3/5V, GND -> GND
  Bunyi hanya saat event 2xx terkirim ke Supabase: tone(BUZZER_PIN, 2000, 120), non-blocking.
  pinMode(BUZZER_PIN, OUTPUT) di setup. Jangan pakai digitalWrite: buzzer pasif butuh PWM.
- Baud sensor: 57600 via HardwareSerial(2)
- LED ring ada di sensor R503 (bukan LED onboard) — pakai finger.LEDcontrol
- Serial Monitor 115200 baud

=== DATA KONFIGURASI (diisi lewat #define di awal kode) ===
1. SUPA_URL      : [minta ke pemilik proyek — URL tanpa trailing slash]
2. SUPA_ANON_KEY : [tulis placeholder <PUBLISHABLE_KEY> — JANGAN kirim key asli ke chat AI]
3. DEVICE_ID     : [contoh: FP-STANDALONE-01 — disepakati dengan pemilik, wajib ada di tabel devices]
4. WIFI_SSID & WIFI_PASSWORD : [isi sendiri secara lokal]

=== PERILAKU SISTEM LENGKAP ===
1. Boot:
   - Serial.begin(115200), pinMode(WAKEUP_PIN, INPUT), pinMode(LED_PIN, OUTPUT), pinMode(BUZZER_PIN, OUTPUT).
   - fpSerial.begin(57600, SERIAL_8N1, RX_PIN, TX_PIN), delay 300ms.
   - Kirim baris: "BOOT 1.0fp".
   - finger.begin(57600), delay 100ms, lalu finger.verifyPassword():
     - gagal  -> kirim "SENSOR_FAIL 0", JANGAN while(1) — perintah Serial tetap bisa dipakai.
     - sukses -> sensorOk = true, finger.getTemplateCount(), kirim "READY <jumlah_template>".
   - LED ring biru breathing (siap), pastikan WiFi tersambung (timeout 20 dtk).
   - Panggil WiFi.setSleep(false) sekali di setup (cegah TLS idle handshake drop).

2. Verifikasi 1:N (loop otomatis tiap jari menempel):
   - finger.getImage() -> image2Tz() -> fingerSearch().
   - COCOK (fingerSearch() == FINGERPRINT_OK):
     kirim "MATCH <fingerID> <confidence>", LED ring ungu ON,
     POST /rest/v1/fingerprint_events:
     {"device_id":"<DEVICE_ID>","slot_id":<fingerID>,"confidence":<confidence>,"status":"match"}
     sukses (2xx) -> kirim "[KIRIM] match slot=<id> conf=<confidence>", bip buzzer 2000Hz 120ms (bipOk), blink LED onboard 1x, LED hijau 400ms lalu mati.
   - TIDAK COCOK: kirim "NOMATCH", LED ring merah flashing 3x,
     POST {"device_id":"<DEVICE_ID>","slot_id":null,"confidence":null,"status":"no_match"}
     sukses -> kirim "[KIRIM] no_match slot=-1", bip buzzer 2000Hz 120ms (bipOk).
   - Setelah tiap verifikasi: tunggu jari diangkat (tungguJariAngkat, getImage == NOFINGER, timeout 4 dtk), delay 300ms.
   - Bila sensorOk == false: loop tidak verifikasi (hanya layani perintah Serial), delay 500ms.

3. Kirim event (fungsi kirimEvent):
   - SETIAP kali kirim: cek WiFi dulu (koneksi bisa putus kapan saja). Gagal -> kirim
     "[ERR] WiFi belum tersambung, event dilewati", return tanpa blokir.
   - Body: slot < 0 -> slot_id & confidence null; slot >= 0 -> angka.
   - Maks 3 percobaan. WiFiClientSecure dibuat BARU di tiap percobaan (fresh object,
     tidak dipakai ulang), tls.setInsecure(), http.setTimeout(10000).
   - Header: apikey, Authorization Bearer <anon key>, Content-Type application/json,
     Prefer return=minimal.
   - 2xx -> sukses (log [KIRIM]). Error 4xx -> TIDAK diulang.
     Log "[ERR] HTTP <kode> (percobaan <n>)", delay 500ms antar percobaan 5xx/jaringan.

4. Enroll 2 tempelan (fungsi enrollFinger, slot id 1-200):
   - kirim "PLACE <id>", LED ring biru breathing.
   - tunggu jari (timeout 15 dtk) -> image2Tz(1). Gagal -> kirim "ENROLL_FAIL <id> <kode R503>", LED merah, return.
   - kirim "REMOVE", tunggu jari diangkat (timeout 4 dtk).
   - kirim "PLACE <id>" lagi -> tunggu jari -> image2Tz(2).
   - createModel() -> storeModel(id).
   - sukses -> kirim "ENROLL_OK <id> 0", LED hijau 600ms lalu mati.
   - WAJIB: tunggu jari diangkat lagi agar tidak langsung terverifikasi setelah enroll.

5. Perintah Serial (kompatibel penuh dengan modul USB Serial kelas / face-service):
   - "PING" atau "m"    -> getTemplateCount(), balas "PONG <jumlah>".
   - "LED_OK"           -> LED ring hijau, delay 700ms, LED mati, balas "LED_DONE".
   - "CLEAR" atau "c"   -> emptyDatabase(), "CLEAR_OK 0" bila sukses, "CLEAR_FAIL <kode>" bila gagal.
   - "e"                -> balas "Masukkan ID (1-200):", baca parseInt(), bila 1-200:
     balas "ENROLLING <id>", jalankan enrollFinger.
   - "ENROLL <id>"      -> id 1-200: "ENROLLING <id>" + enrollFinger.
     id di luar range: "ENROLL_FAIL 0 255".
   - "DELETE <id>" / "d <id>" -> id 1-200: deleteModel(id),
     "DELETE_OK <id> 0" bila sukses, "DELETE_FAIL <id> <kode>" bila gagal.
     id di luar range: "DELETE_FAIL 0 255".
   - Angka saja (mis. "6" dari Enter nyasar) -> anggap enroll id itu: "ENROLLING 6" + enrollFinger.
   - Lainnya -> "ERR_UNKNOWN <perintah>".

6. Loop utama:
   - Serial.available() diproses dulu (trim baris), baru verifikasi jari.
   - sensorOk false -> delay(500), jangan verifikasi.
   - verifikasi path normal -> delay(50) di akhir loop.

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
  (jangan dipakai ulang / global), panggil tls.setInsecure().
- Setelah WiFi lama idle, TLS bisa gagal handshake: panggil WiFi.setSleep(false)
  sekali di setup().
- JANGAN pernah bilang "matikan RLS" atau `disable row level security` sebagai
  solusi. RLS tetap ON; yang diperbaiki selalu policy-nya (tambah policy baru,
  jangan ubah/hapus policy milik board lain).
- JANGAN hasilkan `DROP TABLE`, `ALTER TABLE ... DROP`, atau perintah hapus apa pun
  terhadap tabel yang sudah ada. Butuh tabel baru? Beri nama unik dan minta
  pemilik meninjau setup.sql-nya sebelum dijalankan.

=== BANTU SAYA HASILKAN ===
1. File .ino lengkap (WiFi + TLS + POST + parser perintah Serial kompatibel face-service).
2. File setup.sql: tabel bila belum ada + policy RLS anon seminimal mungkin
   (INSERT fingerprint_events, SELECT fingerprint_events) + INSERT baris device saya
   + publikasi realtime bila belum ada.
3. Library yang dipakai: Adafruit Fingerprint Sensor Library (+ library bawaan ESP32:
   WiFi, WiFiClientSecure, HTTPClient, HardwareSerial).
4. Cara verifikasi: query apa di SQL Editor untuk memastikan event masuk.
5. Contoh JSON body yang BENAR (lihat referensi tabel di bawah — salin persis,
   jangan mengarang nama kolom).
```

---

## Referensi tabel (diverifikasi dari database live, 2026-11-08)

Bagian ini WAJIB disalin juga ke chat AI. Nama kolom salah = HTTP 400
`PGRST204 column not found`. Disalin langsung dari OpenAPI PostgREST project,
bukan dari hafalan.

### `fingerprint_events` — log verifikasi jari (board R503)

| Kolom | Tipe | Null? | Catatan |
|---|---|---|---|
| `event_id` | uuid | tidak | PK, default `gen_random_uuid()` — **jangan dikirim** |
| `device_id` | text | tidak | FK → `devices.device_id` |
| `slot_id` | smallint | **ya** | nomor slot flash R503 (1–200), null bila `no_match` |
| `confidence` | smallint | **ya** | 0–255, null bila `no_match` |
| `status` | text | tidak | `'match'` / `'no_match'` (CHECK) |
| `created_at` | timestamptz | tidak | default `now()` |

```json
{"device_id":"FP-STANDALONE-01","slot_id":2,"confidence":85,"status":"match"}
{"device_id":"FP-STANDALONE-01","slot_id":null,"confidence":null,"status":"no_match"}
```

### `devices` — baris perangkat untuk board ini

| Kolom | Tipe | Null? | Catatan |
|---|---|---|---|
| `device_id` | text | tidak | **PK**, harus sama persis dengan `#define DEVICE_ID` |
| `name` | text | tidak | nama tampil |
| `type` | text | tidak | untuk board ini: `'fingerprint_esp32'` |
| `class_id` | text | ya | FK → `classes.class_id` |
| `credential_hash` | text | ya | **jangan pernah diisi dari firmware** |
| `status` | text | tidak | default `'offline'`, isi `'online'` / `'offline'` |
| `firmware_version` | text | ya | opsional |
| `last_seen_at` | timestamptz | ya | opsional |
| `last_data_at` | timestamptz | ya | opsional |
| `is_active` | boolean | tidak | default `true` |

```sql
insert into public.devices (device_id, name, type, class_id, status, is_active)
values ('FP-STANDALONE-01', 'Fingerprint Mandiri R503', 'fingerprint_esp32', 'XII-RPL-1', 'online', true)
on conflict (device_id) do update
  set name = excluded.name, type = excluded.type,
      class_id = excluded.class_id, is_active = true;
```

### Policy realtime (website baca event saat jari ditempel)

```sql
alter publication supabase_realtime add table public.fingerprint_events;
```

## Dari mana nilai itu diambil

| Nilai | Asal | Keterangan |
|---|---|---|
| `SUPABASE_URL` | `.env.local` → `NEXT_PUBLIC_SUPABASE_URL` | URL proyek, sama untuk semua board |
| PUBLISHABLE KEY | `.env.local` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Key publik, akses dibatasi RLS |
| `DEVICE_ID` | Ditentukan bersama pemilik, lalu INSERT ke `devices` | **Case-sensitive**, harus persis sama |
| Pin R503 | TX=GPIO16, RX=GPIO17, WAKEUP=GPIO4, baud 57600 | Boleh diubah bila kabel beda, cukup `#define` |
| Pin buzzer | I/O=GPIO25 (pasif), VCC=3V3/5V, GND=GND | Bebas dari bus UART2/SPI, bukan strapping pin; butuh PWM (`tone()`) |

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
