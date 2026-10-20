# PRD Menu 5 — Device Monitoring

## 1. Fungsi Menu

Monitoring kesehatan dan konektivitas perangkat: komputer kelas (FastAPI), ESP32 Fingerprint (terpantau lewat log/status USB di PC kelas), dan ESP32 Kursi (HTTPS Wi-Fi). Cloud menerima status perangkat tanpa perlu antrean polling command pada topologi USB.

## 2. Entitas Data yang Ditampilkan

1. **Perangkat Terdaftar (Devices)**:
   - Device ID, nama, tipe (`face_computer` / `fingerprint_esp32` / `seat_esp32`), kelas terkait, status kredensial, status online/offline.
   - Last heartbeat, last successful communication, last data update.
   - Contoh perangkat: `CLASS-A-FACE-01`, `CLASS-A-FP-01`, `CLASS-A-SEAT-01`.

2. **Status Serial Fingerprint (pengganti Antrian Perintah)**:
   - Status port COM (`COM5`/`/dev/ttyUSB0`), status koneksi (`connected`/`disconnected`), dan ringkasan VERIFY terakhir. Antrian cloud (`device_commands`, `command_id`) hanya aktif bila arsitektur memakai fallback Wi-Fi (`docs/archive/wifi-polling/`).
3. **Event Error Perangkat**:
   - Jenis: `no_match`, `timeout`, `sensor_error`, `connection_failed`.
   - Timestamp kejadian + detail penyebab (sesuai laporan perangkat).

4. **Reading Sensor (bila relevan)**:
   - Berat terakhir kursi (ESP32 kursi) atau skor kecocokan terakhir (ESP32 fingerprint) — angka numerik, tanpa biometrik mentah.

5. **Riwayat Konektivitas**:
   - Timeline peristiwa online/offline per perangkat.

6. **Ringkasan Kesehatan**:
   - Total perangkat, online, offline, device with warnings.

> Catatan: backend Next.js bukan perangkat; kesehatannya ditampilkan sebagai indikator koneksi sistem di header global, bukan di daftar perangkat.

## 3. Sumber Data & Aliran Event

- Query Route Handler Next.js (`/api/devices`) untuk daftar perangkat, detail per perangkat, status serial fingerprint, dan riwayat konektivitas.
- Realtime `devices` UPDATE mengubah status perangkat dan memicu notifikasi peringatan.

## 4. Aturan Logika Sistem

1. Perangkat dinyatakan offline bila tidak ada heartbeat/laporan dalam ambang batas (dikonfigurasi di Menu Settings).
2. ESP32 Kursi melapor via HTTPS outbound; ESP32 Fingerprint dipantau oleh face service PC lokal.
3. Idempotensi berbasis `(student_id, class_id, date)` di database; deduplikasi `command_id` hanya berlaku pada fallback Wi-Fi.
4. Identitas perangkat berbasis device ID + kredensial, bukan alamat IP lokal.
5. Perangkat bermasalah (offline/warning) diurutkan lebih atas pada daftar.

## 5. Aksi Pengguna

- Melihat detail perangkat (metadata, status, antrian, error, riwayat).
- Mengirim perintah uji konektivitas (Admin, `TBD` via `POST /api/devices/{id}/test`).
- Rotasi kredensial perangkat (Admin, tampilkan secret baru sekali saja).
- Menonaktifkan perangkat (Admin, konfirmasi destruktif).
- Menandai perangkat untuk inspeksi fisik.

## 6. Keadaan Sistem yang Ditangani

- Pemuatan daftar perangkat (loading state).
- Tidak ada perangkat terdaftar (empty state).
- Kegagalan query REST (error + retry).
- Perangkat offline (indikator + timestamp terakhir terlihat + penyebab bila dilaporkan).
- Antrian perintah menumpuk (hanya relevan pada fallback Wi-Fi polling).
