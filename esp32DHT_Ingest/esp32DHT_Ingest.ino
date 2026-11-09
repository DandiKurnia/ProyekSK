// ==================================================
// ESP32 + DHT - Telemetri Suhu & Kelembaban ke Supabase
// ==================================================
// Baca sensor tiap 30 dtk -> POST langsung ke Supabase (upsert 1 baris
// per device). Tanpa FastAPI, tanpa RPC, tanpa file lain.
// Satu-satunya yang perlu disiapkan: setup.sql dijalankan SEKALI di
// Supabase SQL Editor, WiFi + key di bawah diisi.
//
// EDIT DI SINI (5 baris):
// ==================================================

#define WIFI_SSID     "nama-wifi"        // <-- ganti
#define WIFI_PASSWORD "password-wifi"    // <-- ganti
#define SUPA_URL      "https://crflhxkaqqsrywqtfjef.supabase.co"  // <-- ganti, tanpa / di akhir
#define SUPA_ANON_KEY "sb_publishable_yB5BHHd9ZpvZt4HuFr_lsw_bEVTQJg6"        // <-- ganti (publishable key, BUKAN secret)
#define DEVICE_ID     "ENV-XII-RPL-1"    // <-- samakan dengan setup.sql
#define CLASS_ID      "XII-RPL-1"        // <-- samakan dengan setup.sql

// ==================================================
// JANGAN UBAH MULAI DI SINI (kecuali pin/timing)
// ==================================================
// Pemasangan: DHT VCC->3V3, DATA->GPIO15, GND->GND.
// Serial Monitor 115200 baud: [OK] = terkirim (LED kedip 1x).
// [SKIP] = sensor gagal baca. [ERR] HTTP 403 = setup.sql belum jalan.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>  // Library "DHT sensor library" (Adafruit)

#define FW_VERSION "1.0dht"
#define DHT_PIN 15          // Pin DATA sensor
#define DHT_MODEL DHT22     // Kalau modulnya DHT11, ganti jadi DHT11
#define LED_PIN 2           // LED onboard
#define SEND_EVERY_MS 30000UL
#define WIFI_TIMEOUT_MS 20000UL

DHT dht(DHT_PIN, DHT_MODEL);
WiFiClientSecure tls;

unsigned long lastSend = 0;
int failCount = 0;

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

static int sendReading(float tempC, float humPct) {
  String body = "{\"device_id\":\"" + String(DEVICE_ID) + "\","
                "\"class_id\":\"" + String(CLASS_ID) + "\","
                "\"temperature_c\":" + String(tempC, 1) + ","
                "\"humidity_pct\":" + String(humPct, 1) + "}";

  HTTPClient http;
  http.setTimeout(15000);
  if (!http.begin(tls, String(SUPA_URL) + "/rest/v1/classroom_env?on_conflict=device_id")) return -1;
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
  dht.begin();
  tls.setInsecure();  // Uji coba. Produksi: pasang CA root Supabase.
  Serial.println("BOOT " FW_VERSION);
  ensureWifi();
  lastSend = millis() - SEND_EVERY_MS;  // Kirim sekali saat nyala.
}

void loop() {
  if (millis() - lastSend < SEND_EVERY_MS) {
    delay(500);
    return;
  }
  lastSend = millis();

  float hum = dht.readHumidity();
  float temp = dht.readTemperature();

  if (isnan(hum) || isnan(temp)) {
    Serial.println("[SKIP] sensor gagal baca");
    return;
  }
  if (!ensureWifi()) {
    Serial.println("[ERR] WiFi putus");
    return;
  }

  int code = sendReading(temp, hum);
  if (code >= 200 && code < 300) {
    failCount = 0;
    Serial.printf("[OK] %.1fC %.1f%%\n", temp, hum);
    blink(1, 150);
  } else {
    failCount++;
    Serial.printf("[ERR] HTTP %d\n", code);
    if (failCount >= 3) {
      failCount = 0;
      WiFi.disconnect();
      ensureWifi();
    }
  }
}
