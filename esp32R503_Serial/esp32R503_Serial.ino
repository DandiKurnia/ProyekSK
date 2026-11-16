// ==================================================
// ESP32 + R503 Fingerprint - Jembatan USB Serial
// ==================================================
// Protokol baris (Line-based, 115200 baud) lewat kabel USB.
// Serial Monitor Arduino IDE tetap bisa dipakai manual (perintah: e, d, c, m).
//
//   PING             -> "PONG <jumlah_template>"
//   ENROLL <id>      -> "ENROLLING <id>" ... "ENROLL_OK <id>" / "ENROLL_FAIL <id> <kode>"
//   DELETE <id>      -> "DELETE_OK <id>" / "DELETE_FAIL <id> <kode>"
//   CLEAR            -> "CLEAR_OK 0" / "CLEAR_FAIL <kode>"
//   LED_OK           -> "LED_DONE" (kedip hijau, dipakai saat absensi terverifikasi)
//   CARD             -> "CARDWAIT" ... "CARD_OK <UID>" / "CARD_TIMEOUT" (jendela tempel kartu 15 detik)
//   CANCEL           -> membatalkan jendela CARD yang sedang terbuka
//   LCD <b1>|<b2>    -> tampilkan teks bebas (tanpa balasan; mis. "LCD BUDI|Hadir OK")
//
// LCD I2C 16x2 (backpack PCF8574): VCC=5V, GND=GND, SDA=GPIO21, SCL=GPIO22.
// Install di Library Manager: "LiquidCrystal I2C" (Frank de Brabander).
// Alamat umum 0x27; ganti LCD_ADDR 0x3F bila LCD hanya backlight tanpa teks.
//
// Event dari ESP32 ke laptop:
//   BOOT <versi>              -> saat ESP32 menyala
//   READY <jumlah_template> [RFID <nama_reader>] -> sensor siap dipakai
//   SENSOR_FAIL 0             -> sensor tidak terdeteksi (cek wiring 3.3V / TX-RX)
//   MATCH <id> <confidence>   -> sidik jari cocok
//   NOMATCH                   -> sidik jari tidak dikenali
//   CARD <UID>                -> kartu RFID ditempel (dipakai bila sesi verifikasi aktif)
//   PLACE <id> / REMOVE       -> instruksi saat proses enroll
// ==================================================

#include <Adafruit_Fingerprint.h>  // Library protokol paket biner UART sensor sidik jari (R503 / AS608)
#include <SPI.h>                   // Bus SPI untuk reader RFID RC522
#include <MFRC522.h>               // Driver reader RFID RC522 (kartu MIFARE 13.56 MHz)
#include <Wire.h>                  // Bus I2C untuk LCD 16x2 (backpack PCF8574)
#include <LiquidCrystal_I2C.h>     // Driver LCD I2C (library "LiquidCrystal I2C" / Frank de Brabander)

#define FW_VERSION "1.2"           // v1.2: tampilan status di LCD I2C 16x2

// LCD I2C 16x2: SDA=GPIO21, SCL=GPIO22 (default Wire ESP32), VCC=5V, GND=GND.
// Alamat I2C umum 0x27; sebagian modul 0x3F -> ganti bila LCD hanya menyala tanpa teks.
#define LCD_ADDR    0x27
#define LCD_COLS    16
#define LCD_ROWS    2
#define I2C_SDA_PIN 21
#define I2C_SCL_PIN 22

// ---------- LCD I2C helper ----------
// Satu-satunya penulis LCD agar teks tidak tercecer; tiap baris dirapikan ke LCD_COLS.
LiquidCrystal_I2C lcd(LCD_ADDR, LCD_COLS, LCD_ROWS);

void lcdTulis(const String &baris1, const String &baris2 = "") {
  lcd.clear();                                        // clear() sudah mengosongkan baris 2 bila kosong
  lcd.setCursor(0, 0);
  lcd.print(baris1.substring(0, LCD_COLS));
  lcd.setCursor(0, 1);
  lcd.print(baris2.substring(0, LCD_COLS));
}

void lcdSiap() { lcdTulis("Siap absen", "Jari / Kartu"); }

