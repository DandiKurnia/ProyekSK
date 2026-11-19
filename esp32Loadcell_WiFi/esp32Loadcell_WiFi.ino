/*
 * Sensor kursi load cell HX711 -> Wi-Fi -> Route Handler Next.js -> Supabase.
 * Status ditentukan di firmware (histeresis), backend hanya menyimpan.
 * Endpoint: POST /api/seats/status
 * Board: ESP32 (DOUT=19, SCK=18). Library: "HX711" oleh bogde.
 * Wajib: device_id terdaftar di tabel devices (type seat_esp32) dan
 *        seats.device_id kursi menunjuk ke device yang sama.
 */
#include <Arduino.h>
#include <math.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "HX711.h"

// ===================== KONFIGURASI =====================
// Dev: IP LAN laptop, mis. "http://192.168.1.10:3000/api/seats/status".
// Produksi: host Next.js, mis. "https://xxx.vercel.app/api/seats/status".
const char *API_URL = "http://192.168.1.6:3000/api/seats/status"; // IP LAN laptop (cek ipconfig sebelum flash)

#include "secrets.h" // WIFI_SSID + WIFI_PASS — tidak di-commit, lihat secrets.h.example

const char *DEVICE_ID = "SEAT-ESP-01"; // harus ada di tabel devices
const char *SEAT_ID   = "SEAT-01";     // seats.device_id harus = DEVICE_ID
const char *FIRMWARE_VERSION = "1.0.0";

const uint32_t HEARTBEAT_MS = 20000; // kirim ulang walau status tak berubah
const uint32_t HTTP_TIMEOUT_MS = 6000;
const uint32_t WIFI_RETRY_MS = 10000;
const uint32_t RETRY_MIN_MS = 2000;
const uint32_t RETRY_MAX_MS = 30000;

// ===================== HARDWARE & AMBANG =====================
const uint8_t HX711_DOUT_PIN = 19;
const uint8_t HX711_SCK_PIN  = 18;

HX711 loadCell;

// Faktor awal data uji: (853728 - 660691) / 174 ~= 1109.4.
// Bila gram terbaca negatif saat dibebani, ubah tandanya menjadi -1109.4.
const float CALIBRATION_FACTOR = 1109.4f;

const float ZERO_DEADBAND_G = 3.0f; // -2.2 g tampil sebagai 0 g

// Ambang prototipe untuk beban contoh 30 gram (BUKAN ambang manusia).
const float OCCUPIED_THRESHOLD_G = 20.0f;
const float EMPTY_THRESHOLD_G    = 10.0f;
const float RECOVERY_THRESHOLD_G = 15.0f;

const unsigned long OCCUPIED_CONFIRM_MS = 1000;
const unsigned long ABSENCE_DELAY_MS    = 5000;
const unsigned long PRINT_INTERVAL_MS   = 500;

// ===================== STATE =====================
enum SeatState { WAITING_FOR_LOAD, OCCUPIED, EMPTY_PENDING, ABSENT };

SeatState seatState = WAITING_FOR_LOAD;
unsigned long occupiedCandidateSince = 0;
unsigned long emptySince = 0;
unsigned long lastPrint = 0;
float lastWeightG = 0.0f;

// Status yang belum berhasil dikirim; hanya yang terbaru disimpan.
bool dirty = true;
const char *pendingStatus = "unknown";
float pendingGrams = NAN;
unsigned long lastAttempt = 0;
unsigned long retryDelay = RETRY_MIN_MS;
unsigned long lastHeartbeat = 0;
unsigned long lastWifiAttempt = 0;

const char *stateText(SeatState state) {
  switch (state) {
    case WAITING_FOR_LOAD: return "MENUNGGU BEBAN PERTAMA";
    case OCCUPIED:         return "TERISI";
    case EMPTY_PENDING:    return "KOSONG SEMENTARA - TIMER 5 DETIK";
    case ABSENT:           return "ABSEN - BEBAN HILANG >= 5 DETIK";
    default:               return "STATUS TIDAK DIKETAHUI";
  }
}

float readWeightGrams() {
  float grams = loadCell.get_units(5); // rata-rata 5 sampel
  if (fabsf(grams) <= ZERO_DEADBAND_G) grams = 0.0f;
  return grams;
}

void markDirty(const char *status, float grams) {
  pendingStatus = status;
  pendingGrams = grams;
  dirty = true;
}

