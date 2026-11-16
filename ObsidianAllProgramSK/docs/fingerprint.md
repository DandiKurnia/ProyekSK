# Fingerprint — Verifikasi Sidik Jari (ESP32 + R503 via USB Serial)

> **Aktif (2026-10-20)** — ESP32 R503 terhubung ke laptop kelas via **kabel USB (Serial COM)**. Daya dari port USB, komunikasi milidetik tanpa Wi-Fi / cloud polling. Versi Wi-Fi polling lama diarsipkan di [`archive/wifi-polling/fingerprint.md`](archive/wifi-polling/fingerprint.md) sebagai cadangan bila kabel USB tidak sampai.
>
> **Sumber kebenaran protokol:** `esp32R503_Serial/esp32R503_Serial.ino` (firmware v1.0). Dokumen ini mengikuti firmware apa adanya, bukan rancangan awal.

## Tujuan

Sensor fingerprint R503 pada ESP32 berfungsi sebagai **faktor verifikasi kedua**: memastikan siswa yang dikenali wajahnya adalah orang yang sama yang menempelkan jari. Tanpa kecocokan ini, absensi tidak dicatat.

Dokumen terkait: [architecture.md](architecture.md), [face-recognition.md](face-recognition.md), [communication-flow.md](communication-flow.md).

## Topologi Fisik

```
[ Laptop Kelas ]
   └── (Kabel USB — daya 5V + serial data 115200 baud)
        └── [ ESP32 DevKit ]
                 └── (UART2: GPIO16 RX / GPIO17 TX, 57600 baud, 3.3V + GND)
                      └── [ Sensor R503 ]
```

- Daya: port USB laptop (500mA–1A) mencukupi kebutuhan ESP32 (~80mA) + R503 (~50mA).
- Dua jalur serial berbeda: **USB ke laptop 115200 baud**, **UART2 ke sensor 57600 baud**. Jangan tertukar.
- GPIO4 (`WAKEUP_PIN`) hanya di-`pinMode(INPUT)`, belum dipakai firmware.

## Teknologi

| Komponen | Fungsi |
|---|---|
| ESP32 | Baca perintah baris dari USB Serial, kendalikan R503 via UART2, kirim event hasil |
| Sensor R503 | Simpan template sidik jari, pencocokan 1:N lokal di dalam sensor, kembalikan ID slot + skor |
| Driver PC | `pyserial` di `apps/face-service/fingerprint_serial.py` (**belum dibuat**) |

**Batasan penting:** R503 melakukan pencocokan **di dalam sensor** dan hanya mengembalikan ID slot + skor, bukan citra sidik jari. Citra tidak pernah ditransmisikan. Kapasitas template: **slot 1..200**.

## Protokol USB Serial (115200 baud, teks per baris, terminator `\n`)

Pemisah argumen adalah **spasi**. Firmware mem-`trim()` tiap baris dan mengabaikan baris kosong.

### Perintah PC → ESP32

| Perintah | Respons | Keterangan |
|---|---|---|
| `PING` | `PONG <jumlah_template>` | Tes koneksi + hitung template tersimpan |
| `ENROLL <id>` | `ENROLLING <id>` … `ENROLL_OK <id> 0` / `ENROLL_FAIL <id> <kode>` | Rekam jari 2x ke slot `id` (1..200) |
| `DELETE <id>` | `DELETE_OK <id> 0` / `DELETE_FAIL <id> <kode>` | Hapus 1 slot |
| `CLEAR` | `CLEAR_OK 0` / `CLEAR_FAIL <kode>` | Hapus seluruh database sensor |
| `LED_OK` | `LED_DONE` | Kedip hijau 700 ms; dipakai setelah absensi tercatat |
| `CARD` | `CARDWAIT` … `CARD_OK <UID>` / `CARD_TIMEOUT` | Buka jendela tempel kartu RFID 15 detik (daftar kartu). UID format `AA:BB:CC:DD` huruf besar |
| `CANCEL` | (tidak ada respons bila tidak ada jendela; `CARD_TIMEOUT` bila jendela sedang terbuka) | Tutup jendela `CARD` tanpa hasil |

Alias khusus Serial Monitor: `e` (enroll interaktif), `d <id>`, `c`, `m`. Perintah tak dikenal → `ERR_UNKNOWN <perintah>`. Perintah `CARD` tanpa reader (`rfidSiap` false) → `CARD_FAIL 0`.

### Event ESP32 → PC