// Konfigurasi pin UART2 pada ESP32 untuk berbicara dengan sensor R503
#define RX_PIN      16             // Pin GPIO16 (RX2 ESP32) menerima data dari kabel Kuning (TX R503)
#define TX_PIN      17             // Pin GPIO17 (TX2 ESP32) mengirim data ke kabel Hijau (RX R503)
#define WAKEUP_PIN   4             // Pin GPIO4 untuk sinyal sentuh/wakeup dari kabel Biru R503 (opsional)

// Membuka jalur komunikasi serial perangkat keras ke-2 (UART2) milik ESP32
HardwareSerial fpSerial(2);

// Membuat objek pengontrol sensor R503 yang terhubung di atas jalur UART2 (fpSerial)
Adafruit_Fingerprint finger(&fpSerial);

// Konfigurasi SPI untuk reader RFID RC522 (satu board dengan soket R503).
// SCK=18, MISO=19, MOSI=23 (SPI default ESP32); SS & RST di bawah agar tidak
// bertabrakan dengan UART2 R503 (16/17) maupun pin wakeup (4).
#define RFID_SS_PIN   5            // GPIO5  -> SDA/SS RC522
#define RFID_RST_PIN  27           // GPIO27 -> RST RC522
#define CARD_WINDOW_MS 15000UL     // Jendela tempel kartu saat perintah CARD (15 detik)

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);  // Objek reader RFID

bool rfidSiap = false;            // false = reader tidak terdeteksi (lanjut tanpa kartu)
bool cardWindow = false;          // true = jendela daftar kartu sedang terbuka
uint32_t cardDeadline = 0;        // millis() batas akhir jendela daftar kartu
String lastCardUid = "";          // UID terakhir; cegah event CARD berulang saat kartu menempel terus
uint32_t lastCardAt = 0;          // millis() saat UID terakhir dikirim

// ---------- LED helper (ring RGB R503) ----------
// Mengatur cincin lampu LED pada sensor R503:
// Parameter LEDcontrol(mode, kecepatan, warna, jumlah_kedip)
void ledBiru()   { finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 100, FINGERPRINT_LED_BLUE); }   // Biru bernapas: siaga / menunggu jari
void ledHijau()  { finger.LEDcontrol(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_PURPLE); }          // Nyala penuh: berhasil / cocok
void ledMerah()  { finger.LEDcontrol(FINGERPRINT_LED_FLASHING, 25, FINGERPRINT_LED_RED, 3); }   // Kedip merah 3x: gagal / ditolak
void ledMati()   { finger.LEDcontrol(FINGERPRINT_LED_OFF, 0, FINGERPRINT_LED_BLUE); }           // Mematikan cincin LED

// ---------- Utilitas Komunikasi USB Serial ke Laptop ----------
// Mengirim satu baris teks ke laptop (Python esp32_serial.py) dan memastikan buffer USB terkirim tuntas
void kirim(const String &baris) {
  Serial.println(baris);  // Kirim teks diakhiri newline ('\n') ke port USB (COM5)
  Serial.flush();         // Tunggu hingga seluruh byte benar-benar keluar dari buffer UART0
}

// Memformat pesan berformat "<PERINTAH> <id> <kode>" lalu mengirimkannya ke laptop
void kirimKode(const char *perintah, uint8_t id, uint8_t kode) {
  char buffer[48];
  snprintf(buffer, sizeof(buffer), "%s %u %u", perintah, id, kode);
  kirim(buffer);
}

// ---------- Pembacaan Fisik Jari ----------
// Menunggu sampai permukaan kapasitif R503 menangkap gambar sidik jari (batas waktu default 15 detik)
uint8_t tungguJari(uint32_t timeout_ms = 15000) {
  uint32_t mulai = millis();                          // Catat waktu mulai (ms sejak ESP32 hidup)
  while (millis() - mulai < timeout_ms) {
    uint8_t p = finger.getImage();                    // Minta R503 memindai permukaan sensor kapasitif
    if (p == FINGERPRINT_OK) return FINGERPRINT_OK;   // Jari terdeteksi dan citra berhasil diambil
    if (p == FINGERPRINT_NOFINGER) { delay(50); continue; } // Belum ada jari: jeda 50 ms lalu cek lagi
    return p;                                         // Kembalikan kode error jika paket rusak / gambar buram
  }
  return FINGERPRINT_TIMEOUT;                         // Waktu habis (15 detik lewat tanpa jari ditempel)
}

