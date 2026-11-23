# Komunikasi Kios R503 — USB Serial ↔ FastAPI ↔ Next.js

Rantai lengkap:

```
esp32R503_Serial.ino ──USB 115200──> apps/face-service (Python) ──HTTP──> Route Handler Next.js ──> Supabase
```

Kios ini **tidak punya Wi-Fi dan tidak bicara HTTP**. Firmwarenya hanya jembatan baris teks; FastAPI di laptop yang memegang port COM, menyimpan state sesi 2FA, lalu Route Handler Next.js yang memutuskan dan menulis `attendance`.

Kode Python (pemegang port COM): [python.md](../../esp32R503_Serial/python.md).

Protokol: satu baris per pesan, diakhiri `\n`, dua arah (`.ino:4–27`).

| Laptop → ESP32 | Balasan |
|---|---|
| `PING` (atau `m`) | `PONG <jumlah_template>` |
| `ENROLL <id>` | `ENROLLING <id>`, `PLACE <id>`, `REMOVE`, `ENROLL_OK <id> <kode>` / `ENROLL_FAIL <id> <kode>` |
| `DELETE <id>` | `DELETE_OK <id>` / `DELETE_FAIL <id> <kode>` |
| `CLEAR` (atau `c`) | `CLEAR_OK 0` / `CLEAR_FAIL <kode>` |
| `LED_OK` | `LED_DONE` (ring hijau, dipanggil setelah absensi tersimpan) |
| `CARD` | `CARDWAIT`, lalu `CARD_OK <UID>` / `CARD_TIMEOUT` (jendela 15 dtk) |
| `CANCEL` | menutup jendela kartu, hasil `CARD_TIMEOUT` |
| `LCD <baris1>\|<baris2>` | tanpa balasan |

| ESP32 → laptop (spontan) | Arti |
|---|---|
| `BOOT <versi>` | board baru menyala |
| `READY <n> [RFID <nama>]` | sensor siap (+ reader RFID terdeteksi) |
| `SENSOR_FAIL 0` | R503 tidak terdeteksi (wiring 3.3V / TX-RX) |
| `MATCH <slot> <confidence>` | jari cocok dengan template di slot itu |
| `NOMATCH` | jari tidak dikenali |
| `CARD <UID>` | kartu ditempel di luar jendela enroll |

---

## 1. Sisi firmware: kirim `kirim()` + `kirimKode()` (`:96–106`)

```cpp
// ---------- Utilitas Komunikasi USB Serial ke Laptop ----------
// Mengirim satu baris teks ke laptop (Python esp32_serial.py) dan memastikan buffer USB terkirim tuntas
void kirim(const String &baris) { // Satu-satunya jalan keluar pesan ke laptop
  Serial.println(baris);  // Kirim teks diakhiri newline ('\n') ke port USB (COM5)
  Serial.flush();         // Tunggu hingga seluruh byte benar-benar keluar dari buffer UART0
}

// Memformat pesan berformat "<PERINTAH> <id> <kode>" lalu mengirimkannya ke laptop
void kirimKode(const char *perintah, uint8_t id, uint8_t kode) { // Contoh: "ENROLL_OK 3 0"
  char buffer[48];        // Buffer sementara (cukup untuk perintah + 2 angka)
  snprintf(buffer, sizeof(buffer), "%s %u %u", perintah, id, kode); // Rakit string ke buffer
  kirim(buffer);          // Kirim ke laptop
}
```

## 2. Verifikasi jari: `verifikasi()` (`:181–212`)

Dipanggil tiap `loop()`. Non-blocking saat tidak ada jari; pencarian 1:N dilakukan di DSP sensor.

