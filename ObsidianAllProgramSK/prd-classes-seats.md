# PRD Menu 4 — Classes & Seats

## 1. Fungsi Menu

Manajemen data kelas dan monitoring telemetri okupansi kursi berbasis sensor load cell (via HX711 pada ESP32). Data okupansi adalah telemetri sensor murni — bukan bukti kehadiran siswa.

## 2. Entitas Data yang Ditampilkan

1. **Data Kelas (Classes)**:
   - Class ID, nama kelas, tingkat, tahun ajaran, kapasitas.

2. **Telemetri Okupansi Kursi (SeatStatus)**:
   - Seat ID, status okupansi (`occupied` / `empty` / `unknown`), berat terbaca (kg), timestamp pembacaan terakhir.
   - Device ID sensor yang melaporkan kursi.

3. **Riwayat Okupansi (SeatEvents)**:
   - Perubahan status per kursi: status lama → status baru, timestamp.

4. **Ringkasan Okupansi Kelas**:
   - Total kursi, occupied, empty, sensor warning, sensor error.
   - Indikator data basi (stale) bila perangkat berhenti melapor melewati ambang batas.

## 3. Sumber Data & Aliran Event

- Query Route Handler (`GET /api/classes/{id}/seats`) untuk denah kursi & status terkini per kelas.
- Realtime `seat_status` UPDATE memperbarui status kursi individual secara real-time.
- Riwayat perubahan (SeatEvents) diambil via Route Handler paginasi per kursi.

## 4. Aturan Logika Sistem

1. Status `occupied` tidak dipetakan ke siswa mana pun — arsitektur tidak merancang relasi seat↔student.
2. Data okupansi dan data kehadiran di Menu Attendance diperlakukan sebagai entitas independen.
3. Pembacaan di bawah ambang batas → `empty`; di atas ambang → `occupied`; pembacaan tidak wajar atau sensor tidak merespons → `unknown`.
4. Data basi (perangkat tidak melapor dalam ambang batas) diberi indikator stale, bukan dianggap valid.
5. Fluktuasi di sekitar ambang batas diredam mekanisme histeresis di firmware/Route Handler sebelum status dikirim.

## 5. Aksi Pengguna

- Memilih kelas aktif dari daftar.
- Memilih kursi individual untuk melihat detail telemetri & riwayat okupansi.
- Konfigurasi kursi (Admin): tambah/pindah sensor, assign device ke kursi.
- Tandai kursi bermasalah untuk inspeksi.

## 6. Keadaan Sistem yang Ditangani

- Pemuatan denah kursi (loading state).
- Kelas tanpa kursi terpantau (empty state).
- Kegagalan query REST (error + retry).
- Sensor `unknown` / disconnected (indikator + penyebab).
- Data basi (penanda stale + timestamp pembacaan terakhir).
- Koneksi Realtime putus (auto-reconnect bawaan Supabase + sinkronisasi REST ulang).
