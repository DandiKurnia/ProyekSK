/*
 * Sensor kursi load cell HX711 -> Wi-Fi -> Route Handler Next.js -> Supabase.
 * Status ditentukan di firmware (histeresis), backend hanya menyimpan.
 * Endpoint: POST /api/seats/status
 * Board: ESP32 (DOUT=19, SCK=18). Library: "HX711" oleh bogde.
 * Wajib: device_id terdaftar di tabel devices (type seat_esp32) dan
 *        seats.device_id kursi menunjuk ke device yang sama.
 */
#include <Arduino.h>           // Tipe dasar Arduino: String, millis(), delay(), Serial
#include <math.h>              // fabsf(), isnan(), NAN untuk mengolah hasil timbangan
#include <WiFi.h>              // Driver Wi-Fi ESP32 (mode STA, WiFi.begin, WiFi.status)
#include <WiFiClientSecure.h>  // Klien TLS, dipakai hanya bila API_URL berawalan https://
#include <HTTPClient.h>        // Pembungkus HTTP request (POST, timeout, header)
#include "HX711.h"             // Driver modul ADC HX711 (library "HX711" oleh bogde)

// ===================== KONFIGURASI =====================
// Dev: IP LAN laptop, mis. "http://192.168.1.10:3000/api/seats/status".
// Produksi: host Next.js, mis. "https://xxx.vercel.app/api/seats/status".
const char *API_URL = "http://192.168.1.6:3000/api/seats/status"; // IP LAN laptop (cek ipconfig sebelum flash)

#include "secrets.h" // WIFI_SSID + WIFI_PASS — tidak di-commit, lihat secrets.h.example

const char *DEVICE_ID = "SEAT-ESP-01"; // harus ada di tabel devices
const char *SEAT_ID   = "SEAT-01";     // seats.device_id harus = DEVICE_ID
const char *FIRMWARE_VERSION = "1.0.0"; // dikirim tiap POST, disimpan di devices.firmware_version

const uint32_t HEARTBEAT_MS = 20000;    // kirim ulang walau status tak berubah (jaga last_seen_at)
const uint32_t HTTP_TIMEOUT_MS = 6000;  // batas tunggu koneksi + respons HTTP
const uint32_t WIFI_RETRY_MS = 10000;   // jeda minimum antar percobaan sambung ulang Wi-Fi
const uint32_t RETRY_MIN_MS = 2000;     // backoff awal saat kirim gagal
const uint32_t RETRY_MAX_MS = 30000;    // backoff maksimum (tidak tumbuh tanpa batas)

// ===================== HARDWARE & AMBANG =====================
const uint8_t HX711_DOUT_PIN = 19;      // GPIO19 <- DOUT/DT HX711 (data keluar)
const uint8_t HX711_SCK_PIN  = 18;      // GPIO18 -> SCK HX711 (clock)

HX711 loadCell;                         // Objek driver HX711 (pin diberikan saat setup)

// Faktor awal data uji: (853728 - 660691) / 174 ~= 1109.4.
// Bila gram terbaca negatif saat dibebani, ubah tandanya menjadi -1109.4.
const float CALIBRATION_FACTOR = 1109.4f; // raw HX711 per gram (hasil kalibrasi 174 g)

const float ZERO_DEADBAND_G = 3.0f; // -2.2 g tampil sebagai 0 g

// Ambang prototipe untuk beban contoh 30 gram (BUKAN ambang manusia).
const float OCCUPIED_THRESHOLD_G = 20.0f; // >= ini (selama confirm) -> kursi dianggap terisi
const float EMPTY_THRESHOLD_G    = 10.0f; // <= ini -> mulai menghitung kursi kosong
const float RECOVERY_THRESHOLD_G = 15.0f; // >= ini saat menghitung -> batalkan (histeresis)

const unsigned long OCCUPIED_CONFIRM_MS = 1000; // beban harus bertahan 1 dtk sebelum "terisi"
const unsigned long ABSENCE_DELAY_MS    = 5000; // beban hilang 5 dtk -> "empty" (ABSEN)
const unsigned long PRINT_INTERVAL_MS   = 500;  // jeda cetak log Serial (2 baris/dtk)

// ===================== STATE =====================
enum SeatState { WAITING_FOR_LOAD, OCCUPIED, EMPTY_PENDING, ABSENT }; // 4 fase mesin status