| Event | Kapan |
|---|---|
| `BOOT <versi>` | Saat boot (sebelum sensor diperiksa) |
| `READY <jumlah_template>` | Handshake sensor sukses; LED biru bernapas |
| `RFID_FAIL 0` | Reader RC522 tidak terdeteksi (register versi `0x00`/`0xFF`); firmware jalan tanpa kartu |
| `CARDWAIT` | Jendela daftar kartu terbuka (balasan perintah `CARD`) |
| `CARD <UID>` | Kartu ditempel di luar jendela daftar — sesi 2FA yang menentukan pemiliknya |
| `CARD_OK <UID>` | Kartu tertangkap **di dalam** jendela daftar; jendela langsung tertutup |
| `CARD_TIMEOUT` | Jendela 15 detik habis tanpa kartu, atau jendela dibatalkan `CANCEL` |
| `SENSOR_FAIL 0` | `verifyPassword()` gagal — wiring 3.3V / TX-RX salah. Firmware **tidak** lock di `while(1)`, tetap menerima perintah |
| `ENROLLING <id>` | Enroll dimulai |
| `PLACE <id>` | Minta jari ditempel (dikirim 2x: sampel 1 dan 2) |
| `REMOVE` | Minta jari diangkat sebelum sampel kedua |
| `MATCH <id> <confidence>` | Jari cocok saat pemindaian bebas (1:N) |
| `NOMATCH` | Jari terbaca tetapi tidak cocok dengan slot mana pun |

### Yang TIDAK ada di firmware

- **Tidak ada perintah `VERIFY`.** Pemindaian berjalan terus-menerus di `loop()`: setiap kali ada jari menempel, firmware langsung `fingerSearch()` 1:N lalu mengirim `MATCH`/`NOMATCH`. Tidak ada timeout sesi, tidak ada target slot.
- **Tidak ada event `ERROR:<sebab>`.** Timeout 15 detik hanya berlaku internal di `ENROLL` dan jendela `CARD`.
- **Tidak ada `DELETE_ALL` bernama lain** — gunakan `CLEAR`.
- **Kartu tidak menyimpan identitas siswa di dalam kartu.** `rfid_cards (uid, student_id)` di Supabase adalah satu-satunya pemetaan; firmware hanya melaporkan UID mentah.

Konsekuensi desain: **gerbang sesi 2FA harus hidup di face service**, bukan di firmware. Face service yang menyimpan kandidat wajah + slot yang diharapkan + TTL, lalu mencocokkan event `MATCH` yang datang.

## Proses Enrollment Template

1. Operator menekan enroll fingerprint untuk `student_id` tertentu di halaman Students.
2. Face service menentukan slot kosong (atau slot lama milik siswa itu) dalam rentang 1..200.
3. Face service kirim `ENROLL <slot>` via USB Serial.
4. Balasan `ENROLLING <slot>` → UI masuk status menunggu.
5. `PLACE <slot>` → siswa tempel jari; `REMOVE` → angkat; `PLACE <slot>` → tempel ulang.
6. Sukses: `ENROLL_OK <slot> 0` → face service `PATCH /api/students/{id}` (`fingerprint_slot`, `fingerprint_status = 'enrolled'`).
7. Gagal: `ENROLL_FAIL <slot> <kode>` → UI tampilkan kode + tombol ulangi. Kode = kode error library `Adafruit_Fingerprint` (`FINGERPRINT_*`).
8. Hapus siswa / reset biometrik: `DELETE <slot>` → `DELETE_OK`, lalu kosongkan `fingerprint_slot`.

**Blocking:** selama `ENROLL`, `loop()` tertahan sampai `enrollFinger()` selesai (maks ±2×15 detik) sehingga perintah lain (termasuk `PING`) antre. Absensi tidak bisa berjalan bersamaan dengan enrollment — satu laptop, satu siswa.

## Proses Enrollment Kartu RFID

1. Operator membuka `/students/enroll`, isi `student_id`, tekan **Daftarkan Kartu RFID** (atau **Tambah Kartu Lain** bila sudah ada).
2. `POST /api/rfid/enroll` → face service `POST /rfid/enroll` → firmware `CARD` → `CARDWAIT`; jendela 15 detik terbuka.
3. Siswa menempelkan kartu. Firmware kirim `CARD_OK <UID>`, jendela tertutup.
4. UI polling `GET /api/rfid/enroll/status?student_id=…` tiap 700 ms; saat `stage=done, ok=true`, Route Handler:
   - cek `rfid_cards.uid` belum dipakai siswa lain (kalau dipakai → `409`, tidak menimpa),
   - `upsert rfid_cards (uid, student_id)` — satu siswa boleh punya banyak kartu.
