// ==================================================
// ESP32 + R503 - Fingerprint Mandiri ke Supabase
// ==================================================
// Setiap jari menempel -> cari 1:N di memori R503 -> INSERT event ke
// tabel fingerprint_events. Tanpa FastAPI, tanpa RPC.
// Protokol USB Serial lama TETAP ADA (PING/ENROLL/DELETE/CLEAR/LED_OK),
// jadi kabel ke laptop masih bisa dipakai untuk enroll.
//
// CATATAN: tabel ini hanya log/display. Absensi resmi tetap lewat
// pipeline 2FA (face-service -> POST /api/attendance).
//
// Satu-satunya yang perlu disiapkan: setup.sql dijalankan SEKALI di
// Supabase SQL Editor, WiFi + key di bawah diisi.
//
// EDIT DI SINI (5 baris):
// ==================================================

#define WIFI_SSID     "A56"        // <-- ganti
#define WIFI_PASSWORD "12345678"    // <-- ganti
#define SUPA_URL      "https://crflhxkaqqsrywqtfjef.supabase.co"  // <-- tanpa / di akhir
#define SUPA_ANON_KEY "sb_publishable_yB5BHHd9ZpvZt4HuFr_lsw_bEVTQJg6"
#define DEVICE_ID     "FP-STANDALONE-01" // <-- samakan dengan setup.sql

// ==================================================
// JANGAN UBAH MULAI DI SINI (kecuali pin/serial)
// ==================================================
// Pemasangan: R503 VCC->3V3, GND->GND, TX(R503)->GPIO16, RX(R503)->GPIO17.
// Buzzer pasif: I/O->GPIO25 (VCC modul->5V/3V3, GND->GND). Bunyi HANYA saat
// event 2xx terkirim ke Supabase (1x bip 120ms), bukan saat jari cocok lokal.
// Serial Monitor 115200 baud: [KIRIM] match/no_match terkirim ke Supabase.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Adafruit_Fingerprint.h>

#define FW_VERSION "1.0fp"
#define RX_PIN 16
#define TX_PIN 17
#define WAKEUP_PIN 4
#define SENSOR_BAUD 57600
#define WIFI_TIMEOUT_MS 20000UL
#define LED_PIN 2
#define BUZZER_PIN 25        // buzzer pasif: tone() butuh PWM, GPIO25 bebas & bukan strapping pin

HardwareSerial fpSerial(2);
Adafruit_Fingerprint finger(&fpSerial);
// TLS dibuat BARU setiap percobaan kirim (bukan global): objek yang dipakai
// ulang bisa terjebak dalam state rusak setelah handshake gagal (-1),
// sehingga percobaan ulang memakai koneksi yang sama juga gagal.
static void blinkOk() {
  digitalWrite(LED_PIN, HIGH);
  delay(150);
  digitalWrite(LED_PIN, LOW);
}

// Buzzer pasif: tone() menghasilkan gelombang kotak di GPIO (bukan digitalWrite).
// Non-blocking (durasi dijadwalkan hardware), jadi alur verifikasi tidak tertahan.
static void bipOk() {
  tone(BUZZER_PIN, 2000, 120);
}

bool sensorOk = false;

// ---------- LED ring R503 ----------
void ledBiru()  { finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 100, FINGERPRINT_LED_BLUE); }
void ledHijau() { finger.LEDcontrol(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_PURPLE); }
void ledMerah() { finger.LEDcontrol(FINGERPRINT_LED_FLASHING, 25, FINGERPRINT_LED_RED, 3); }
void ledMati()  { finger.LEDcontrol(FINGERPRINT_LED_OFF, 0, FINGERPRINT_LED_BLUE); }

// ---------- USB Serial ke laptop ----------
void kirim(const String &baris) {
  Serial.println(baris);
  Serial.flush();
}

void kirimKode(const char *perintah, uint8_t id, uint8_t kode) {
  char buffer[48];
  snprintf(buffer, sizeof(buffer), "%s %u %u", perintah, id, kode);
  kirim(buffer);
}