SeatState seatState = WAITING_FOR_LOAD;        // fase awal: belum pernah ada beban sejak boot
unsigned long occupiedCandidateSince = 0;      // millis() saat beban >= ambang mulai terdeteksi
unsigned long emptySince = 0;                  // millis() saat beban turun ke <= EMPTY_THRESHOLD_G
unsigned long lastPrint = 0;                   // millis() cetak log terakhir
float lastWeightG = 0.0f;                      // berat terakhir yang terbaca (gram)

// Status yang belum berhasil dikirim; hanya yang terbaru disimpan.
bool dirty = true;                             // true = ada status menunggu dikirim
const char *pendingStatus = "unknown";         // status yang belum terkirim
float pendingGrams = NAN;                      // berat pendamping status tersebut
unsigned long lastAttempt = 0;                 // millis() percobaan kirim terakhir
unsigned long retryDelay = RETRY_MIN_MS;       // jeda backoff berjalan
unsigned long lastHeartbeat = 0;               // millis() kirim sukses terakhir (dasar heartbeat)
unsigned long lastWifiAttempt = 0;             // millis() percobaan sambung Wi-Fi terakhir

const char *stateText(SeatState state) {       // Nama fase untuk log Serial
  switch (state) {                             // Pilih teks sesuai fase
    case WAITING_FOR_LOAD: return "MENUNGGU BEBAN PERTAMA"; // belum ada beban sejak boot
    case OCCUPIED:         return "TERISI";                 // ada orang/beban bertahan
    case EMPTY_PENDING:    return "KOSONG SEMENTARA - TIMER 5 DETIK"; // menunggu 5 dtk
    case ABSENT:           return "ABSEN - BEBAN HILANG >= 5 DETIK";  // dinyatakan kosong
    default:               return "STATUS TIDAK DIKETAHUI";           // jaga-jaga
  }
}

float readWeightGrams() {                      // Baca berat sekarang (gram)
  float grams = loadCell.get_units(5);         // rata-rata 5 sampel
  if (fabsf(grams) <= ZERO_DEADBAND_G) grams = 0.0f; // noise kecil -> dianggap nol
  return grams;                                // berat bersih untuk mesin status
}

void markDirty(const char *status, float grams) { // Tandai status baru untuk dikirim
  pendingStatus = status;                     // simpan status (hanya yang terbaru)
  pendingGrams = grams;                       // simpan berat pendamping
  dirty = true;                               // minta loop() mengirim
}

void ensureWifi(unsigned long now) {          // Jaga Wi-Fi tetap tersambung
  if (WiFi.status() == WL_CONNECTED) return;  // sudah tersambung: tidak ada kerja
  if (now - lastWifiAttempt < WIFI_RETRY_MS) return; // belum 10 dtk sejak percobaan terakhir
  lastWifiAttempt = now;                      // catat waktu percobaan
  Serial.println("Wi-Fi: menyambung ulang..."); // log ke Serial Monitor
  WiFi.disconnect();                          // bersihkan state koneksi lama
  WiFi.begin(WIFI_SSID, WIFI_PASS);           // mulai sambung ulang (non-blocking)
}

bool postStatus(const char *status, float grams) { // Kirim satu status ke Route Handler
  if (WiFi.status() != WL_CONNECTED) return false; // tanpa Wi-Fi: tandai gagal (backoff)

  char body[256];                             // buffer JSON body (maks 255 karakter)
  if (isnan(grams)) {                         // status "unknown": berat tidak tersedia
    snprintf(body, sizeof(body),              // rakit JSON tanpa field weight_kg
             "{\"device_id\":\"%s\",\"seat_id\":\"%s\",\"status\":\"%s\"," // identitas + status
             "\"firmware_version\":\"%s\"}",  // versi firmware penutup
             DEVICE_ID, SEAT_ID, status, FIRMWARE_VERSION); // nilai yang disisipkan
  } else {                                    // status lain: sertakan berat
    snprintf(body, sizeof(body),              // rakit JSON lengkap
             "{\"device_id\":\"%s\",\"seat_id\":\"%s\",\"status\":\"%s\"," // identitas + status
             "\"weight_kg\":%.3f,\"firmware_version\":\"%s\"}", // berat kg 3 desimal + versi
             DEVICE_ID, SEAT_ID, status, grams / 1000.0f, FIRMWARE_VERSION); // gram -> kg
  }

  const bool https = strncmp(API_URL, "https://", 8) == 0; // pilih TLS bila URL https
  WiFiClientSecure secure;                    // klien TLS (hanya dipakai bila https)
  WiFiClient plain;                           // klien TCP biasa (http, LAN/dev)
  HTTPClient http;                            // objek request HTTP
  if (https) {                                // jalur TLS
    // Prototipe: tanpa verifikasi sertifikat. Produksi: secure.setCACert(...).
    secure.setInsecure();                     // lewati validasi sertifikat (hanya prototipe)
    secure.setTimeout(HTTP_TIMEOUT_MS);       // batas tunggu socket TLS
    http.begin(secure, API_URL);              // sambungkan HTTPClient ke klien TLS
  } else {                                    // jalur TCP biasa
    http.begin(plain, API_URL);               // sambungkan HTTPClient ke klien plain
  }
  http.setTimeout(HTTP_TIMEOUT_MS);           // batas baca respons
  http.setConnectTimeout(HTTP_TIMEOUT_MS);    // batas waktu konek
  http.addHeader("Content-Type", "application/json"); // backend membaca body sebagai JSON

  const int code = http.POST((uint8_t *)body, strlen(body)); // kirim POST, ambil kode HTTP
  const String resp = code > 0 ? http.getString() : http.errorToString(code); // body / pesan error
  http.end();                                 // tutup koneksi + bebaskan resource

  Serial.printf("POST %s -> %d %s\n", status, code, resp.c_str()); // log hasil ke Serial Monitor
  return code == 200;                         // 200 = tersimpan; selain itu dicoba ulang
}

