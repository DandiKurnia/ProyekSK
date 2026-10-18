# PRD Menu 5 — Device Monitoring

## 1. Fungsi Menu

Monitoring kesehatan dan konektivitas seluruh perangkat fisik yang melapor ke backend NestJS, termasuk inspeksi antrian perintah verifikasi yang berjalan. Komputer face recognition lokal diperlakukan sebagai layanan lokal yang melaporkan status ke backend (backend tidak mengakses endpoint localhost-nya secara langsung).

## 2. Entitas Data yang Ditampilkan

1. **Perangkat Terdaftar (Devices)**:
   - Device ID, nama, tipe (`face_computer` / `fingerprint_esp32` / `seat_esp32`), kelas terkait, status kredensial, status online/offline.
   - Last heartbeat, last successful communication, last data update.
   - Contoh perangkat: `CLASS-A-FACE-01`, `CLASS-A-FP-01`, `CLASS-A-SEAT-01`.

2. **Antrian Perintah (Commands)**:
   - `command_id`, tipe perintah (mis. `fingerprint_verify`), status (`queued` / `picked_up` / `awaiting_result` / `completed` / `expired`), `created_at`, device target.

3. **Event Error Perangkat**:
   - Jenis: `no_match`, `timeout`, `sensor_error`, `connection_failed`.
   - Timestamp kejadian + detail penyebab (sesuai laporan perangkat).

4. **Reading Sensor (bila relevan)**:
   - Berat terakhir kursi (ESP32 kursi) atau skor kecocokan terakhir (ESP32 fingerprint) — angka numerik, tanpa biometrik mentah.

5. **Riwayat Konektivitas**:
   - Timeline peristiwa online/offline per perangkat.

6. **Ringkasan Kesehatan**:
   - Total perangkat, online, offline, device with warnings.

> Catatan: backend NestJS bukan perangkat; kesehatannya ditampilkan sebagai indikator koneksi sistem di header global, bukan di daftar perangkat.

## 3. Sumber Data & Aliran Event

- Query REST API untuk daftar perangkat, detail per perangkat, antrian perintah, dan riwayat konektivitas.
- Event WebSocket `device.offline` mengubah status perangkat dan memicu notifikasi peringatan.

## 4. Aturan Logika Sistem

1. Perangkat dinyatakan offline bila tidak ada heartbeat/polling dalam ambang batas (dikonfigurasi di Menu Settings).
2. Perintah yang tidak dijawab hingga batas waktu ditandai `expired` oleh backend.
3. Hasil perintah deduplikasi berdasarkan `command_id` (idempotensi).
4. Identitas perangkat berbasis device ID + kredensial, bukan alamat IP lokal.
5. Perangkat bermasalah (offline/warning) diurutkan lebih atas pada daftar.

## 5. Aksi Pengguna

- Melihat detail perangkat (metadata, status, antrian, error, riwayat).
- Mengirim perintah uji konektivitas (Admin, `TBD` di arsitektur backend).
- Rotasi kredensial perangkat (Admin, tampilkan secret baru sekali saja).
- Menonaktifkan perangkat (Admin, konfirmasi destruktif).
- Menandai perangkat untuk inspeksi fisik.

## 6. Keadaan Sistem yang Ditangani

- Pemuatan daftar perangkat (loading state).
- Tidak ada perangkat terdaftar (empty state).
- Kegagalan query REST (error + retry).
- Perangkat offline (indikator + timestamp terakhir terlihat + penyebab bila dilaporkan).
- Antrian perintah menumpuk (indikator backlog + jumlah expired).
