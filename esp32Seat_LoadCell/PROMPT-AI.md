# PROMPT-AI — template chat AI untuk board **load cell kursi (HX711)**

File ini BUKAN dokumentasi teknis. Ini template prompt yang disalin ke chat AI
mana pun (ChatGPT, Claude, Gemini, dsb) supaya teman yang bikin board
**sensor okupansi kursi** sendiri langsung dapat kode yang benar tanpa perlu
paham arsitektur proyek dulu.

Khusus board ini: HX711 + load cell → tabel `seat_status`.
Untuk kalibrasi offline tanpa WiFi, lihat [../load_cell/PROMPT-AI.md](../load_cell/PROMPT-AI.md).

## Konsep (baca dulu, 30 detik)

Supabase proyek ini **dipakai bersama, tidak bikin project baru**. Satu project,
banyak board. Teman yang bikin board kursi baru HANYA perlu 2 hal dari pemilik:

1. `SUPABASE_URL` + PUBLISHABLE KEY (diminta lewat chat pribadi — bukan grup).
2. `SEAT_ID` yang sudah ada di tabel `seats` + `DEVICE_ID` yang dicatat di tabel `devices`.

Teman HANYA mengonfigurasi **bagian alatnya**: HX711 di pin apa, kalibrasi berapa,
SEAT_ID mana. Dia TIDAK membuat project Supabase dan TIDAK memegang secret key.

Cara pakai: salin blok di bawah garis, ganti placeholder, tempel ke AI, kirim.

---

