# Gerbang .ino → Database

> Mana kode yang mengubah keluaran kedua firmware `.ino` menjadi baris Supabase. Aturan arsitektur yang dijaga: **firmware tidak memegang kredensial apa pun**, **FastAPI tidak menulis database**, **Route Handler Next.js adalah satu-satunya penulis**.

## 1. Peta Cepat

| Firmware (ESP32) | Transport | Gerbang (pintu pertama di server) | Penulis baris DB | Tabel yang ditulis |
|---|---|---|---|---|
| `esp32Loadcell_WiFi/esp32Loadcell_WiFi.ino` | Wi-Fi, HTTP POST langsung | `apps/web/src/app/api/seats/status/route.ts` (`POST`) | Route Handler yang sama | `seat_status` (upsert), `seat_events` (bila berubah), `devices` (heartbeat) |
| `esp32R503_Serial/esp32R503_Serial.ino` | USB Serial, protokol baris | `apps/face-service/fingerprint_serial.py` (`FingerprintBridge`) → `apps/face-service/server.py` (FastAPI, state sesi saja) | `apps/web/src/app/api/attendance/route.ts` (`POST` tulis `attendance`); `.../fingerprint/enroll/status` dan `.../rfid/enroll/status` (`GET` tulis slot/kartu) | `attendance` (upsert `student_id,class_id,date`), `students.fingerprint_slot`, `rfid_cards` |

## 2. Rantai Kursi (Direct HTTP)

```
ESP32 ──POST JSON──> route.ts:POST /api/seats/status ──supabaseServer──> PostgreSQL
```

Langkah di `POST` (`apps/web/src/app/api/seats/status/route.ts:108–252`):

1. Validasi bentuk: `device_id`, `seat_id` string, `status` ∈ `occupied|empty|unknown`; `weight_kg` boleh absen tapi kalau ada harus angka (kg).
2. Cek `devices`: terdaftar, `is_active = true`, `type = 'seat_esp32'` — kalau tidak: `404` / `403`.
3. Cek `seats`: `seat_id` ada **dan** `seats.device_id` sama dengan pelapor `device_id` — kalau tidak: `404` / `409`.
4. `upsert seat_status` (kunci `seat_id`); bila status berubah dari sebelumnya → `insert seat_events` (bila tabel belum ada, kode `PGRST205`, telemetri tetap disimpan).
5. `update devices` → `status='online'`, `last_seen_at`, `last_data_at`, `firmware_version`.
6. Kembalikan `{ seat_id, status, weight_kg, changed, history }`.

Baca untuk dashboard: `GET /api/seats/status?class_id=` (kursi + `seat_status` + `devices`, flag `stale` dari `app_config.device_offline_seconds`) dan `GET /api/seats/events?seat_id=&limit=` (riwayat, default 20, maksimum 100).

Keterkaitan dengan sketch: `200` → ESP32 reset backoff; `4xx` → ESP32 tetap mencoba ulang (buffer hanya menyimpan status terbaru, jadi yang terkirim adalah kondisi fisik terkini).

## 3. Rantai Sidik Jari / Kartu (Serial → FastAPI → Next.js)

```
ESP32 ──USB 115200──> FingerprintBridge ──HTTP 127.0.0.1:8000──> Route Handler Next.js ──> Supabase
```

### 3a. Konsum serial: `apps/face-service/fingerprint_serial.py`

- `find_port()`: `FP_SERIAL_PORT` → deteksi USB-Serial (CH340/CP210/FT232) → port pertama. Kabel lepas → retry tiap 2 dtk (`_run`).
- `_handle()`: parse `BOOT`, `READY`, `PONG`, `ENROLL_OK/FAIL`, `PLACE/REMOVE`, `CARD/CARD_OK/TIMEOUT`, `MATCH/NOMATCH`, batas riwayat 500 baris.
- Sesi 2FA (`open_session`): `state=waiting`, `slot`, `uids` terikat, TTL default 30 dtk.
  - `_apply_match`: `MATCH <slot>` cocok dengan slot sesi → `verified` (`method=fingerprint`); slot lain → `slot_mismatch`, percobaan+1.
  - `_apply_card`: `CARD <uid>` ada di `uids` → `verified` (`method=rfid`); lain → `uid_mismatch`.
  - 3 percobaan salah (`MAX_ATTEMPTS`) → `failed`; lewat deadline → `expired`.
  - Event di luar sesi dibuang (`ignored_matches` naik) — jari/kartu tanpa scan wajah bukan absensi.
