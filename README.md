# Smart Classroom Attendance — Sistem Absensi Otomatis dan Monitoring Kehadiran Siswa

> **Rancangan / Prototipe** — Dokumentasi ini menggambarkan arsitektur yang direncanakan untuk prototipe Hybrid AIoT dengan sekitar 100 siswa. Fitur yang belum diimplementasikan ditandai dengan `TBD` atau `Belum diimplementasikan`.

![Python](https://img.shields.io/badge/Python%203.11-3776AB?logo=python&logoColor=white) ![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white) ![OpenCV](https://img.shields.io/badge/OpenCV%20YuNet%20SFace-5C3EE8?logo=opencv&logoColor=white) ![NestJS](https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white) ![Next.js](https://img.shields.io/badge/Next.js-black?logo=next.js&logoColor=white) ![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black) ![ESP32](https://img.shields.io/badge/ESP32%20R503%20HX711-E7352C?logo=espressif&logoColor=white)

## Deskripsi Singkat

Smart Classroom Attendance adalah sistem absensi otomatis berbasis **verifikasi dua faktor biometrik** (wajah + sidik jari) yang dikombinasikan dengan **monitoring okupansi kursi** menggunakan load cell. Sistem dirancang untuk menggantikan absensi manual dengan pencatatan yang lebih akurat, terverifikasi, dan terekam otomatis ke database.

**Tujuan utama:**

1. Mencegah absensi palsu (titip absen) melalui verifikasi ganda wajah dan fingerprint.
2. Mencatat kehadiran siswa secara otomatis dan konsisten ke database.
3. Menyediakan dashboard monitoring kehadiran dan status kursi secara real-time.
4. Berjalan tanpa perubahan pada router atau Wi-Fi sekolah (semua perangkat berkomunikasi keluar melalui internet).

## Fitur Utama

| Fitur | Teknologi | Status |
|---|---|---|
| Deteksi wajah | OpenCV YuNet | Rancangan |
| Pengenalan wajah (embedding & pencocokan) | OpenCV SFace | Rancangan |
| Service pengenalan wajah lokal | Python 3.11 + FastAPI | Rancangan |
| Verifikasi identitas kedua | ESP32 + sensor fingerprint R503 | Rancangan |
| Monitoring okupansi kursi | Load cell + HX711 + ESP32 | Rancangan |
| Backend pusat (validasi & pencatatan) | NestJS | Rancangan |
| Database | PostgreSQL | Rancangan |
| Dashboard monitoring | Next.js + React | Rancangan |
| Pembaruan real-time dashboard | WebSocket | Rancangan |

## Tech Stack

| Lapisan | Teknologi | Peran |
|---|---|---|
| Pengenalan wajah | Python 3.11, OpenCV (YuNet, SFace) | Deteksi wajah, ekstraksi embedding, pencocokan identitas |
| Service lokal | FastAPI | REST API lokal untuk capture dan recognize |
| Backend utama | NestJS | Validasi identitas, aturan absensi, pencatatan |
| Database | PostgreSQL | Penyimpanan data siswa, absensi, status kursi |
| Dashboard | Next.js, React | Monitoring kehadiran dan status kursi |
| Perangkat IoT | ESP32 | Integrasi sensor fingerprint R503 dan load cell HX711 |
| Komunikasi | HTTPS REST API, HTTP polling, WebSocket | Antarservice, backend-perangkat, update dashboard |

## Arsitektur Sistem (Ringkas)

```
┌─────────────────┐      ┌──────────────────┐
│  Komputer Kelas  │      │  ESP32 (Kelas)   │
│  Webcam +        │      │  Fingerprint R503│
│  FastAPI lokal   │      │  Load cell+HX711 │
└────────┬────────┘      └────────┬─────────┘
         │ HTTPS (keluar)          │ HTTP polling (keluar)
         ▼                         ▼
      ┌──────────────────────────────┐
      │      Backend NestJS (online) │
      │  Validasi + aturan absensi   │
      └───────┬──────────────┬───────┘
              ▼              ▼
        ┌──────────┐   ┌──────────────┐
        │PostgreSQL│   │Dashboard     │
        │          │◄──│Next.js (WS)  │
        └──────────┘   └──────────────┘
```

Penjelasan lengkap: [docs/architecture.md](ObsidianAllProgramSK/docs/architecture.md).

## Flow Utama Absensi Siswa

1. Webcam pada komputer kelas menangkap frame berisi wajah siswa.
2. Service FastAPI lokal mendeteksi wajah (YuNet) dan mengekstrak embedding (SFace).
3. Embedding dicocokkan dengan data siswa terdaftar; jika cocok, kandidat identitas dikirim ke NestJS.
4. Backend mengatur verifikasi fingerprint melalui ESP32 + sensor R503.
5. ESP32 mengirimkan hasil verifikasi (ID template yang cocok) ke backend.
6. Backend memastikan identitas wajah dan fingerprint adalah siswa yang sama.
7. Jika verifikasi berhasil dan aturan absensi terpenuhi, absensi disimpan ke PostgreSQL.
8. Dashboard Next.js menerima pembaruan status melalui WebSocket.

Detail: [docs/face-recognition.md](ObsidianAllProgramSK/docs/face-recognition.md), [docs/fingerprint.md](ObsidianAllProgramSK/docs/fingerprint.md), [docs/backend.md](ObsidianAllProgramSK/docs/backend.md), [docs/communication-flow.md](ObsidianAllProgramSK/docs/communication-flow.md).

## Flow Monitoring Kursi

1. Load cell melalui HX711 membaca berbeban pada kursi.
2. ESP32 melakukan kalibrasi (tare) dan konversi nilai mentah menjadi berat.
3. Berat dibandingkan dengan ambang batas untuk menentukan status kursi (kosong / terisi / `TBD`).
4. Status dikirim ke backend NestJS secara berkala (HTTP polling).
5. Backend mencatat perubahan status dan mengirimkannya ke dashboard melalui WebSocket.

> **Catatan penting:** kursi kosong **tidak** otomatis berarti siswa tidak hadir. Status kursi perlu dikorelasikan dengan catatan absensi dan aturan waktu. Detail: [docs/iot-monitoring.md](ObsidianAllProgramSK/docs/iot-monitoring.md).

## Struktur Dokumentasi

```
smart-classroom-attendance/
├── README.md                     ← halaman ini
└── ObsidianAllProgramSK/
    └── docs/
        ├── architecture.md          # Arsitektur keseluruhan sistem
        ├── face-recognition.md      # Pengenalan wajah (YuNet + SFace + FastAPI)
        ├── fingerprint.md           # Verifikasi fingerprint (ESP32 + R503)
        ├── iot-monitoring.md        # Monitoring kursi (load cell + HX711)
        ├── backend.md               # Backend pusat NestJS
        ├── database.md              # Rancangan data PostgreSQL
        ├── dashboard.md             # Dashboard Next.js
        └── communication-flow.md    # Komunikasi antarkomponen
```

| Dokumen | Isi |
|---|---|
| [architecture.md](ObsidianAllProgramSK/docs/architecture.md) | Komponen, tanggung jawab, diagram arsitektur dan sequence |
| [face-recognition.md](ObsidianAllProgramSK/docs/face-recognition.md) | Detail pengenalan wajah, enrollment, threshold, endpoint konseptual |
| [fingerprint.md](ObsidianAllProgramSK/docs/fingerprint.md) | ESP32 + R503, enrollment template, alur pencocokan |
| [iot-monitoring.md](ObsidianAllProgramSK/docs/iot-monitoring.md) | Load cell + HX711, kalibrasi, status kursi |
| [backend.md](ObsidianAllProgramSK/docs/backend.md) | NestJS, validasi, aturan absensi, idempotensi, WebSocket |
| [database.md](ObsidianAllProgramSK/docs/database.md) | Entitas PostgreSQL, relasi, indeks, pencegahan duplikat |
| [dashboard.md](ObsidianAllProgramSK/docs/dashboard.md) | Halaman monitoring, integrasi REST + WebSocket |
| [communication-flow.md](ObsidianAllProgramSK/docs/communication-flow.md) | Pola komunikasi antarkomponen, retry, autentikasi |

## Status Pengembangan

| Tahap | Status |
|---|---|
| Perancangan arsitektur | Selesai (dokumen ini) |
| Implementasi service pengenalan wajah | Belum dimulai |
| Implementasi backend NestJS | Belum dimulai |
| Implementasi dashboard Next.js | Belum dimulai |
| Firmware ESP32 (fingerprint & load cell) | Belum dimulai |
| Deployment dan pengujian lapangan | Belum dimulai |

## Catatan Kebutuhan Perangkat dan Keamanan

**Kebutuhan perangkat (rancangan awal):**

- Komputer kelas dengan webcam dan CPU mampu menjalankan pengenalan wajah berbasis CPU (Python 3.11 + OpenCV).
- ESP32 + sensor fingerprint R503 untuk verifikasi sidik jari.
- ESP32 + load cell + modul HX711 untuk monitoring kursi.
- Koneksi internet keluar dari jaringan sekolah (tanpa perubahan router/Wi-Fi).

**Keamanan:**
- Data biometrik (embedding wajah, template fingerprint) disimpan sebagai representasi matematis, bukan citra mentah.
- Akses data biometrik dibatasi hanya untuk proses verifikasi; tidak diekspos ke dashboard atau pengguna umum.
- Komunikasi aplikasi ke backend menggunakan HTTPS.
- Perangkat ESP32 menggunakan device ID + kredensial untuk autentikasi, bukan alamat IP lokal.
- Jangan menyimpan kredensial, token, password, atau data biometrik asli dalam dokumentasi atau repository.