// Menunggu sampai jari diangkat dari sensor agar 1 tempelan tidak terbaca berulang kali
void tungguJariAngkat(uint32_t timeout_ms = 4000) {
  uint32_t mulai = millis();
  while (millis() - mulai < timeout_ms) {
    if (finger.getImage() == FINGERPRINT_NOFINGER) return; // Berhenti menunggu begitu permukaan sensor kosong
    delay(50);
  }
}

// ---------- Enroll (Pendaftaran Sidik Jari Baru ke Memori Flash R503) ----------
// Alur standar R503 membutuhkan 2 kali tempel jari:
//   Tempel 1 -> diekstrak ke CharBuffer 1
//   Tempel 2 -> diekstrak ke CharBuffer 2
//   createModel() menggabungkan CharBuffer 1 & 2 menjadi 1 template utuh
//   storeModel(id) menyimpan template ke memori Flash internal R503 pada slot #id (1..200)
void enrollFinger(uint8_t id) {
  kirim(String("PLACE ") + id);                       // Beri tahu laptop: minta siswa tempelkan jari ke-1
  ledBiru();                                          // Nyalakan ring biru sebagai tanda siap rekam
  lcdTulis(String("Enroll #") + id, "Tempel jari 1/2");

  // Tahap 1: Ambil citra jari pertama dan ubah menjadi fitur minutiae di CharBuffer 1
  uint8_t p = tungguJari();
  if (p != FINGERPRINT_OK) { lcdTulis(String("Enroll GAGAL#") + id, "Ulangi"); kirimKode("ENROLL_FAIL", id, p); ledMerah(); delay(1200); lcdSiap(); return; }

  p = finger.image2Tz(1);                             // Konversi gambar mentah ke titik fitur di slot RAM 1 (CharBuffer1)
  if (p != FINGERPRINT_OK) { lcdTulis(String("Enroll GAGAL#") + id, "Ulangi"); kirimKode("ENROLL_FAIL", id, p); ledMerah(); delay(1200); lcdSiap(); return; }

  // Minta jari diangkat dulu supaya pengambilan kedua benar-benar posisi sampel baru
  kirim("REMOVE");
  lcdTulis(String("Enroll #") + id, "Angkat jari");
  tungguJariAngkat();

  // Tahap 2: Ambil citra jari kedua dan ubah menjadi fitur minutiae di CharBuffer 2
  kirim(String("PLACE ") + id);                       // Minta siswa menempelkan jari yang sama untuk ke-2 kalinya
  lcdTulis(String("Enroll #") + id, "Tempel jari 2/2");
  p = tungguJari();
  if (p != FINGERPRINT_OK) { lcdTulis(String("Enroll GAGAL#") + id, "Ulangi"); kirimKode("ENROLL_FAIL", id, p); ledMerah(); delay(1200); lcdSiap(); return; }

  p = finger.image2Tz(2);                             // Konversi gambar kedua ke titik fitur di slot RAM 2 (CharBuffer2)
  if (p != FINGERPRINT_OK) { lcdTulis(String("Enroll GAGAL#") + id, "Ulangi"); kirimKode("ENROLL_FAIL", id, p); ledMerah(); delay(1200); lcdSiap(); return; }

  // Tahap 3: Bandingkan CharBuffer1 & CharBuffer2; jika berasal dari jari yang sama, gabungkan jadi template
  p = finger.createModel();
  if (p != FINGERPRINT_OK) { lcdTulis(String("Enroll GAGAL#") + id, "Ulangi"); kirimKode("ENROLL_FAIL", id, p); ledMerah(); delay(1200); lcdSiap(); return; }

  // Tahap 4: Simpan template permanen ke memori Flash internal R503 pada nomor slot 'id' (1-200)
  p = finger.storeModel(id);
  if (p != FINGERPRINT_OK) { lcdTulis(String("Enroll GAGAL#") + id, "Ulangi"); kirimKode("ENROLL_FAIL", id, p); ledMerah(); delay(1200); lcdSiap(); return; }

  // Berhasil: kirim sinyal sukses ke Flask dan nyalakan lampu indikator
  kirimKode("ENROLL_OK", id, 0);
  ledHijau();
  lcdTulis(String("Enroll OK #") + id, "Selesai");
  delay(1200);
  ledMati();
  lcdSiap();
}