```
Saya membuat firmware ESP32 (Arduino IDE) untuk sensor okupansi kursi:
load cell + modul HX711. Firmware menahan hysteresis state machine lalu
meng-upsert status ke Supabase lewat HTTPS REST (PostgREST).
Bantu saya bikin file .ino lengkap.

=== PIN & HARDWARE ===
- ESP32 DevKit
- HX711 VCC -> 3V3, GND -> GND
  DT / DOUT -> GPIO 19
  SCK / CLK -> GPIO 18
- Load cell 4 kabel (E+/E-/A+/A-) ke terminal HX711
- LED onboard ESP32 : GPIO 2 (kedip 1x = kirim sukses)
- Serial Monitor 115200 baud

=== DATA KONFIGURASI (diisi lewat #define di awal kode) ===
1. SUPA_URL      : [minta ke pemilik proyek — URL tanpa trailing slash]
2. SUPA_ANON_KEY : [tulis placeholder <PUBLISHABLE_KEY> — JANGAN kirim key asli ke chat AI]
3. SEAT_ID       : [contoh: SEAT-01 — harus sudah ada di tabel seats]
4. CALIBRATION_FACTOR : [dari kalibrasi offline; contoh 1109.4]
5. WIFI_SSID & WIFI_PASSWORD : [isi sendiri secara lokal]

=== PERILAKU SISTEM LENGKAP ===
1. Boot:
   - Serial.begin(115200), pinMode(LED_PIN, OUTPUT), tls.setInsecure().
   - Kirim baris "BOOT 1.0seat".
   - Sambung WiFi (timeout 20 dtk).
   - loadCell.begin(19, 18), loadCell.set_scale(CALIBRATION_FACTOR).
   - Tunggu HX711 siap (wait_ready_timeout(1000)); bila gagal kirim
     "HX711 belum terbaca. Periksa VCC, GND, DT/DOUT, SCK/CLK." dan ulangi tiap 500ms.
   - delay(2000) agar sinyal stabil, lalu loadCell.tare(20) — anggap kondisi tanpa beban = 0.
   - Kirim "Tare selesai. Kirim pertama saat status stabil."

2. Pembacaan berat:
   - loadCell.get_units(5) — rata-rata 5 sampel untuk redam noise.
   - Deadband: |gram| <= 3.0 -> jadikan 0.0.
   - Bila hasil NaN/Inf -> kirim "[SKIP] HX711 nilai invalid", delay 100ms, JANGAN kirim JSON.

3. State machine (enum SeatState: WAITING_FOR_LOAD, OCCUPIED, EMPTY_PENDING, ABSENT):
   - Ambang: OCCUPIED >= 20 g, EMPTY <= 10 g, RECOVERY >= 15 g.
   - Timing: OCCUPIED_CONFIRM_MS = 1000 (beban harus stabil 1 dtk), ABSENCE_DELAY_MS = 5000.
   - WAITING_FOR_LOAD / ABSENT -> bila gram >= 20 selama 1 dtk: jadi OCCUPIED.
   - OCCUPIED -> gram <= 10: mulai timer, jadi EMPTY_PENDING.
   - EMPTY_PENDING -> gram >= 15: balik OCCUPIED (timer batal);
     bila timer 5 dtk habis: jadi ABSENT.
   - Fungsi reportStatus(): OCCUPIED & EMPTY_PENDING -> "occupied", ABSENT -> "empty",
     WAITING_FOR_LOAD -> "unknown".
     (EMPTY_PENDING tetap dilaporkan occupied sampai timer habis — timer urusan firmware.)

4. Pengiriman (upsert ke seat_status):
   - Kirim bila status BERUBAH, atau setiap HEARTBEAT_MS (60000 ms) walau tidak berubah.
   - Body: {"seat_id":"<SEAT_ID>","status":"<status>","weight_kg":<gram/1000 dengan 3 desimal>}
   - URL: POST /rest/v1/seat_status?on_conflict=seat_id
   - Header: apikey, Authorization Bearer <anon key>, Content-Type application/json,
     Prefer: resolution=merge-duplicates,return=minimal
   - JANGAN kirim kolom updated_at — ada trigger database yang mengisinya
     (ESP32 tanpa NTP tidak tahu jam yang benar).
   - 2xx -> simpan lastSentStatus + lastHeartbeat, kirim "[KIRIM] <status> <gram> g", kedip LED 1x 150ms.
   - Gagal -> kirim "[ERR] HTTP <kode>", delay 1000ms lalu coba lagi di iterasi berikutnya.
   - WiFi putus -> "[ERR] WiFi putus", delay 1000ms, jangan blokir pembacaan sensor.

5. Loop utama:
   - wait_ready_timeout(500); gagal -> "ERROR: HX711 tidak siap.", delay 300ms, return.
   - Baca berat -> updateSeatState -> putuskan perlu kirim atau tidak.
   - Tidak perlu kirim -> delay(100) dan kembali.

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
- UPSERT pakai: URL .../rest/v1/seat_status?on_conflict=seat_id
  + Prefer: resolution=merge-duplicates,return=minimal
- JANGAN mengirim updated_at dari firmware (trigger DB yang mengisi).
- TLS di ESP32 rapuh: panggil tls.setInsecure(), dan jangan pakai ulang objek
  WiFiClientSecure yang sudah gagal handshake.
- Setelah WiFi lama idle, TLS bisa gagal handshake: panggil WiFi.setSleep(false)
  sekali di setup().
- JANGAN pernah bilang "matikan RLS" atau `disable row level security` sebagai
  solusi. RLS tetap ON; yang diperbaiki selalu policy-nya.
- JANGAN hasilkan `DROP TABLE`, `ALTER TABLE ... DROP`, atau perintah hapus apa pun
  terhadap tabel yang sudah ada (`seat_status` dan `seats` SUDAH ADA).
- JANGAN menyentuh tabel lain (attendance, students, devices selain baris device sendiri).

=== BANTU SAYA HASILKAN ===
1. File .ino lengkap (WiFi + TLS + upsert + state machine).
2. File setup.sql: INSERT baris device saya, UPDATE seats.device_id untuk kursi saya,
   trigger touch_updated_at untuk seat_status, policy RLS anon seminimal mungkin supaya
   firmware bisa INSERT + UPDATE seat_status (SELECT ke tabel ini sudah terbuka di
   live DB untuk realtime website, dipertahankan sebagaimana adanya).
3. Library: "HX711 Arduino Library" (bogde) + library bawaan ESP32.
4. Cara verifikasi: query apa di SQL Editor untuk memastikan status masuk.
5. Contoh JSON body yang BENAR (lihat referensi tabel di bawah — salin persis).
```

---

## Referensi tabel (diverifikasi dari database live, 2026-11-08)

