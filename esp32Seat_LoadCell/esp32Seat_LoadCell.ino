// ==================================================
// ESP32 + Load Cell (HX711) - Status Okupansi Kursi ke Supabase
// ==================================================
// State machine kursi (hysteresis) -> upsert ke tabel seat_status yang
// sudah ada. Tanpa FastAPI, tanpa RPC, tanpa file lain.
// Satu-satunya yang perlu disiapkan: setup.sql dijalankan SEKALI di
// Supabase SQL Editor, WiFi + key di bawah diisi.
//
// EDIT DI SINI (5 baris):
// ==================================================

#define WIFI_SSID     "A56"        // <-- ganti
#define WIFI_PASSWORD "12345678"    // <-- ganti
#define SUPA_URL      "https://crflhxkaqqsrywqtfjef.supabase.co"  // <-- tanpa / di akhir
#define SUPA_ANON_KEY "sb_publishable_yB5BHHd9ZpvZt4HuFr_lsw_bEVTQJg6"
#define SEAT_ID       "SEAT-01"          // <-- samakan dengan setup.sql

// ==================================================
// JANGAN UBAH MULAI DI SINI (kecuali pin/ambang)
// ==================================================
// Pemasangan: HX711 VCC->3V3, GND->GND, DT/DOUT->GPIO19, SCK/CLK->GPIO18.
// Serial Monitor 115200 baud: [KIRIM] = status berubah/heartbeat (LED kedip 1x).
// [ERR] HTTP 403 = setup.sql belum jalan.

#include <Arduino.h>
#include <math.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "HX711.h"  // Library "HX711 Arduino Library" (bogde)

#define FW_VERSION "1.0seat"
#define HX711_DOUT_PIN 19
#define HX711_SCK_PIN  18
#define LED_PIN 2
#define WIFI_TIMEOUT_MS 20000UL
#define HEARTBEAT_MS 60000UL  // Kirim ulang status walau tidak berubah.

// Kalibrasi dari data uji: (853728 - 660691) / 174 ~= 1109.4.
// Jika gram negatif saat diberi beban, ubah jadi -1109.4.
#define CALIBRATION_FACTOR 1109.4f
#define ZERO_DEADBAND_G 3.0f      // |gram| <= 3 dianggap 0.
#define OCCUPIED_THRESHOLD_G 20.0f  // >= 20 g stabil 1 dtk = terisi
#define EMPTY_THRESHOLD_G    10.0f  // <= 10 g mulai timer kosong
#define RECOVERY_THRESHOLD_G 15.0f  // >= 15 g batalkan timer kosong
#define OCCUPIED_CONFIRM_MS 1000UL
#define ABSENCE_DELAY_MS    5000UL

enum SeatState { WAITING_FOR_LOAD, OCCUPIED, EMPTY_PENDING, ABSENT };

HX711 loadCell;
WiFiClientSecure tls;
SeatState seatState = WAITING_FOR_LOAD;
unsigned long occupiedCandidateSince = 0;
unsigned long emptySince = 0;
unsigned long lastHeartbeat = 0;
const char* lastSentStatus = "";

static void blink(int times, int ms) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(ms);
    digitalWrite(LED_PIN, LOW);
    delay(ms);
  }
}

static bool ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi ...");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < WIFI_TIMEOUT_MS) {
    Serial.print(".");
    delay(500);
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK" : " GAGAL");
  return WiFi.status() == WL_CONNECTED;
}

static float readWeightGrams() {
  float grams = loadCell.get_units(5);  // Rata-rata 5x untuk redam noise.
  if (fabsf(grams) <= ZERO_DEADBAND_G) grams = 0.0f;
  return grams;
}

static void updateSeatState(float grams, unsigned long now) {
  switch (seatState) {
    case WAITING_FOR_LOAD:
    case ABSENT:
      if (grams >= OCCUPIED_THRESHOLD_G) {
        if (occupiedCandidateSince == 0) occupiedCandidateSince = now;
        if (now - occupiedCandidateSince >= OCCUPIED_CONFIRM_MS) {
          seatState = OCCUPIED;
          occupiedCandidateSince = 0;
          emptySince = 0;
        }
      } else {
        occupiedCandidateSince = 0;
      }
      break;
    case OCCUPIED:
      if (grams <= EMPTY_THRESHOLD_G) {
        emptySince = now;
        seatState = EMPTY_PENDING;
      }
      break;
    case EMPTY_PENDING:
      if (grams >= RECOVERY_THRESHOLD_G) {
        seatState = OCCUPIED;
        emptySince = 0;
      } else if (now - emptySince >= ABSENCE_DELAY_MS) {
        seatState = ABSENT;
        emptySince = 0;
      }
      break;
  }
}

// Status yang dikirim ke Supabase. EMPTY_PENDING tetap occupied sampai
// timer 5 dtk habis (ABSENT) — timer hanya urusan firmware.
static const char* reportStatus() {
  switch (seatState) {
    case OCCUPIED:
    case EMPTY_PENDING: return "occupied";
    case ABSENT:        return "empty";
    default:            return "unknown";
  }
}

static int sendStatus(const char* status, float grams) {
  String body = "{\"seat_id\":\"" + String(SEAT_ID) + "\","
                "\"status\":\"" + String(status) + "\","
                "\"weight_kg\":" + String(grams / 1000.0f, 3) + "}";

  HTTPClient http;
  http.setTimeout(15000);
  if (!http.begin(tls, String(SUPA_URL) + "/rest/v1/seat_status?on_conflict=seat_id")) return -1;
  http.addHeader("apikey", SUPA_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPA_ANON_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "resolution=merge-duplicates,return=minimal");
  int code = http.POST(body);
  http.end();
  return code;
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  tls.setInsecure();  // Uji coba. Produksi: pasang CA root Supabase.
  Serial.println("BOOT " FW_VERSION);
  ensureWifi();

  loadCell.begin(HX711_DOUT_PIN, HX711_SCK_PIN);
  loadCell.set_scale(CALIBRATION_FACTOR);
  while (!loadCell.wait_ready_timeout(1000)) {
    Serial.println("HX711 belum terbaca. Periksa VCC, GND, DT/DOUT, SCK/CLK.");
    delay(500);
  }
  delay(2000);
  loadCell.tare(20);  // Tanpa beban saat nyala = nol.
  Serial.println("Tare selesai. Kirim pertama saat status stabil.");
}

void loop() {
  if (!loadCell.wait_ready_timeout(500)) {
    Serial.println("ERROR: HX711 tidak siap.");
    delay(300);
    return;
  }

  float grams = readWeightGrams();
  if (isnan(grams) || isinf(grams)) {  // Pembacaan rusak -> jangan kirim JSON invalid.
    Serial.println("[SKIP] HX711 nilai invalid");
    delay(100);
    return;
  }
  unsigned long now = millis();
  updateSeatState(grams, now);

  const char* status = reportStatus();
  bool changed = strcmp(status, lastSentStatus) != 0;
  bool heartbeat = (now - lastHeartbeat >= HEARTBEAT_MS);

  if (!changed && !heartbeat) {
    delay(100);
    return;
  }
  if (!ensureWifi()) {
    Serial.println("[ERR] WiFi putus");
    delay(1000);
    return;
  }

  int code = sendStatus(status, grams);
  if (code >= 200 && code < 300) {
    lastSentStatus = status;
    lastHeartbeat = now;
    Serial.printf("[KIRIM] %s %.1f g\n", status, grams);
    blink(1, 150);
  } else {
    Serial.printf("[ERR] HTTP %d\n", code);
    delay(1000);
  }
}