```cpp
void verifikasi() {                               // Cek jari tiap iterasi loop (non-blocking bila kosong)
  uint8_t p = finger.getImage();                      // Cek apakah ada jari di atas sensor
  if (p != FINGERPRINT_OK) return;                    // Kalau tidak ada jari, langsung keluar (non-blocking)

  p = finger.image2Tz();                              // Ekstrak titik minutiae jari ke CharBuffer1
  if (p != FINGERPRINT_OK) return;                    // Gambar kurang jelas: abaikan dan tunggu pembacaan berikutnya

  // Bandingkan CharBuffer1 terhadap seluruh template yang tersimpan di Flash R503 (pencarian 1:N di chip DSP sensor)
  p = finger.fingerSearch();                      // Cari di semua slot; hasil di finger.fingerID + confidence
  if (p == FINGERPRINT_OK) {                      // Ada yang cocok
    // Jari cocok dengan salah satu slot: kirim "MATCH <fingerID> <confidence>" ke Flask (esp32_serial.py)
    char buffer[48];                              // Buffer sementara pesan MATCH
    snprintf(buffer, sizeof(buffer), "MATCH %u %u", finger.fingerID, finger.confidence); // Rakit "MATCH <id> <skor>"
    kirim(buffer);                                // Kirim ke laptop
    ledHijau();                                   // Ring hijau: jari dikenali
    lcdTulis("Sidik jari OK", String("ID ") + finger.fingerID + " (" + finger.confidence + "%)"); // Tampilkan ID + skor
    delay(1000);                                     // Beri waktu membaca hasil di LCD
    ledMati();                                    // Matikan ring LED
  } else {                                        // Tidak ada slot yang cocok
    // Jari tidak ada di database sensor: kirim "NOMATCH" agar Flask langsung menolak tanpa menunggu 30 detik
    kirim("NOMATCH");                             // Kabari laptop: jari asing
    ledMerah();                                   // Ring merah 3x kedip
    lcdTulis("Tidak dikenali", "Coba lagi");      // Minta tempel ulang di LCD
    delay(1000);                                  // Beri waktu membaca pesan
    ledMati();                                    // Matikan ring LED
  }
  tungguJariAngkat();                                 // Wajib angkat jari dulu sebelum bisa memindai lagi
  delay(300);                                         // Debounce tambahan agar tidak memicu bacaan ganda
  lcdSiap();                                          // Kembali ke tampilan siaga setelah sidik selesai
}
```

## 3. Kartu RFID: `cekKartu()` (`:226–245`)

```cpp
void cekKartu() {                                 // Dipanggil tiap loop; keluar cepat bila tidak ada kartu
  if (!rfidSiap) return;                          // Reader tidak terdeteksi: lewati (fitur kartu nonaktif)
  if (!rfid.PICC_IsNewCardPresent()) return;    // Tidak ada kartu: keluar tanpa menyentuh SPI lagi
  if (!rfid.PICC_ReadCardSerial()) return;      // Gagal baca serial kartu
  String uid = uidKeString(&rfid.uid);            // Format UID mentah jadi teks
  rfid.PICC_HaltA();                            // Bebaskan kartu agar pembacaan berikutnya segar
  if (uid.length() == 0) return;                  // UID kosong: abaikan
  if (uid == lastCardUid && (millis() - lastCardAt) < 2000) return;  // Debounce 2 dtk
  lastCardUid = uid;                              // Ingat UID untuk debounce berikutnya
  lastCardAt = millis();                          // Catat waktu kirim

  if (cardWindow) {                               // Sedang dalam jendela daftar (perintah CARD)
    cardWindow = false;                         // Jendela daftar: hasil sekali pakai
    kirim(String("CARD_OK ") + uid);              // Kirim hasil ke face-service
    lcdTulis("Kartu terdaftar", uid);             // Konfirmasi di LCD
  } else {                                        // Di luar jendela: sesi 2FA nfc (verifikasi harian)
    kirim(String("CARD ") + uid);               // Di luar jendela: sesi 2FA yang menentukan pemilik
    lcdTulis("Kartu dibaca", uid);                // Tampilkan UID yang terbaca
  }
}
```

## 4. Sisi firmware: terima `prosesPerintah()` (`:248–341`)