// ---------- Verifikasi 1:N (Pencocokan Jari Saat Absensi 2 Faktor) ----------
// Dipanggil terus-menerus di loop(). Saat ada jari menempel, sensor mencari kecocokan di seluruh slot Flash.
void verifikasi() {
  uint8_t p = finger.getImage();                      // Cek apakah ada jari di atas sensor
  if (p != FINGERPRINT_OK) return;                    // Kalau tidak ada jari, langsung keluar (non-blocking)

  p = finger.image2Tz();                              // Ekstrak titik minutiae jari ke CharBuffer1
  if (p != FINGERPRINT_OK) return;                    // Gambar kurang jelas: abaikan dan tunggu pembacaan berikutnya

  // Bandingkan CharBuffer1 terhadap seluruh template yang tersimpan di Flash R503 (pencarian 1:N di chip DSP sensor)
  p = finger.fingerSearch();
  if (p == FINGERPRINT_OK) {
    // Jari cocok dengan salah satu slot: kirim "MATCH <fingerID> <confidence>" ke Flask (esp32_serial.py)
    char buffer[48];
    snprintf(buffer, sizeof(buffer), "MATCH %u %u", finger.fingerID, finger.confidence);
    kirim(buffer);
    ledHijau();
    lcdTulis("Sidik jari OK", String("ID ") + finger.fingerID + " (" + finger.confidence + "%)");
    delay(1000);                                     // Beri waktu membaca hasil di LCD
    ledMati();
  } else {
    // Jari tidak ada di database sensor: kirim "NOMATCH" agar Flask langsung menolak tanpa menunggu 30 detik
    kirim("NOMATCH");
    ledMerah();
    lcdTulis("Tidak dikenali", "Coba lagi");
    delay(1000);
    ledMati();
  }
  tungguJariAngkat();                                 // Wajib angkat jari dulu sebelum bisa memindai lagi
  delay(300);                                         // Debounce tambahan agar tidak memicu bacaan ganda
  lcdSiap();                                          // Kembali ke tampilan siaga setelah sidik selesai
}

// ---------- Pembacaan Kartu RFID (non-blocking, dipanggil tiap loop) ----------
// UID sama tidak dikirim ulang lebih cepat dari 2 detik agar antrean serial
// tidak kebanjiran bacaan ganda saat kartu menempel terus.
String uidKeString(MFRC522::Uid *uid) {
  String s = "";
  for (byte i = 0; i < uid->size; i++) {
    if (uid->uidByte[i] < 0x10) s += "0";
    s += String(uid->uidByte[i], HEX);
    if (i + 1 < uid->size) s += ":";
  }
  s.toUpperCase();
  return s;
}

void cekKartu() {
  if (!rfidSiap) return;
  if (!rfid.PICC_IsNewCardPresent()) return;    // Tidak ada kartu: keluar tanpa menyentuh SPI lagi
  if (!rfid.PICC_ReadCardSerial()) return;      // Gagal baca serial kartu
  String uid = uidKeString(&rfid.uid);
  rfid.PICC_HaltA();                            // Bebaskan kartu agar pembacaan berikutnya segar
  if (uid.length() == 0) return;
  if (uid == lastCardUid && (millis() - lastCardAt) < 2000) return;  // Debounce 2 dtk
  lastCardUid = uid;
  lastCardAt = millis();

  if (cardWindow) {
    cardWindow = false;                         // Jendela daftar: hasil sekali pakai
    kirim(String("CARD_OK ") + uid);
    lcdTulis("Kartu terdaftar", uid);
  } else {
    kirim(String("CARD ") + uid);               // Di luar jendela: sesi 2FA yang menentukan pemilik
    lcdTulis("Kartu dibaca", uid);
  }
}

