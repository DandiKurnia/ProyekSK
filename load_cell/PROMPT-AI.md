# PROMPT-AI — template chat AI untuk sketsa **tes/kalibrasi offline HX711**

File ini BUKAN dokumentasi teknis. Ini template prompt yang disalin ke chat AI
mana pun (ChatGPT, Claude, Gemini, dsb) supaya teman yang bikin board **load cell
HX711 tahap tes** dapat sketsa yang benar tanpa perlu paham arsitektur proyek dulu.

⚠️ Sketsa jenis ini **TIDAK punya WiFi dan TIDAK mengirim ke Supabase**.
Murni tes lewat Serial Monitor: mencari faktor kalibrasi dan menguji
hysteresis state machine. Setelah faktor didapat, pakai firmware produksi
`esp32Seat_LoadCell/` yang sudah terhubung ke Supabase.

## Cara pakai: salin blok di bawah garis, tempel ke AI, kirim.

---

```
Saya membuat SKETSA TES OFFLINE (bukan produksi!) untuk load cell + HX711
di ESP32. Sketsa ini hanya membaca berat, menguji state machine kursi, dan
mencetak ke Serial Monitor. TANPA WiFi, TANPA HTTPS, TANPA Supabase.
Bantu saya bikin file .ino lengkap.

=== PIN & HARDWARE ===
- ESP32 DevKit
- HX711 VCC -> 3V3, GND -> GND
  DT / DOUT -> GPIO 19
  SCK / CLK -> GPIO 18
- Load cell 4 kabel: E+/E- (eksitasi, merah/hitam), A+/A- (sinyal, hijau/putih)
- Serial Monitor 115200 baud

=== DATA KONFIGURASI (diisi lewat #define di awal kode) ===
1. CALIBRATION_FACTOR : angka sementara, misal 1109.4 (akan disesuaikan saat kalibrasi)
2. Ambang prototipe beban contoh 30 gram:
   ZERO_DEADBAND_G = 3.0 (abaikan fluktuasi di sekitar nol)
   OCCUPIED_THRESHOLD_G = 20.0 (beban >= 20 g = terisi)
   EMPTY_THRESHOLD_G = 10.0 (beban <= 10 g mulai timer kosong)
   RECOVERY_THRESHOLD_G = 15.0 (beban >= 15 g batalkan timer kosong)
   OCCUPIED_CONFIRM_MS = 1000 (beban harus stabil 1 detik)
   ABSENCE_DELAY_MS = 5000 (kosong 5 detik = absen)

=== PERILAKU SISTEM LENGKAP ===
1. Boot:
   - Serial.begin(115200), delay(1000).
   - Cetak judul "=== TES LOAD CELL: ambang 30 g / absen 5 detik ===" dan peringatan
     "Pastikan load cell TIDAK diberi beban saat startup/tare."
   - loadCell.begin(19, 18), loadCell.set_scale(CALIBRATION_FACTOR).
   - Tunggu HX711 siap (wait_ready_timeout(1000)); bila gagal cetak
     "HX711 belum terbaca. Periksa VCC, GND, DT/DOUT, dan SCK/CLK." dan ulangi tiap 500ms.
   - delay(2000), lalu loadCell.tare(20) — kondisi tanpa beban = 0 gram.
   - Cetak "Tare selesai." + 2 baris aturan ambang + garis pembatas "-----".

2. Pembacaan berat:
   - loadCell.get_units(5) — rata-rata 5 sampel untuk redam noise.
   - Deadband: |gram| <= 3.0 -> jadikan 0.0.

3. State machine (enum SeatState: WAITING_FOR_LOAD, OCCUPIED, EMPTY_PENDING, ABSENT):
   - WAITING_FOR_LOAD / ABSENT -> gram >= 20 stabil 1 dtk: jadi OCCUPIED.
   - OCCUPIED -> gram <= 10: jadi EMPTY_PENDING (mulai timer).
   - EMPTY_PENDING -> gram >= 15: balik OCCUPIED (timer batal);
     timer 5 dtk habis: jadi ABSENT.
   - Teks status (fungsi stateText): "MENUNGGU BEBAN PERTAMA" / "TERISI" /
     "KOSONG SEMENTARA - TIMER 5 DETIK" / "ABSEN - BEBAN HILANG >= 5 DETIK".

4. Loop utama:
   - wait_ready_timeout(500); gagal -> "ERROR: HX711 tidak siap / tidak terbaca.", delay 300ms.
   - Baca berat -> updateSeatState -> cetak tiap 500ms format persis:
     "Berat: <x.x> g | Status: <teks>"
   - Bila EMPTY_PENDING, tambahkan " | Sisa timer: <x.x> detik".
   - delay(100) di akhir loop.

5. Library: hanya "HX711 Arduino Library" (bogde) + <Arduino.h> + <math.h>.
   JANGAN tambah WiFi, HTTP, JSON, atau Supabase — sketsa ini offline.

=== BANTU SAYA HASILKAN ===
1. File .ino lengkap yang bisa langsung diflash.
2. Cara mencari faktor kalibrasi dari log: tare kosong, beri beban yang massanya
   diketahui, hitung (raw_berbeban - raw_kosong) / massa_nyata.
   Contoh yang sudah teruji: (853728 - 660691) / 174 ~= 1109.4.
   Bila beban terbaca negatif, balik tanda faktornya.
3. Arti tiap baris log Serial Monitor.
```

---

## Cara mencari faktor kalibrasi (`CALIBRATION_FACTOR`)

1. Flash sketsa, buka Serial Monitor 115200.
2. **Tanpa beban** saat boot (tare otomatis menganggap kondisi kosong = 0).
3. Letakkan beban yang massanya diketahui (mis. 174 g).
4. Hitung: `(raw_berbeban − raw_kosong) / massa_nyata`.
   Teruji di meja: `(853728 − 660691) / 174 ≈ 1109.4`.
5. Nilai negatif saat dibebani → balik tanda (`-1109.4`).
6. Simpan ke `#define CALIBRATION_FACTOR` di firmware produksi `esp32Seat_LoadCell/`.

## Mesin status yang diuji sketsa ini

`WAITING_FOR_LOAD → OCCUPIED → EMPTY_PENDING → ABSEN` — sama persis dengan yang
dipakai firmware produksi. Kalau log offline-nya benar, versi Supabase-nya
tinggal menambah kirim HTTPS, logikanya tidak berubah.