// ---------- WiFi ----------
static bool ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < WIFI_TIMEOUT_MS) {
    delay(500);
  }
  return WiFi.status() == WL_CONNECTED;
}

// ---------- Kirim event ke Supabase ----------
static void kirimEvent(int slot, int conf, const char *status) {
  // Cek status SETIAP kali kirim: WiFi ESP32 bisa putus kapan saja.
  // (Versi lama memakai flag wifiDone yang tidak pernah dicek ulang,
  //  sehingga event hilang diam-diam setelah WiFi sempat putus.)
  if (WiFi.status() != WL_CONNECTED && !ensureWifi()) {
    Serial.println("[ERR] WiFi belum tersambung, event dilewati");
    return;
  }

  String body = "{\"device_id\":\"" + String(DEVICE_ID) + "\","
                "\"status\":\"" + String(status) + "\"";
  if (slot < 0) {
    body += ",\"slot_id\":null,\"confidence\":null}";
  } else {
    body += ",\"slot_id\":" + String(slot) + ",\"confidence\":" + String(conf) + "}";
  }

  // Maks 3 percobaan dengan objek TLS segar tiap kali.
  for (int attempt = 0; attempt < 3; attempt++) {
    WiFiClientSecure tls;
    tls.setInsecure();
    HTTPClient http;
    http.setTimeout(10000);
    if (!http.begin(tls, String(SUPA_URL) + "/rest/v1/fingerprint_events")) {
      delay(300);
      continue;
    }
    http.addHeader("apikey", SUPA_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPA_ANON_KEY);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Prefer", "return=minimal");
    int code = http.POST(body);
    http.end();

    if (code >= 200 && code < 300) {
      Serial.printf("[KIRIM] %s slot=%d conf=%d\n", status, slot, conf);
      bipOk();
      blinkOk();
      return;
    }
    Serial.printf("[ERR] HTTP %d (percobaan %d)\n", code, attempt + 1);
    delay(500);
  }
}

// ---------- Pembacaan fisik ----------
uint8_t tungguJari(uint32_t timeout_ms = 15000) {
  uint32_t mulai = millis();
  while (millis() - mulai < timeout_ms) {
    uint8_t p = finger.getImage();
    if (p == FINGERPRINT_OK) return FINGERPRINT_OK;
    if (p == FINGERPRINT_NOFINGER) { delay(50); continue; }
    return p;
  }
  return FINGERPRINT_TIMEOUT;
}

void tungguJariAngkat(uint32_t timeout_ms = 4000) {
  uint32_t mulai = millis();
  while (millis() - mulai < timeout_ms) {
    if (finger.getImage() == FINGERPRINT_NOFINGER) return;
    delay(50);
  }
}

// ---------- Enroll (2 tempelan, simpan ke flash R503) ----------
void enrollFinger(uint8_t id) {
  kirim(String("PLACE ") + id);
  ledBiru();

  uint8_t p = tungguJari();
  if (p != FINGERPRINT_OK) { kirimKode("ENROLL_FAIL", id, p); ledMerah(); return; }

  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) { kirimKode("ENROLL_FAIL", id, p); ledMerah(); return; }

  kirim("REMOVE");
  tungguJariAngkat();

  kirim(String("PLACE ") + id);
  p = tungguJari();
  if (p != FINGERPRINT_OK) { kirimKode("ENROLL_FAIL", id, p); ledMerah(); return; }

  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) { kirimKode("ENROLL_FAIL", id, p); ledMerah(); return; }

  p = finger.createModel();
  if (p != FINGERPRINT_OK) { kirimKode("ENROLL_FAIL", id, p); ledMerah(); return; }

  p = finger.storeModel(id);
  if (p != FINGERPRINT_OK) { kirimKode("ENROLL_FAIL", id, p); ledMerah(); return; }

  kirimKode("ENROLL_OK", id, 0);
  ledHijau();
  delay(600);
  ledMati();
  tungguJariAngkat();  // Wajib: tunggu jari diangkat agar tidak langsung terverifikasi
}