5. Daftar kartu tampil di kartu "Langkah 2 (alternatif)"; tombol hapus memanggil `DELETE /api/rfid/cards?uid=…`.
6. Jendela habis tanpa kartu → `CARD_TIMEOUT`; UI menampilkan "Kartu tidak tertangkap dalam 15 detik. Ulangi."

Kartu **menggantikan** sidik jari sebagai faktor kedua, bukan menambah faktor ketiga: absensi sah bila wajah cocok **dan** (slot jari cocok **atau** UID terikat cocok).

## Alur Pencocokan Sidik Jari (Mode Absensi)

1. Face service mengenali wajah (YuNet live + SFace 1x, anti-stale: IoU + TTL) dan mengunci `student_id` + `fingerprint_slot` yang diharapkan dan daftar `uids` kartu terikat untuk sesi 30 detik.
2. Faktor kedua = **jari ATAU kartu**. Firmware, tanpa diminta, terus memindai jari sekaligus kartu:
   - jari → `MATCH <slot> <confidence>` / `NOMATCH`;
   - kartu → `CARD <UID>` (selalu dikirim saat kartu menempel, di dalam maupun di luar sesi).
3. Face service mencocokkan event dengan sesi aktif:
   - `MATCH` dengan `<slot>` == slot siswa terkunci → **2FA sah** (`method = fingerprint`).
   - `CARD` dengan `<UID>` terdaftar untuk siswa terkunci → **2FA sah** (`method = rfid`, `matched_uid`).
   - `MATCH` dengan slot lain / `CARD` milik siswa lain → **2FA gagal** (wajah ≠ faktor kedua), catat audit.
   - `NOMATCH` → gagal, siswa boleh ulangi (sesi masih hidup sampai TTL).
   - Tidak ada event sampai TTL habis → sesi `expired`.
5. Setelah hasil final dikirim ke cloud dan tersimpan, face service kirim `LED_OK` → `LED_DONE` sebagai umpan balik hijau.
6. Face service mengirim 1 hasil final ke Route Handler (`POST /api/attendance`):
   ```json
   {
     "device_id": "class-pc-01",
     "student_id": "STD-2024-001",
     "face_confidence": 0.71,
     "fingerprint_slot": 12,
     "fingerprint_score": 180,
     "captured_at": "2026-10-20T07:01:22+07:00"
   }
   ```

**Risiko yang harus ditangani driver:** pemindaian bebas berarti jari siapa pun yang menempel kapan pun memicu `MATCH`. Bila tidak ada sesi aktif, event wajib **dibuang** (bukan dicatat sebagai absensi). Sebaliknya, `MATCH` yang tiba sebelum sesi dibuka (mis. jari sudah menempel duluan) harus diabaikan agar tidak terjadi pemasangan slot yang salah.

## Penanganan Kasus Khusus

| Kondisi | Penanganan |
|---|---|
| Template tidak cocok | `NOMATCH`; sesi tetap hidup sampai TTL; siswa ulangi |
| Tidak ada jari sampai TTL (30 dtk) | Face service tandai `expired`; tanpa pengiriman cloud |
| Wajah siswa A, jari siswa B | `MATCH` slot ≠ slot siswa A → tolak + log audit |
| Event `MATCH` tanpa sesi aktif | Buang (bukan absensi) |
| Slot belum terdaftar untuk siswa | Jangan buka sesi 2FA; arahkan ke enrollment dulu |
| Kabel USB terlepas | `pyserial` `SerialException` → status serial `disconnected`; auto-reconnect saat dicolok ulang |
| `SENSOR_FAIL 0` saat boot | Tandai sensor error; cek wiring 3.3V + TX/RX; ESP32 tetap menerima `PING` |
| Sensor error saat pindai (`getImage` ≠ OK) | Firmware diam (tidak kirim event); face service hanya melihat TTL habis |
| Enroll gagal di tengah | `ENROLL_FAIL <slot> <kode>`; slot tidak tersimpan; ulangi dari awal |
| Kartu belum terdaftar untuk siswa | `CARD` dibuang (tidak ada di `uids` sesi); arahkan ke enrollment kartu di `/students/enroll` |
| Kartu terikat siswa lain | Tolak + log audit (sama seperti slot jari milik siswa lain) |
| Dua kartu menempel berdekatan | Debounce firmware 2 dtk per UID; event pertama yang dipakai sesi |
| Reader RC522 tidak terpasang | `RFID_FAIL 0` saat boot; `CARD` → `CARD_FAIL 0`; jalur sidik jari tetap normal |
| UID kartu sudah dipakai siswa lain saat enroll | Route Handler menolak `409` (`kartu <uid> sudah terdaftar untuk siswa <X>`) — tidak menimpa diam-diam |