// ---------- Parser Perintah Serial dari Laptop (Flask / Serial Monitor) ----------
void prosesPerintah(String baris) {
  baris.trim();                                       // Buang spasi/newline (\r\n) di awal & akhir baris
  if (baris.length() == 0) return;

  // 1. PING / 'm': Cek koneksi dan hitung berapa template sidik jari yang tersimpan di R503
  if (baris == "PING" || baris == "m") {
    finger.getTemplateCount();
    kirim(String("PONG ") + finger.templateCount);
    return;
  }

  // 2. LED_OK: Perintah dari Flask setelah absensi 2 faktor tercatat di SQLite
  if (baris == "LED_OK") {
    ledHijau();
    lcdTulis("Absensi tercatat", "Terima kasih");
    kirim("LED_DONE");                                // Balas cepat: face-service menunggu maks 2 dtk
    delay(1800);                                      // Biar siswa sempat membaca pesan sukses
    ledMati();
    lcdSiap();                                        // Kembali ke tampilan siaga
    return;
  }

  // 3. CLEAR / 'c': Hapus seluruh template sidik jari di memori Flash R503
  if (baris == "CLEAR" || baris == "c") {
    uint8_t p = finger.emptyDatabase();
    kirim(p == FINGERPRINT_OK ? String("CLEAR_OK 0") : String("CLEAR_FAIL ") + p);
    lcdTulis(p == FINGERPRINT_OK ? "Semua template" : "Hapus GAGAL", p == FINGERPRINT_OK ? "sudah dihapus" : String("kode ") + p);
    return;
  }

  // 4. 'e': Mode interaktif khusus saat menguji manual dari Serial Monitor Arduino IDE
  if (baris == "e") {
    Serial.println("Masukkan ID (1-200):");
    while (!Serial.available()) delay(10);
    int id = Serial.parseInt();
    while (Serial.available()) Serial.read();
    if (id >= 1 && id <= 200) {
      kirim(String("ENROLLING ") + id);
      enrollFinger((uint8_t)id);
    }
    return;
  }
  // 5a. CARD: buka jendela tempel kartu RFID (15 dtk). Hasil di loop() -> CARD_OK / CARD_TIMEOUT
  if (baris == "CARD") {
    if (!rfidSiap) { kirim("CARD_FAIL 0"); return; }
    cardWindow = true;
    cardDeadline = millis() + CARD_WINDOW_MS;
    lastCardUid = "";                             // kartu yang sama boleh dipakai lagi
    kirim("CARDWAIT");
    lcdTulis("Tempel kartu", "15 dtk");
    return;
  }

  // 5b. CANCEL: tutup jendela kartu tanpa hasil (dipakai UI saat user membatalkan)
  if (baris == "CANCEL") {
    if (cardWindow) {
      cardWindow = false;
      kirim("CARD_TIMEOUT");
    }
    return;
  }

  // 5c. LCD <baris1>|<baris2>: teks bebas dari laptop (mis. nama siswa / pesan sesi)
  if (baris.startsWith("LCD ")) {
    String isi = baris.substring(4);
    int pisah = isi.indexOf('|');
    if (pisah < 0) lcdTulis(isi);
    else lcdTulis(isi.substring(0, pisah), isi.substring(pisah + 1));
    return;
  }

  // Pisahkan kata perintah dan argumen angka ID (contoh: "ENROLL 3" -> perintah="ENROLL", id=3)
  int spasi = baris.indexOf(' ');
  String perintah = (spasi < 0) ? baris : baris.substring(0, spasi);
  int id = (spasi < 0) ? -1 : baris.substring(spasi + 1).toInt();

  // 5. ENROLL <id>: Dipanggil otomatis oleh Flask saat pendaftaran siswa / rekam sidik jari
  if (perintah == "ENROLL") {
    if (id < 1 || id > 200) { kirim("ENROLL_FAIL 0 255"); return; }
    kirim(String("ENROLLING ") + id);
    enrollFinger((uint8_t)id);
    return;
  }

  // 6. DELETE <id> / 'd <id>': Hapus 1 slot template sidik jari tertentu
  if (perintah == "DELETE" || perintah == "d") {
    if (id < 1 || id > 200) { kirim("DELETE_FAIL 0 255"); return; }
    uint8_t p = finger.deleteModel((uint8_t)id);
    if (p == FINGERPRINT_OK) kirimKode("DELETE_OK", id, 0);
    else kirimKode("DELETE_FAIL", id, p);
    return;
  }

  // Perintah tidak dikenali
  kirim(String("ERR_UNKNOWN ") + perintah);
}

