# PRD Menu 6 — Reports

## 1. Fungsi Menu

Agregasi data historis absensi dan telemetri okupansi untuk satu periode, dengan kemampuan ekspor. Menu ini hanya menampilkan agregasi yang didukung data aktual — tanpa analitik prediktif.

## 2. Entitas Data yang Ditampilkan

1. **Ringkasan Periode**:
   - Attendance rate (% kehadiran terhadap total siswa aktif).
   - Jumlah `Present`, `Late` (terpisah), `Absent`, `Pending`, `Failed`, `Expired`.

2. **Tren Kehadiran**:
   - Serie present vs absent per hari dalam rentang tanggal aktif.

3. **Rekap Harian**:
   - Tabel per tanggal: jumlah present, late, absent, attendance rate.

4. **Tren Okupansi Kursi**:
   - Rata-rata okupansi per hari (dihitung dari SeatEvents).
   - Bila data SeatEvents tidak tersedia untuk periode tersebut, tampilkan empty state — bukan estimasi.

5. **Log Konektivitas Perangkat**:
   - Per perangkat dalam periode: jumlah event offline, uptime %, timestamp kejadian.
   - Ditampilkan sebagai log mentah — skor "reliability" `TBD` di arsitektur.

6. **Ekspor**:
   - Export CSV: data tabel sesuai filter aktif.
   - Download Report: ringkasan + visualisasi agregat (`TBD` format PDF/CSV).
   - Nama file mengandung kelas + rentang tanggal.

## 3. Sumber Data & Aliran Event

- Query REST API agregasi (dilakukan di backend, bukan di sisi klien).
- Filter: rentang tanggal, kelas. Perubahan filter memicu query ulang.
- Halaman ini read-mostly; tidak berlangganan WebSocket real-time.

## 4. Aturan Logika Sistem

1. Status `Late` selalu dipisah dari `Present` di seluruh agregasi.
2. Agregasi dilakukan backend; antarmuka hanya menampilkan hasil.
3. Tidak ada prediksi, skor risiko, atau kesimpulan yang tidak didukung data.
4. Ekspor hanya tersedia untuk Admin dan Teacher (sesuai matriks akses di `prd-index.md`).
5. Preview periode harus tampil sebelum aksi ekspor diaktifkan.

## 5. Aksi Pengguna

- Memilih rentang tanggal dan kelas.
- Melihat preview ringkasan periode.
- Export CSV / Download Report.
- Melihat detail per tanggal / per perangkat.

## 6. Keadaan Sistem yang Ditangani

- Pemuatan agregasi (loading state blok data).
- Periode tanpa data (empty state).
- Kegagalan query REST (error + retry).
- Ekspor volume besar (indikator progres `TBD`).
- Tren okupansi tanpa data SeatEvents (empty state + penjelasan).