void ensureWifi(unsigned long now) {
  if (WiFi.status() == WL_CONNECTED) return;
  if (now - lastWifiAttempt < WIFI_RETRY_MS) return;
  lastWifiAttempt = now;
  Serial.println("Wi-Fi: menyambung ulang...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

bool postStatus(const char *status, float grams) {
  if (WiFi.status() != WL_CONNECTED) return false;

  char body[256];
  if (isnan(grams)) {
    snprintf(body, sizeof(body),
             "{\"device_id\":\"%s\",\"seat_id\":\"%s\",\"status\":\"%s\","
             "\"firmware_version\":\"%s\"}",
             DEVICE_ID, SEAT_ID, status, FIRMWARE_VERSION);
  } else {
    snprintf(body, sizeof(body),
             "{\"device_id\":\"%s\",\"seat_id\":\"%s\",\"status\":\"%s\","
             "\"weight_kg\":%.3f,\"firmware_version\":\"%s\"}",
             DEVICE_ID, SEAT_ID, status, grams / 1000.0f, FIRMWARE_VERSION);
  }

  const bool https = strncmp(API_URL, "https://", 8) == 0;
  WiFiClientSecure secure;
  WiFiClient plain;
  HTTPClient http;
  if (https) {
    // Prototipe: tanpa verifikasi sertifikat. Produksi: secure.setCACert(...).
    secure.setInsecure();
    secure.setTimeout(HTTP_TIMEOUT_MS);
    http.begin(secure, API_URL);
  } else {
    http.begin(plain, API_URL);
  }
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");

  const int code = http.POST((uint8_t *)body, strlen(body));
  const String resp = code > 0 ? http.getString() : http.errorToString(code);
  http.end();

  Serial.printf("POST %s -> %d %s\n", status, code, resp.c_str());
  return code == 200;
}

void flushPending(unsigned long now) {
  if (!dirty) return;
  if (now - lastAttempt < retryDelay) return;
  lastAttempt = now;

  if (postStatus(pendingStatus, pendingGrams)) {
    dirty = false;
    retryDelay = RETRY_MIN_MS;
    lastHeartbeat = now;
  } else {
    retryDelay = min(retryDelay * 2, (uint32_t)RETRY_MAX_MS);
    Serial.printf("Kirim gagal; coba lagi dalam %lu ms\n", retryDelay);
  }
}

void updateSeatState(float grams, unsigned long now) {
  switch (seatState) {
    case WAITING_FOR_LOAD:
    case ABSENT:
      // Jangan anggap absen hanya karena kursi memang kosong sejak awal.
      if (grams >= OCCUPIED_THRESHOLD_G) {
        if (occupiedCandidateSince == 0) occupiedCandidateSince = now;
        if (now - occupiedCandidateSince >= OCCUPIED_CONFIRM_MS) {
          seatState = OCCUPIED;
          occupiedCandidateSince = 0;
          emptySince = 0;
          Serial.println("EVENT: kursi terisi.");
          markDirty("occupied", grams);
        }
      } else {
        occupiedCandidateSince = 0;
      }
      break;

    case OCCUPIED:
      // Rentang 10-20 g: pertahankan status (histeresis).
      if (grams <= EMPTY_THRESHOLD_G) {
        emptySince = now;
        seatState = EMPTY_PENDING;
        Serial.println("EVENT: beban turun; mulai hitung 5 detik.");
      }
      break;

    case EMPTY_PENDING:
      if (grams >= RECOVERY_THRESHOLD_G) {
        seatState = OCCUPIED;
        emptySince = 0;
        Serial.println("EVENT: beban kembali; timer dibatalkan.");
      } else if (now - emptySince >= ABSENCE_DELAY_MS) {
        seatState = ABSENT;
        emptySince = 0;
        Serial.println("EVENT: ABSEN - beban rendah >= 5 detik.");
        markDirty("empty", grams);
      }
      break;
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("=== LOAD CELL KURSI -> Wi-Fi ===");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Wi-Fi: menyambung");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(250);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" OK " + WiFi.localIP().toString());
  } else {
    Serial.println(" GAGAL (data terkirim setelah Wi-Fi tersambung)");
  }

  loadCell.begin(HX711_DOUT_PIN, HX711_SCK_PIN);
  loadCell.set_scale(CALIBRATION_FACTOR);
  while (!loadCell.wait_ready_timeout(1000)) {
    Serial.println("HX711 belum terbaca. Periksa VCC, GND, DT, SCK.");
    delay(500);
  }
  delay(2000);       // beri waktu sinyal stabil
  loadCell.tare(20); // kursi harus kosong saat startup
  Serial.println("Tare selesai.");

  // Kursi kosong setelah tare -> lapor baseline "empty".
  markDirty("empty", 0.0f);
}

void loop() {
  const unsigned long now = millis();
  ensureWifi(now);

  if (!loadCell.wait_ready_timeout(500)) {
    Serial.println("ERROR: HX711 tidak siap / tidak terbaca.");
    markDirty("unknown", NAN);
    flushPending(now);
    delay(300);
    return;
  }

  lastWeightG = readWeightGrams();
  updateSeatState(lastWeightG, now);

  // Heartbeat: status terakhir dikirim ulang agar devices.last_seen_at segar
  // dan Overview tidak menandai perangkat offline.
  if (!dirty && now - lastHeartbeat >= HEARTBEAT_MS) {
    markDirty(seatState == OCCUPIED ? "occupied" : "empty", lastWeightG);
  }
  flushPending(now);

  if (now - lastPrint >= PRINT_INTERVAL_MS) {
    lastPrint = now;
    Serial.printf("Berat: %.1f g | Status: %s", lastWeightG, stateText(seatState));
    if (seatState == EMPTY_PENDING) {
      const unsigned long elapsed = now - emptySince;
      const unsigned long remaining =
          elapsed >= ABSENCE_DELAY_MS ? 0 : ABSENCE_DELAY_MS - elapsed;
      Serial.printf(" | sisa %.1f dtk", remaining / 1000.0f);
    }
    Serial.println();
  }

  delay(100);
}