// ---------- Inisialisasi Awal (Dijalankan 1x Saat ESP32 Menyala / Reset) ----------
void setup() {
  Serial.begin(115200);                               // Buka komunikasi USB ke laptop dengan kecepatan 115200 bps
  pinMode(WAKEUP_PIN, INPUT);                         // Set pin wakeup sebagai input
  fpSerial.begin(57600, SERIAL_8N1, RX_PIN, TX_PIN);  // Buka UART2 ke sensor R503 (baudrate bawaan R503 = 57600 bps)

  // Nyalakan LCD duluan agar proses boot terlihat di layar fisik
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  lcd.init();
  lcd.backlight();
  lcdTulis("Smart Classroom", "Mulai...");

  delay(300);                                         // Tunggu tegangan sensor stabil setelah power-on
  kirim(String("BOOT ") + FW_VERSION);                // Kabari laptop bahwa ESP32 baru saja booting

  finger.begin(57600);                                // Inisialisasi library Adafruit_Fingerprint
  delay(100);

  // Pastikan sensor R503 merespons handshake password UART
  if (!finger.verifyPassword()) {
    kirim("SENSOR_FAIL 0");                           // Jika kabel lepas / salah pin TX-RX, laporkan ke laptop
    lcdTulis("Sensor R503", "Tidak terdeteksi");
    return;                                           // Jangan mengunci ESP32 di while(1) agar tetap bisa didiagnosis
  }

  // Sensor siap: baca jumlah template tersimpan dan nyalakan ring biru
  finger.getTemplateCount();
  kirim(String("READY ") + finger.templateCount);

  // Inisialisasi reader RFID RC522 (bus SPI). Gagal -> firmware tetap jalan tanpa kartu.
  SPI.begin();
  rfid.PCD_Init();
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  rfidSiap = (v != 0x00 && v != 0xFF);
  if (!rfidSiap) {
    kirim("RFID_FAIL 0");                             // Reader tidak terdeteksi: cek 3.3V & kabel SPI
    lcdTulis("Siap absen", "Tanpa kartu");
  } else {
    lcdSiap();
  }
  ledBiru();
}

// ---------- Loop Utama (Berputar Terus-menerus Selama ESP32 Hidup) ----------
void loop() {
  // Prioritas 1: Jika ada perintah masuk dari laptop (PING, ENROLL, DELETE, CLEAR, LED_OK, CARD), jalankan dulu
  if (Serial.available()) {
    String baris = Serial.readStringUntil('\n');
    prosesPerintah(baris);
    return; // Kembali ke awal loop setelah menyelesaikan perintah
  }

  // Prioritas 2: jendela daftar kartu lewat batas waktu -> lapor ke laptop
  if (cardWindow && millis() >= cardDeadline) {
    cardWindow = false;
    kirim("CARD_TIMEOUT");
    lcdSiap();
  } else if (cardWindow) {
    // Hitung mundur non-blocking: tampilkan detik tersisa, tulis ulang hanya saat angka berubah
    static uint32_t lcdSisaTerakhir = 0xFFFFFFFF;
    uint32_t sisa = (cardDeadline - millis()) / 1000 + 1;
    if (sisa != lcdSisaTerakhir) {
      lcdSisaTerakhir = sisa;
      lcdTulis("Tempel kartu", String("Sisa ") + sisa + " dtk");
    }
  }

  // Prioritas 3: kartu RFID menempel (non-blocking)
  cekKartu();

  // Prioritas 4: jari menempel untuk verifikasi absensi
  verifikasi();

  delay(50); // Jeda 50 ms (~20 pengecekan per detik) agar trafik UART tidak jenuh
}
