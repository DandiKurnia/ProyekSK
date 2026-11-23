# ObsidianAllProgramSK — Vault Dokumentasi Smart Classroom Attendance

Vault Obsidian berisi seluruh dokumen kerja proyek: spesifikasi produk (PRD), dokumen teknis, catatan harian, dan bahan pendukung. Ringkasan proyek + status implementasi ada di [README root](../README.md).

## Urutan Baca

1. [../README.md](../README.md) — gambaran sistem, stack, dan status pengembangan terkini.
2. [prd-index.md](prd-index.md) — hierarki menu web + indeks PRD per halaman.
3. [docs/architecture.md](docs/architecture.md) — topologi aktif (ESP32 via USB Serial ke PC kelas, cloud Next.js + Supabase).
4. Dokumen teknis sesuai kebutuhan (tabel di bawah).
5. [aturan-kerja.md](aturan-kerja.md) — aturan git, branch, dan port yang wajib dipatuhi setiap sesi.

## PRD Web (spesifikasi fungsional, bebas styling)

| Dokumen | Isi |
|---|---|
| [prd-index.md](prd-index.md) | Hierarki menu, filter global, pola realtime, indeks spesifikasi |
| [prd-auth.md](prd-auth.md) | Login, sesi, redirect, RBAC |
| [prd-overview.md](prd-overview.md) | KPI kehadiran, okupansi sensor, log verifikasi, kesehatan perangkat |
| [prd-attendance.md](prd-attendance.md) | Catatan kehadiran, filter, koreksi manual, export CSV |
| [prd-students.md](prd-students.md) | Data induk siswa, enrollment wajah & fingerprint |
| [prd-classes-seats.md](prd-classes-seats.md) | Kelas, denah kursi, telemetri load cell |
| [prd-devices.md](prd-devices.md) | Inventaris perangkat, heartbeat, inspeksi, rotasi kredensial |
| [prd-reports.md](prd-reports.md) | Agregasi periode, tren, okupansi, export |
| [prd-settings.md](prd-settings.md) | Pengaturan sistem, ambang batas, retensi data |
| [prd-admin-dashboard-full.md](prd-admin-dashboard-full.md) | Master PRD: aliran data, RBAC, exception, integrasi REST + Realtime |

## Dokumen Teknis (`docs/`)

| Dokumen | Isi |
|---|---|
| [architecture.md](docs/architecture.md) | Komponen, tanggung jawab, alur normal & kegagalan |
| [face-recognition.md](docs/face-recognition.md) | YuNet + SFace, enrollment, threshold |
| [fingerprint.md](docs/fingerprint.md) | ESP32 + R503 via USB Serial, template, pencocokan |
| [iot-monitoring.md](docs/iot-monitoring.md) | Load cell + HX711, kalibrasi, status kursi |
| [backend.md](docs/backend.md) | Route Handler Next.js, aturan absensi, idempotensi |
| [database.md](docs/database.md) | Skema PostgreSQL/Supabase, relasi, indeks |
| [dashboard.md](docs/dashboard.md) | Halaman web, integrasi REST + Realtime, status implementasi UI |
| [communication-flow.md](docs/communication-flow.md) | Pola komunikasi, retry, autentikasi |
| [cara-kerja-2fa.md](docs/cara-kerja-2fa.md) | Alur verifikasi 2FA wajah + sidik jari langkah demi langkah |
| [plan-absensi-2fa-pipeline.md](docs/plan-absensi-2fa-pipeline.md) | Rencana implementasi pipeline absensi 2FA |
| [code-face-engine.md](docs/code-face-engine.md) | Telaah kode `face_engine.py` |
| [code-main-py.md](docs/code-main-py.md) | Telaah kode `main.py` (FastAPI) |
| [code-test-yunet-box.md](docs/code-test-yunet-box.md) | Catatan uji bounding box YuNet |
| [code-komunikasi-r503.md](docs/code-komunikasi-r503.md) | Rantai kios R503: firmware `.ino` ↔ `fingerprint_serial.py` ↔ FastAPI, perintah & event baris |
| [code-attendance-routes.md](docs/code-attendance-routes.md) | Kode Next.js jalur kios: proxy `/api/fingerprint/session` + penulis `attendance` |
| [gerbang-ino-database.md](docs/gerbang-ino-database.md) | Gerbang .ino ke database: firmware -> gerbang Next.js/FastAPI -> tabel Supabase |
| [archive/](docs/archive/) | Versi lama (Wi-Fi polling via cloud) — fallback bila USB tidak memungkinkan |

## Catatan & Bahan Lain

| Path | Isi |
|---|---|
| [daily/](daily/) | Changelog harian: Apa → Kenapa → File terdampak → Status uji |
| [tasks/backlog-enrollment-sync.md](tasks/backlog-enrollment-sync.md) | Backlog sinkronisasi enrollment |
| [ppt-website-admin-dashboard.md](ppt-website-admin-dashboard.md) | Materi presentasi dashboard admin |
| [prompt-manual-book-claude.md](prompt-manual-book-claude.md) | Prompt penyusunan manual book |
| [print/](print/) | Salinan kode untuk dicetak (`face_engine`, `main`, `test_`) |
| [aturan-kerja.md](aturan-kerja.md) | Aturan wajib: izin commit/push, branch fitur, port & server latar |

## Konvensi Penulisan

- Status tiap klaim ditandai eksplisit: **Aktif**, **Rancangan**, **Belum diimplementasikan**, atau `TBD`.
- PRD tidak memuat aturan visual (warna, tipografi, tema); styling dibahas di `docs/dashboard.md`.
- Setiap perubahan kode dicatat di `daily/YYYY-MM-DD.md` pada hari yang sama.
- Jangan menulis kredensial, token, atau data biometrik asli ke dalam vault.