void flushPending(unsigned long now) {        // Kirim status tertunda dengan backoff
  if (!dirty) return;                         // tidak ada status baru
  if (now - lastAttempt < retryDelay) return; // belum waktunya mencoba lagi
  lastAttempt = now;                          // catat waktu percobaan

  if (postStatus(pendingStatus, pendingGrams)) { // berhasil terkirim
    dirty = false;                            // tidak ada lagi yang tertunda
    retryDelay = RETRY_MIN_MS;                // kembalikan backoff ke minimum
    lastHeartbeat = now;                      // reset timer heartbeat
  } else {                                    // gagal: jaringan / kode bukan 200
    retryDelay = min(retryDelay * 2, (uint32_t)RETRY_MAX_MS); // backoff x2, maksimum 30 dtk
    Serial.printf("Kirim gagal; coba lagi dalam %lu ms\n", retryDelay); // log jeda berikutnya
  }
}

void updateSeatState(float grams, unsigned long now) { // Mesin status 4 fase (histeresis)
  switch (seatState) {                        // cabang sesuai fase sekarang
    case WAITING_FOR_LOAD:                    // belum pernah terisi sejak boot
    case ABSENT:                              // atau sudah dinyatakan kosong
      // Jangan anggap absen hanya karena kursi memang kosong sejak awal.
      if (grams >= OCCUPIED_THRESHOLD_G) {    // beban melewati ambang terisi
        if (occupiedCandidateSince == 0) occupiedCandidateSince = now; // mulai hitung konfirmasi
        if (now - occupiedCandidateSince >= OCCUPIED_CONFIRM_MS) { // beban bertahan 1 dtk
          seatState = OCCUPIED;               // pindah fase terisi
          occupiedCandidateSince = 0;         // reset kandidat
          emptySince = 0;                     // reset timer kosong
          Serial.println("EVENT: kursi terisi."); // log transisi
          markDirty("occupied", grams);       // kirim status occupied
        }
      } else {                                // beban belum/tidak lagi melewati ambang
        occupiedCandidateSince = 0;           // batal menghitung konfirmasi
      }
      break;                                  // selesai fase ini

    case OCCUPIED:                            // kursi sedang terisi
      // Rentang 10-20 g: pertahankan status (histeresis).
      if (grams <= EMPTY_THRESHOLD_G) {       // beban turun ke bawah ambang kosong
        emptySince = now;                     // mulai timer 5 dtk
        seatState = EMPTY_PENDING;            // masuk fase kosong sementara
        Serial.println("EVENT: beban turun; mulai hitung 5 detik."); // log transisi
      }
      break;                                  // selesai fase ini

    case EMPTY_PENDING:                       // menunggu konfirmasi kosong
      if (grams >= RECOVERY_THRESHOLD_G) {    // beban kembali (>= 15 g): batalkan
        seatState = OCCUPIED;                 // kembali ke terisi
        emptySince = 0;                       // reset timer kosong
        Serial.println("EVENT: beban kembali; timer dibatalkan."); // log transisi
      } else if (now - emptySince >= ABSENCE_DELAY_MS) { // 5 dtk tetap rendah
        seatState = ABSENT;                   // nyatakan kosong
        emptySince = 0;                       // reset timer
        Serial.println("EVENT: ABSEN - beban rendah >= 5 detik."); // log transisi
        markDirty("empty", grams);            // kirim status empty
      }
      break;                                  // selesai fase ini
  }
}