## Diagram Flowchart

### Alur Lengkap (Face + Fingerprint 2FA)

```mermaid
flowchart TB
    A[Wajah dikenali SFace] --> B[Kunci sesi lokal 30 dtk<br/>student_id + slot diharapkan]
    B --> C[Siswa tempel jari]
    C --> D{Firmware scan 1:N<br/>kirim MATCH / NOMATCH}
    D -- MATCH slot sama --> E[2FA sah]
    D -- MATCH slot lain --> F[Tolak: wajah beda jari]
    D -- NOMATCH --> G[Tolak: coba lagi]
    B -. TTL habis tanpa event .-> H[Sesi expired]
    E --> I[POST final ke Route Handler]
    I --> J[LED_OK ke ESP32]
```

### Alur Sesi 2FA (Pencocokan Event Serial)

Rincian penanganan event serial per sesi yang disepakati pada diskusi:

```mermaid
flowchart LR
    A[Wajah terkunci<br/>kandidat + slot + TTL 30d] --> B{Siswa tempel jari}
    B --> C[Event MATCH slot X datang]
    C --> D{X == slot kandidat?}
    D -- Ya --> E[Sah → POST /api/attendance → LED_OK]
    D -- Beda --> F[Gagal: wajah ≠ jari]
    C -. tanpa sesi aktif .-> G[Dibuang]
```

## Keamanan dan Batasan

- Template sidik jari tidak pernah keluar dari sensor sebagai citra.
- Komunikasi serial hanya lewat kabel USB lokal di dalam ruangan kelas — tidak terpapar ke jaringan sekolah / internet.
- Tanpa tabel antrian cloud: tidak ada `device_commands` yang bisa di-intercept atau tersisa macet di database.
- Akses enrollment dibatasi untuk operator terautentikasi; `CLEAR` bersifat destruktif dan wajib konfirmasi ganda.
- Pemindaian bebas berarti sensor menerima jari siapa pun yang menempel; keputusan menerima/menolak **selalu** di face service + Route Handler, bukan di firmware.

## Fallback ke Wi-Fi Polling

Bila di lokasi fisik kabel USB tidak sampai ke meja absensi, beralihlah ke firmware Wi-Fi polling di [`archive/wifi-polling/fingerprint.md`](archive/wifi-polling/fingerprint.md). Firmware ESP32 cukup diganti dari sketch Serial ke sketch HTTP polling; antarmuka ke R503 tetap sama.

## Implementasi (2026-11-02, branch `feat/fingerprint-serial-bridge`)

| Lapisan | File | Status |
|---|---|---|
| Driver serial | `apps/face-service/fingerprint_serial.py` (`FingerprintBridge`) | ✅ Uji firmware palsu: 13 cek lolos |
| API lokal | `server.py`: `GET /fingerprint/status`, `POST /fingerprint/enroll` → 202 lalu polling `GET /fingerprint/enroll/status`, `DELETE /fingerprint/{slot}`, sesi 2FA (`POST/GET/DELETE /fingerprint/session`) | ✅ Smoke TestClient lolos |
| Proxy Next | `apps/web/src/app/api/fingerprint/*` — enroll mengalokasikan slot terkecil bebas (1..200), tandai `pending`, sukses → `enrolled`; gagal pada slot baru → rollback `DELETE` + `not_enrolled` | ✅ Smoke E2E lewat Chromium, DB terverifikasi |
| UI enroll | `/students/enroll` langkah 2 "Daftarkan Sidik Jari" (polling 700 ms + hitung mundur) | ✅ Terverifikasi di Chromium |
| UI kiosk | `/camera`: wajah cocok + `fingerprint_slot` → sesi dibuka otomatis; panel `waiting/verified/failed/expired` | ⚠️ Render OK; alur penuh butuh webcam + sensor nyata |
| Test abadi | `apps/face-service/test_fingerprint_bridge.py` — `main()` (driver, 13 cek) + `check_api()` (HTTP, 4 cek) | — |

Belum dikerjakan (menunggu keputusan/hardware): `POST /api/attendance` dari kiosk saat `verified`, `LED_OK` setelah absensi tercatat, tombol `CLEAR` destruktif di UI.

> Lihat juga: [cara-kerja-2fa.md](cara-kerja-2fa.md) — cara kerja pencocokan wajah dengan sidik jari R503.
