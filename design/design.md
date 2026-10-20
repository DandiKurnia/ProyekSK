web application/stitch/projects/7446102472613027629/screens/4905167122673619745

---

name: AICI Smart Classroom AIoT Admin Dashboard

description: Unified Bento Grid &amp; Tonal Elevation design system for AICI (Artificial Intelligence Center Indonesia) Hybrid AIoT Student Attendance and Smart Classroom Telemetry.

colors:

  primary: "#CBF34D"

  secondary: "#A5B4FC"

  tertiary: "#CFD5FA"

  background: "#F4F5F7"

  surface: "#FFFFFF"

  surface-nested: "#F8F9FB"

  text-primary: "#111827"

  text-secondary: "#6B7280"

  border: "#F3F4F6"

  success: "#16A34A"

  success-bg: "#DCFCE7"

  warning: "#F59E0B"

  warning-bg: "#FEF3C7"

  error: "#EF4444"

  error-bg: "#FEE2E2"

typography:

  h1:

    fontFamily: "Plus Jakarta Sans, Inter, sans-serif"

    fontSize: 1.375rem

    fontWeight: 700

    lineHeight: 1.3

    letterSpacing: -0.01em

  h2:

    fontFamily: "Plus Jakarta Sans, Inter, sans-serif"

    fontSize: 1rem

    fontWeight: 600

    lineHeight: 1.4

  kpi-display:

    fontFamily: "Plus Jakarta Sans, Inter, sans-serif"

    fontSize: 1.875rem

    fontWeight: 700

    lineHeight: 1.2

  body-md:

    fontFamily: "Plus Jakarta Sans, Inter, sans-serif"

    fontSize: 0.875rem

    fontWeight: 400

    lineHeight: 1.5

  label-sm:

    fontFamily: "Plus Jakarta Sans, Inter, sans-serif"

    fontSize: 0.75rem

    fontWeight: 500

  mono-id:

    fontFamily: "JetBrains Mono, monospace"

    fontSize: 0.75rem

    fontWeight: 500

rounded:

  sm: 6px

  md: 8px

  lg: 12px

  xl: 16px

  full: 9999px

spacing:

  xs: 4px

  sm: 8px

  md: 16px

  lg: 20px

  xl: 24px

  2xl: 32px

components:

  button-primary:

    backgroundColor: "{colors.primary}"

    textColor: "{colors.text-primary}"

    rounded: "{rounded.lg}"

    padding: "10px 18px"

  card-bento:

    backgroundColor: "{colors.surface}"

    rounded: "{rounded.xl}"

    padding: "{spacing.lg}"

  card-nested:

    backgroundColor: "{colors.surface-nested}"

    rounded: "{rounded.lg}"

    padding: "14px"

  pill-filter:

    backgroundColor: "{colors.surface-nested}"

    activeBackgroundColor: "{colors.primary}"

    textColor: "{colors.text-primary}"

    rounded: "{rounded.full}"

    padding: "6px 14px"

---

## Overview

AICI (Artificial Intelligence Center Indonesia) Smart Classroom Dashboard menggabungkan estetika Bento Grid modern dengan tonal elevation untuk memantau kehadiran peserta pelatihan/siswa secara real-time berbasis verifikasi biometrik 2 faktor (Wajah via Edge PC FastAPI + Sidik Jari via ESP32 R503) serta telemetri okupansi kursi fisik (ESP32 + Load Cell HX711).

## Institutional Identity

- \*\*Nama Lembaga:\*\* AICI (Artificial Intelligence Center Indonesia)

- \*\*Karakter Antarmuka:\*\* Bersih, berfokus pada efisiensi operasional pusat pelatihan AI, mengusung standar tata kelola teknologi tinggi yang intuitif.

## Architectural &amp; Privacy Rules in UI

1. \*\*Biometric Privacy:\*\* Antarmuka web tidak merender foto wajah mentah, vektor float 128-d, atau gambar sidik jari. Hanya menampilkan metadata (`Enrolled`/`Not Enrolled`, skor kemiripan SFace, dan slot R503).

2. \*\*Seat &amp; Identity Separation:\*\* Denah kursi (`/classes-seats`) hanya menampilkan status beban fisik (`Empty`, `Occupied`, `Unknown` dalam satuan `kg`) tanpa memetakan identitas peserta pelatihan/siswa.

3. \*\*Strict 6 Attendance Statuses:\*\* Seluruh status absensi wajib mengikuti 6 state resmi: `Present`, `Late`, `Pending`, `Failed`, `Expired`, dan `Absent`.

## Colors &amp; Contrast

- \*\*Primary Electric Lime (`#CBF34D`):\*\* Digunakan untuk KPI utama, tab aktif, kursi `Occupied`, dan CTA utama. Wajib selalu menggunakan teks gelap `#111827` (kontras \~12:1, lolos WCAG AAA).

- \*\*Secondary Soft Periwinkle (`#A5B4FC` / `#CFD5FA`):\*\* Digunakan untuk indikator rute aktif di sidebar kiri dan kartu sorotan sekunder.

- \*\*Tonal Hierarchy:\*\* Kanvas latar belakang `#F4F5F7`, kartu utama `#FFFFFF`, dan sub-kartu `#F8F9FB`.