// ---------- Verifikasi 1:N + kirim ke Supabase ----------
void verifikasi() {
  uint8_t p = finger.getImage();
  if (p != FINGERPRINT_OK) return;

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) return;

  p = finger.fingerSearch();
  if (p == FINGERPRINT_OK) {
    char buffer[48];
    snprintf(buffer, sizeof(buffer), "MATCH %u %u", finger.fingerID, finger.confidence);
    kirim(buffer);
    kirimEvent((int)finger.fingerID, (int)finger.confidence, "match");
    ledHijau();
    delay(400);
    ledMati();
  } else {
    kirim("NOMATCH");
    kirimEvent(-1, -1, "no_match");
    ledMerah();
    delay(300);
    ledMati();
  }

  tungguJariAngkat();
  delay(300);
}

// ---------- Parser perintah Serial (tetap kompatibel dengan face-service) ----------
void prosesPerintah(String baris) {
  baris.trim();
  if (baris.length() == 0) return;

  if (baris == "PING" || baris == "m") {
    finger.getTemplateCount();
    kirim(String("PONG ") + finger.templateCount);
    return;
  }

  if (baris == "LED_OK") {
    ledHijau();
    delay(700);
    ledMati();
    kirim("LED_DONE");
    return;
  }

  if (baris == "CLEAR" || baris == "c") {
    uint8_t p = finger.emptyDatabase();
    kirim(p == FINGERPRINT_OK ? String("CLEAR_OK 0") : String("CLEAR_FAIL ") + p);
    return;
  }

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

  int spasi = baris.indexOf(' ');
  String perintah = (spasi < 0) ? baris : baris.substring(0, spasi);
  int id = (spasi < 0) ? -1 : baris.substring(spasi + 1).toInt();

  if (perintah == "ENROLL") {
    if (id < 1 || id > 200) { kirim("ENROLL_FAIL 0 255"); return; }
    kirim(String("ENROLLING ") + id);
    enrollFinger((uint8_t)id);
    return;
  }

  if (perintah == "DELETE" || perintah == "d") {
    if (id < 1 || id > 200) { kirim("DELETE_FAIL 0 255"); return; }
    uint8_t p = finger.deleteModel((uint8_t)id);
    if (p == FINGERPRINT_OK) kirimKode("DELETE_OK", id, 0);
    else kirimKode("DELETE_FAIL", id, p);
    return;
  }

  // Angka saja (mis. "6" dari Enter nyasar) = enroll id itu. Mencegah ERR_UNKNOWN.
  if (perintah.length() > 0 && isDigit(perintah.charAt(0))) {
    int n = perintah.toInt();
    if (n >= 1 && n <= 200) {
      kirim(String("ENROLLING ") + n);
      enrollFinger((uint8_t)n);
      return;
    }
  }

  kirim(String("ERR_UNKNOWN ") + perintah);
}

void setup() {
  Serial.begin(115200);
  pinMode(WAKEUP_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  fpSerial.begin(SENSOR_BAUD, SERIAL_8N1, RX_PIN, TX_PIN);
  delay(300);
  kirim(String("BOOT ") + FW_VERSION);

  finger.begin(SENSOR_BAUD);
  delay(100);

  if (!finger.verifyPassword()) {
    kirim("SENSOR_FAIL 0");
    return;  // Jangan while(1): biarkan perintah Serial tetap bisa dipakai.
  }
  sensorOk = true;
  finger.getTemplateCount();
  kirim(String("READY ") + finger.templateCount);
  ledBiru();

  ensureWifi();       // Coba sekali saat boot; kirimEvent() akan mencoba lagi bila putus.
  WiFi.setSleep(false);  // Cegah TLS handshake gagal setelah idle panjang.
}

void loop() {
  if (Serial.available()) {
    String baris = Serial.readStringUntil('\n');
    prosesPerintah(baris);
    return;
  }
  if (!sensorOk) {
    delay(500);
    return;
  }
  verifikasi();
  delay(50);
}