Bagian ini WAJIB disalin juga ke chat AI. Nama kolom salah = HTTP 400
`PGRST204 column not found`. Disalin langsung dari OpenAPI PostgREST project.

### `seat_status` — okupansi kursi (board load cell)

| Kolom | Tipe | Null? | Catatan |
|---|---|---|---|
| `seat_id` | text | tidak | **PK** sekaligus FK → `seats.seat_id` |
| `status` | text | tidak | `'occupied'` / `'empty'` / `'unknown'` |
| `weight_kg` | real | **ya** | berat terbaca dalam kg (3 desimal) |
| `updated_at` | timestamptz | tidak | default `now()`, diisi trigger — **jangan dikirim** |

```json
{"seat_id":"SEAT-01","status":"occupied","weight_kg":24.6}
```
Upsert: `POST /rest/v1/seat_status?on_conflict=seat_id`.

### `seats` — denah kursi (dibaca setup.sql, bukan firmware)

| Kolom | Tipe | Null? | Catatan |
|---|---|---|---|
| `seat_id` | text | tidak | **PK**, contoh `SEAT-01` |
| `class_id` | text | tidak | FK → `classes.class_id` |
| `device_id` | text | **ya** | FK → `devices.device_id`, diisi setup.sql |
| `row_no` | smallint | tidak | baris kursi |
| `col_no` | smallint | tidak | kolom kursi |
| `is_monitored` | boolean | tidak | default `true` |

### `devices` — baris perangkat untuk board ini

| Kolom | Tipe | Null? | Catatan |
|---|---|---|---|
| `device_id` | text | tidak | **PK**, contoh `SEAT-ESP-01` |
| `name` | text | tidak | nama tampil |
| `type` | text | tidak | untuk board ini: `'seat_esp32'` |
| `class_id` | text | ya | FK → `classes.class_id` |
| `credential_hash` | text | ya | **jangan pernah diisi dari firmware** |
| `status` | text | tidak | default `'offline'` |
| `firmware_version` | text | ya | opsional |
| `last_seen_at` | timestamptz | ya | opsional |
| `last_data_at` | timestamptz | ya | opsional |
| `is_active` | boolean | tidak | default `true` |

```sql
insert into public.devices (device_id, name, type, class_id, status, is_active)
values ('SEAT-ESP-01', 'Sensor Kursi Baris A', 'seat_esp32', 'XII-RPL-1', 'online', true)
on conflict (device_id) do update
  set name = excluded.name, type = excluded.type,
      class_id = excluded.class_id, is_active = true;

update public.seats set device_id = 'SEAT-ESP-01' where seat_id = 'SEAT-01';
```

## Dari mana nilai itu diambil

| Nilai | Asal | Keterangan |
|---|---|---|
| `SUPABASE_URL` | `.env.local` → `NEXT_PUBLIC_SUPABASE_URL` | URL proyek, sama untuk semua board |
| PUBLISHABLE KEY | `.env.local` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Key publik, akses dibatasi RLS |
| `SEAT_ID` | Tabel `seats`, sudah ada | Harus cocok, kalau tidak upsert ditolak FK |
| `CALIBRATION_FACTOR` | Sketsa kalibrasi [`../load_cell/`](../load_cell/) | 1109.4 untuk load cell di meja kerja |
| Pin HX711 | DT=GPIO19, SCK=GPIO18 | Boleh beda per board, cukup `#define` |

Cadangan: kalau `.env.local` tidak ada, publishable key bisa diambil di
Dashboard Supabase → Project Settings → API → **Publishable key**.

## 3 kalimat yang wajib dipahami sebelum flash

1. Firmware cuma boleh pegang **publishable key**. Secret key hanya untuk server.
2. Anon key hanya bisa melakukan apa yang **policy RLS izinkan** (INSERT + UPDATE
   `seat_status`). Kalau dapat 403/409, yang diperbaiki `setup.sql`, bukan kodenya.
3. `SEAT_ID` harus sudah ada di `seats` dan terhubung ke baris `devices`
   SEBELUM board mengirim — kalau tidak, upsert ditolak foreign key.