```cpp
// ---------- Parser Perintah Serial dari Laptop (Flask / Serial Monitor) ----------
void prosesPerintah(String baris) {               // Jalankan satu perintah teks dari laptop
  baris.trim();                                       // Buang spasi/newline (\r\n) di awal & akhir baris
  if (baris.length() == 0) return;                // Baris kosong: abaikan

  // 1. PING / 'm': Cek koneksi dan hitung berapa template sidik jari yang tersimpan di R503
  if (baris == "PING" || baris == "m") {          // Alias 'm' untuk pengetesan manual cepat
    finger.getTemplateCount();                    // Baca jumlah template dari sensor
    kirim(String("PONG ") + finger.templateCount); // Balas "PONG <jumlah>"
    return;                                       // Selesai: jangan lanjut ke parser lain
  }

  // 2. LED_OK: Perintah dari Flask setelah absensi 2 faktor tercatat di SQLite
  if (baris == "LED_OK") {                        // Sinyal absensi sudah tersimpan di backend
    ledHijau();                                   // Ring hijau tanda sukses
    lcdTulis("Absensi tercatat", "Terima kasih"); // Ucapan di LCD
    kirim("LED_DONE");                                // Balas cepat: face-service menunggu maks 2 dtk
    delay(1800);                                      // Biar siswa sempat membaca pesan sukses
    ledMati();                                    // Matikan ring LED
    lcdSiap();                                        // Kembali ke tampilan siaga
    return;                                       // Selesai
  }

  // 3. CLEAR / 'c': Hapus seluruh template sidik jari di memori Flash R503
  if (baris == "CLEAR" || baris == "c") {         // Alias 'c' untuk penghapusan manual cepat
    uint8_t p = finger.emptyDatabase();           // Perintah hapus semua template ke sensor
    kirim(p == FINGERPRINT_OK ? String("CLEAR_OK 0") : String("CLEAR_FAIL ") + p); // Lapor hasil ke laptop
    lcdTulis(p == FINGERPRINT_OK ? "Semua template" : "Hapus GAGAL", p == FINGERPRINT_OK ? "sudah dihapus" : String("kode ") + p); // Tampilkan hasil di LCD
    return;                                       // Selesai
  }

  // 4. 'e': Mode interaktif khusus saat menguji manual dari Serial Monitor Arduino IDE
  if (baris == "e") {                             // Hanya huruf 'e' saja
    Serial.println("Masukkan ID (1-200):");       // Minta operator mengetik nomor slot
    while (!Serial.available()) delay(10);        // Tunggu operator mengetik (blocking)
    int id = Serial.parseInt();                   // Baca angka yang diketik
    while (Serial.available()) Serial.read();     // Buang sisa newline di buffer
    if (id >= 1 && id <= 200) {                   // Validasi rentang slot
      kirim(String("ENROLLING ") + id);           // Umumkan enroll dimulai
      enrollFinger((uint8_t)id);                  // Jalankan enroll (blokir sampai selesai)
    }
    return;                                       // Selesai
  }
  // 5a. CARD: buka jendela tempel kartu RFID (15 dtk). Hasil di loop() -> CARD_OK / CARD_TIMEOUT
  if (baris == "CARD") {                          // face-service meminta pembukaan jendela daftar kartu
    if (!rfidSiap) { kirim("CARD_FAIL 0"); return; } // Reader mati: langsung gagal
    cardWindow = true;                            // Buka jendela
    cardDeadline = millis() + CARD_WINDOW_MS;     // Set batas waktu 15 dtk dari sekarang
    lastCardUid = "";                             // kartu yang sama boleh dipakai lagi
    kirim("CARDWAIT");                            // Beri tahu laptop: jendela terbuka
    lcdTulis("Tempel kartu", "15 dtk");           // Instruksi di LCD
    return;                                       // Selesai
  }

  // 5b. CANCEL: tutup jendela kartu tanpa hasil (dipakai UI saat user membatalkan)
  if (baris == "CANCEL") {                        // Perintah batal dari face-service
    if (cardWindow) {                             // Hanya bila jendela memang terbuka
      cardWindow = false;                         // Tutup jendela
      kirim("CARD_TIMEOUT");                      // Lapor hasil: seperti habis waktu
    }
    return;                                       // Selesai (diam bila tidak ada jendela)
  }

  // 5c. LCD <baris1>|<baris2>: teks bebas dari laptop (mis. nama siswa / pesan sesi)
  if (baris.startsWith("LCD ")) {                 // Awalan "LCD " = perintah tampil teks
    String isi = baris.substring(4);              // Ambil teks setelah "LCD "
    int pisah = isi.indexOf('|');                 // Cari pemisah baris 1 dan 2
    if (pisah < 0) lcdTulis(isi);                 // Tanpa '|': tampilkan di baris 1 saja
    else lcdTulis(isi.substring(0, pisah), isi.substring(pisah + 1)); // Dengan '|': pecah jadi 2 baris
    return;                                       // Selesai (tanpa balasan ke laptop)
  }

  // Pisahkan kata perintah dan argumen angka ID (contoh: "ENROLL 3" -> perintah="ENROLL", id=3)
  int spasi = baris.indexOf(' ');                 // Cari spasi pertama pemisah perintah-argumen
  String perintah = (spasi < 0) ? baris : baris.substring(0, spasi); // Ambil kata perintah
  int id = (spasi < 0) ? -1 : baris.substring(spasi + 1).toInt(); // Ambil argumen angka (-1 bila tidak ada)

  // 5. ENROLL <id>: Dipanggil otomatis oleh Flask saat pendaftaran siswa / rekam sidik jari
  if (perintah == "ENROLL") {                     // Enroll jarak jauh dari UI
    if (id < 1 || id > 200) { kirim("ENROLL_FAIL 0 255"); return; } // Tolak slot di luar 1..200
    kirim(String("ENROLLING ") + id);           // Umumkan enroll dimulai
    enrollFinger((uint8_t)id);                  // Jalankan enroll (blokir sampai selesai)
    return;                                       // Selesai
  }

  // 6. DELETE <id> / 'd <id>': Hapus 1 slot template sidik jari tertentu
  if (perintah == "DELETE" || perintah == "d") { // Dua ejaan: perintah penuh & alias manual
    if (id < 1 || id > 200) { kirim("DELETE_FAIL 0 255"); return; } // Tolak slot di luar 1..200
    uint8_t p = finger.deleteModel((uint8_t)id);  // Perintah hapus slot ke sensor
    if (p == FINGERPRINT_OK) kirimKode("DELETE_OK", id, 0); // Sukses: "DELETE_OK <id> 0"
    else kirimKode("DELETE_FAIL", id, p);         // Gagal: "DELETE_FAIL <id> <kode>"
    return;                                       // Selesai
  }

  // Perintah tidak dikenali
  kirim(String("ERR_UNKNOWN ") + perintah);       // Balas error agar laptop tahu perintahnya salah
}
```