void setup() {                                // Dijalankan sekali saat ESP32 menyala/reset
  Serial.begin(115200);                       // Buka USB Serial untuk log (115200 baud)
  delay(1000);                                // beri waktu USB Serial terpasang
  Serial.println();                           // baris kosong pemisah log boot
  Serial.println("=== LOAD CELL KURSI -> Wi-Fi ==="); // banner boot

  WiFi.mode(WIFI_STA);                        // mode station (klien), bukan access point
  WiFi.setAutoReconnect(true);                // sambung ulang otomatis bila terputus
  WiFi.begin(WIFI_SSID, WIFI_PASS);           // mulai sambung ke Wi-Fi dari secrets.h
  Serial.print("Wi-Fi: menyambung");          // log awal tanpa newline
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { // maks 40 x 250 ms = 10 dtk
    delay(250);                               // tunggu sebentar per iterasi
    Serial.print(".");                        // indikator progres
  }
  if (WiFi.status() == WL_CONNECTED) {        // berhasil tersambung
    Serial.println(" OK " + WiFi.localIP().toString()); // tampilkan IP yang didapat
  } else {                                    // gagal dalam 10 dtk (dicoba ulang di loop)
    Serial.println(" GAGAL (data terkirim setelah Wi-Fi tersambung)"); // tetap lanjut boot
  }

  loadCell.begin(HX711_DOUT_PIN, HX711_SCK_PIN); // inisialisasi pin HX711 (DOUT, SCK)
  loadCell.set_scale(CALIBRATION_FACTOR);     // set faktor kalibrasi raw -> gram
  while (!loadCell.wait_ready_timeout(1000)) { // tunggu HX711 siap (maks 1 dtk per cek)
    Serial.println("HX711 belum terbaca. Periksa VCC, GND, DT, SCK."); // diagnosa wiring
    delay(500);                               // ulangi tiap 0,5 dtk sampai modul hidup
  }
  delay(2000);       // beri waktu sinyal stabil
  loadCell.tare(20); // kursi harus kosong saat startup
  Serial.println("Tare selesai.");            // konfirmasi titik nol sudah diset

  // Kursi kosong setelah tare -> lapor baseline "empty".
  markDirty("empty", 0.0f);                   // antre status awal empty (berat 0)
}

void loop() {                                 // Berputar terus selama ESP32 hidup
  const unsigned long now = millis();         // snapshot waktu untuk seluruh iterasi ini
  ensureWifi(now);                            // jaga koneksi Wi-Fi (sambung ulang bila putus)

  if (!loadCell.wait_ready_timeout(500)) {    // HX711 tidak merespons dalam 0,5 dtk
    Serial.println("ERROR: HX711 tidak siap / tidak terbaca."); // log kegagalan sensor
    markDirty("unknown", NAN);                // laporkan status unknown (tanpa berat)
    flushPending(now);                        // coba kirim segera
    delay(300);                               // jangan berputar terlalu cepat
    return;                                   // lewati pembacaan berat iterasi ini
  }

  lastWeightG = readWeightGrams();            // baca berat bersih (rata-rata 5 sampel)
  updateSeatState(lastWeightG, now);          // jalankan mesin status (mungkin markDirty)

  // Heartbeat: status terakhir dikirim ulang agar devices.last_seen_at segar
  // dan Overview tidak menandai perangkat offline.
  if (!dirty && now - lastHeartbeat >= HEARTBEAT_MS) { // 20 dtk tanpa kiriman sukses
    markDirty(seatState == OCCUPIED ? "occupied" : "empty", lastWeightG); // ulangi status terakhir
  }
  flushPending(now);                          // kirim bila waktunya (atau masih dalam backoff)

  if (now - lastPrint >= PRINT_INTERVAL_MS) { // batasi log Serial tiap 0,5 dtk
    lastPrint = now;                          // catat waktu cetak
    Serial.printf("Berat: %.1f g | Status: %s", lastWeightG, stateText(seatState)); // baris utama
    if (seatState == EMPTY_PENDING) {         // sedang menghitung kosong: tampilkan sisa waktu
      const unsigned long elapsed = now - emptySince; // sudah berapa lama kosong
      const unsigned long remaining =         // sisa waktu sebelum ABSEN
          elapsed >= ABSENCE_DELAY_MS ? 0 : ABSENCE_DELAY_MS - elapsed; // jangan negatif
      Serial.printf(" | sisa %.1f dtk", remaining / 1000.0f); // sisipkan sisa detik
    }
    Serial.println();                         // tutup baris log
  }

  delay(100);                                 // ~10 pembacaan sensor per detik
}