- Perintah sinkron: `enroll()` (blokir ≤ 40 dtk), `delete()`, `clear()`, `led_ok()` (tunggu `LED_DONE`), `open_card()` + `card_status()` (jendela 15 dtk, polling UI).

### 3b. HTTP lokal: `apps/face-service/server.py`

Endpoint yang diekspos FastAPI — hanya meneruskan ke bridge, tanpa kredensial DB:

| Endpoint | Meneruskan ke |
|---|---|
| `GET /fingerprint/status` | `bridge.status()` |
| `POST /fingerprint/enroll` + `GET /fingerprint/enroll/status` | `bridge.enroll()` (worker thread, `409` bila job berjalan) / `bridge.enroll_status()` |
| `DELETE /fingerprint/{slot}` | `bridge.delete()` |
| `POST/GET/DELETE /fingerprint/session` | `open_session` / `session()` / `cancel_session` |
| `POST /rfid/enroll`, `GET /rfid/enroll/status`, `DELETE /rfid/enroll` | `open_card` / `card_status` / `cancel_card` |
| `POST /fingerprint/led` | `bridge.led_ok()` |
| `GET /health`, `POST /recognize`, `POST /enroll`, `DELETE /enroll/{student_id}` | mesin wajah YuNet+SFace (tidak terkait ESP32) |

Base URL dipakai Route Handler: `FACE_SERVICE_URL` (default `http://127.0.0.1:8000`).

### 3c. Proxy + penulis DB: `apps/web/src/app/api/*`

| Route | Peran dalam rantai |
|---|---|
| `POST /api/fingerprint/session` | Baca `students.fingerprint_slot` + `rfid_cards.uid` dari Supabase → buka sesi di FastAPI. Menolak (`400`) siswa tanpa faktor kedua. |
| `GET /api/fingerprint/session` | Poll state sesi untuk UI kios (`/camera`) |
| `POST /api/attendance` | **Satu-satunya penulis absensi**: cek sesi `verified` milik siswa ini, bukti masih segar (`verified_at`), slot/UID cocok dengan DB → hitung `present`/`late` dari `app_config.late_threshold` → `upsert attendance` → konsumsi sesi (`DELETE`) → `POST /fingerprint/led` → `LED_OK` di LCD |
| `POST /api/fingerprint/enroll`, `POST /api/rfid/enroll` | Minta FastAPI membuka mode enroll / jendela kartu |
| `GET /api/fingerprint/enroll/status` | **Penulis `students.fingerprint_slot`**: saat `ENROLL_OK`, update `fingerprint_status='enrolled'` + slot; saat gagal, hapus template sisa di sensor (rollback) |
| `GET /api/rfid/enroll/status` | **Penulis `rfid_cards`**: saat `CARD_OK`, tolak (`409`) bila UID sudah terikat siswa lain, lalu `upsert {uid, student_id}` |
| `DELETE /api/fingerprint/[slot]` | Hapus slot di sensor lewat FastAPI |
| `GET /api/fingerprint/status` | Status koneksi untuk Device Monitoring |
| `POST /api/face/recognize` | Proksi wajah; tidak menyentuh ESP32 (faktor pertama) |

## 4. Alur Penuh Kios Absensi (contoh)

1. `/camera`: wajah dikenali (`POST /api/face/recognize` → FastAPI) → `POST /api/fingerprint/session { student_id }`.
2. Bridge menunggu; siswa tempel jari → firmware kirim `MATCH 5 87`.
3. `GET /api/fingerprint/session` → `verified, matched_slot=5`.
4. `/camera` kirim `POST /api/attendance { student_id }` → validasi ulang → `upsert attendance (present/late)` → `DELETE /fingerprint/session` → `POST /fingerprint/led`.
5. Firmware terima `LED_OK` → LCD "Absensi tercatat" + `LED_DONE`.

## 5. Kredensial: Siapa Memegang Apa

| Rahasia | Ada di | Tidak ada di |
|---|---|---|
| `SUPABASE_URL` / service-role key | `apps/web` (server-side, `.env.local`) | firmware, FastAPI, browser |
| `WIFI_SSID` / `WIFI_PASS` | `esp32Loadcell_WiFi/secrets.h` (di-ignore git) | repo, backend |
| Sesi 2FA (in-memory) | `apps/face-service` (`FingerprintBridge`), dibuka oleh `POST /api/fingerprint/session` | Supabase, firmware |