## 5. Sisi firmware: `loop()` (`:389–421`)

```cpp
void loop() {                                     // Berputar selamanya selama ada daya
  // Prioritas 1: Jika ada perintah masuk dari laptop (PING, ENROLL, DELETE, CLEAR, LED_OK, CARD), jalankan dulu
  if (Serial.available()) {                       // Ada byte perintah di buffer USB
    String baris = Serial.readStringUntil('\n');  // Baca satu baris sampai newline
    prosesPerintah(baris);                        // Jalankan perintah (bisa blocking saat enroll)
    return; // Kembali ke awal loop setelah menyelesaikan perintah
  }
```

Lanjutannya (`:396–421`): jendela kartu (hitung mundur LCD) → `cekKartu()` → `verifikasi()` → `delay(50)`.

## 6. Sisi Python

Firmware hanya bicara ke `apps/face-service`: `fingerprint_serial.py` memegang port COM + state sesi 2FA, `server.py` mengeksposnya ke Next.js. Salinan kodenya (`_run`, `_handle`, `_send`/`_wait`, `_apply_match`, endpoint `/fingerprint/session` + `/fingerprint/led`) ada di [python.md](../../esp32R503_Serial/python.md).

## 7. Batas kepemilikan

- **Firmware** tidak tahu siswa, tidak menyimpan UID terikat, tidak menulis database — hanya laporan `MATCH`/`NOMATCH`/`CARD`.
- **face-service** memegang port serial + state sesi sementara (`waiting` → `verified`/`failed`/`expired`), **tidak** menulis Supabase.
- **Next.js** yang membaca `students.fingerprint_slot` + `rfid_cards.uid`, membuka sesi, memvalidasi ulang bukti (slot/UID + umur bukti 120 dtk), dan menulis `attendance`. Detail: [code-attendance-routes.md](code-attendance-routes.md).

## 8. Troubleshooting

| Gejala | Penyebab |
|---|---|
| `/fingerprint/status` → `connected: false` | Port COM dipegang Serial Monitor / Arduino IDE; kabel USB data-only |
| `SENSOR_FAIL 0` | Wiring R503 (3.3V, TX/RX tertukar), bukan bug firmware |
| `state: "expired"` padahal jari sudah ditempel | Sesi lewat TTL sebelum `POST /api/attendance`; ulangi scan wajah |
| `state: "failed", reason: "slot_mismatch"` | Jari milik siswa lain; sesi terkunci setelah `MAX_ATTEMPTS` |
| `CARD_FAIL 0` | RC522 tidak terdeteksi (SPI/wiring), jendela enroll kartu ditolak |
| `POST /api/attendance` → `502 face-service tidak terjangkau` | `FACE_SERVICE_URL` salah atau uvicorn mati |
