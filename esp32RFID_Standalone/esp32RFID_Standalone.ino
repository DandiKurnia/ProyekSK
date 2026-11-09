// ==================================================
// ESP32 + RC522 SAJA (tanpa R503/sidik jari).
// Tap kartu -> cek UID di rfid_cards -> INSERT rfid_events.
// Daftar kartu lewat Serial: "CARD <student_id>" atau "r".
//
// CATATAN: tap kartu di sini hanya log/display. Absensi resmi tetap lewat
// pipeline 2FA (face-service + sketch R503 mandiri -> POST /api/attendance).
//
// Prasyarat: esp32RFID_Standalone/setup.sql dijalankan SEKALI di
// Supabase SQL Editor, WiFi + key di bawah diisi.
//
// EDIT DI SINI (5 baris):
// ==================================================

#define WIFI_SSID     "A56"        // <-- ganti
#define WIFI_PASSWORD "12345678"    // <-- ganti
#define SUPA_URL      "https://crflhxkaqqsrywqtfjef.supabase.co"  // <-- tanpa / di akhir
#define SUPA_ANON_KEY "sb_publishable_yB5BHHd9ZpvZt4HuFr_lsw_bEVTQJg6"
#define DEVICE_ID     "EDGE-01"          // <-- samakan dengan setup.sql

// ==================================================
// JANGAN UBAH MULAI DI SINI (kecuali pin/timing)
// ==================================================
// Pemasangan RC522 (SPI, 3.3V saja): SDA->GPIO5, SCK->GPIO18,
// MOSI->GPIO23, MISO->GPIO19, RST->GPIO22, 3V3->3V3, GND->GND.
// Buzzer pasif: I/O->GPIO25 (VCC modul->5V/3V3, GND->GND). Bunyi HANYA saat
// event 2xx terkirim ke Supabase (1x bip 120ms), bukan saat kartu terbaca lokal.
// Serial Monitor 115200 baud: [KIRIM] known/unknown per kartu.
#define RC522_SS_PIN  5
#define RC522_SCK_PIN 18
#define RC522_MOSI_PIN 23
#define RC522_MISO_PIN 19
#define RC522_RST_PIN 22

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>

#define FW_VERSION    "1.0rfid"
#define WIFI_TIMEOUT_MS 20000UL
#define LED_PIN       2
#define DEBOUNCE_MS   2000UL // Kartu yang ditahan tidak dihitung ulang.
#define BUZZER_PIN    25     // buzzer pasif: tone() butuh PWM, GPIO25 bebas & bukan strapping pin

MFRC522 rfid(RC522_SS_PIN, RC522_RST_PIN);
String lastUid = "";
unsigned long lastTap = 0;

// ---------- LED onboard (satu LED, pola kedip sebagai kode) ----------
static void blinkOk() {
  digitalWrite(LED_PIN, HIGH);
  delay(150);
  digitalWrite(LED_PIN, LOW);
}

// Buzzer pasif: tone() menghasilkan gelombang kotak di GPIO (bukan digitalWrite).
// Non-blocking (durasi dijadwalkan hardware), jadi polling kartu tidak tertahan.
static void bipOk() {
  tone(BUZZER_PIN, 2000, 120);
}

void ledBiru()  { digitalWrite(LED_PIN, HIGH); }           // Sibuk/menunggu.
void ledMati()  { digitalWrite(LED_PIN, LOW); }
void ledHijau() { blinkOk(); }                             // Sukses: kedip 1x.
void ledMerah() { blinkOk(); delay(150); blinkOk(); }      // Gagal: kedip 2x.

// ---------- USB Serial ke laptop ----------
void kirim(const String &baris) {
  Serial.println(baris);
  Serial.flush();
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

// ---------- Util: UID kartu -> string hex "A3:1F:22:04" ----------
static String bacaUid() {
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (i > 0) uid += ":";
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  return uid;
}

// ---------- Cek UID ke Supabase (rfid_cards) ----------
// 1 = terdaftar, 0 = kartu asing, -1 = jaringan gagal (jangan dicatat
// sebagai 'unknown' karena itu akan mengotori log).
static int uidTerdaftar(const String &uid) {
  if (WiFi.status() != WL_CONNECTED && !ensureWifi()) return -1;
  WiFiClientSecure tls;
  tls.setInsecure();
  HTTPClient http;
  http.setTimeout(8000);
  String url = String(SUPA_URL) + "/rest/v1/rfid_cards?select=uid&uid=eq."
             + uid + "&limit=1";
  if (!http.begin(tls, url)) return -1;
  http.addHeader("apikey", SUPA_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPA_ANON_KEY);
  int code = http.GET();
  int hasil = -1;
  if (code == 200) {
    String jawab = http.getString();
    hasil = (jawab.length() > 2) ? 1 : 0; // Selain "[]" berarti ada baris cocok.
  }
  http.end();
  return hasil;
}

// ---------- Kirim satu baris JSON ke tabel manapun ----------
// Mengembalikan true bila Supabase menjawab 2xx. Error 4xx (data ditolak)
// tidak diulang karena hasilnya pasti sama.
static bool postEvent(const String &path, const String &body,
                      const char *prefer = "return=minimal") {
  if (WiFi.status() != WL_CONNECTED && !ensureWifi()) {
    Serial.println("[ERR] WiFi belum tersambung, event dilewati");
    return false;
  }
  for (int attempt = 0; attempt < 3; attempt++) {
    WiFiClientSecure tls;  // Segar tiap percobaan (TLS ESP32 rapuh setelah idle).
    tls.setInsecure();
    HTTPClient http;
    http.setTimeout(10000);
    if (!http.begin(tls, String(SUPA_URL) + "/rest/v1/" + path)) {
      delay(300);
      continue;
    }
    http.addHeader("apikey", SUPA_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPA_ANON_KEY);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Prefer", prefer);
    int code = http.POST(body);
    String jawab = (code >= 400) ? http.getString() : String();
    http.end();
    if (code >= 200 && code < 300) return true;
    Serial.printf("[ERR] HTTP %d (percobaan %d) %s\n", code, attempt + 1, jawab.c_str());
    if (code >= 400 && code < 500) return false;
    delay(500);
  }
  return false;
}

// ---------- Daftarkan kartu baru: perintah Serial "CARD <student_id>" ----------
// Tunggu kartu ditempel maks 15 dtk, lalu upsert ke rfid_cards.
// Kartu yang sudah terikat ke siswa lain akan dipindah ke siswa baru.
static void daftarKartu(const String &studentId) {
  // Validasi input (masuk ke JSON): hanya huruf/angka/-/_ .
  if (studentId.length() == 0 || studentId.length() > 32) {
    kirim("CARD_FAIL format: CARD <student_id>");
    return;
  }
  for (unsigned int i = 0; i < studentId.length(); i++) {
    char c = studentId.charAt(i);
    if (!isAlphaNumeric(c) && c != '-' && c != '_') {
      kirim("CARD_FAIL student_id hanya boleh huruf/angka/-/_");
      return;
    }
  }

  kirim(String("TAP_CARD ") + studentId);
  ledBiru();
  unsigned long t0 = millis();
  while (millis() - t0 < 15000UL) {
    if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      String uid = bacaUid();
      rfid.PICC_HaltA();
      rfid.PCD_StopCrypto1();
      String body = "{\"uid\":\"" + uid + "\",\"student_id\":\"" + studentId + "\"}";
      if (postEvent("rfid_cards?on_conflict=uid", body,
                    "resolution=merge-duplicates,return=minimal")) {
        kirim(String("CARD_OK ") + uid + " " + studentId);
        ledHijau();
      } else {
        kirim(String("CARD_FAIL ") + uid + " (cek student_id ada di tabel students)");
        ledMerah();
      }
      delay(600);
      ledMati();
      lastUid = uid;          // Cegah tap yang sama langsung terbaca sebagai absen.
      lastTap = millis();
      return;
    }
    delay(50);
  }
  kirim("CARD_TIMEOUT");
  ledMati();
}

// ---------- Kirim event tap kartu ----------
static void kirimRfid(const String &uid, const char *status) {
  String body = "{\"device_id\":\"" + String(DEVICE_ID) + "\","
                "\"uid\":\"" + uid + "\","
                "\"status\":\"" + status + "\"}";
  if (postEvent("rfid_events", body)) {
    Serial.printf("[KIRIM] %s uid=%s\n", status, uid.c_str());
    bipOk();
    blinkOk();
  }
}

// ---------- Tap kartu: debounce + cek + kirim ----------
void cekKartu() {
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  String uid = bacaUid();
  unsigned long now = millis();
  if (uid == lastUid && now - lastTap < DEBOUNCE_MS) return; // Kartu ditahan.
  lastUid = uid;
  lastTap = now;

  char buffer[64];
  snprintf(buffer, sizeof(buffer), "RFID %s", uid.c_str());
  kirim(buffer);

  int dikenal = uidTerdaftar(uid);
  if (dikenal < 0) {           // Jaringan gagal: jangan catat 'unknown' palsu.
    kirim(String("OFFLINE ") + uid);
    ledMerah();
    delay(300);
    ledMati();
    return;
  }
  if (dikenal == 1) {
    kirim(String("KNOWN ") + uid);
    ledHijau();
  } else {
    kirim(String("UNKNOWN ") + uid);
    ledMerah();
  }
  delay(300);
  ledMati();
  kirimRfid(uid, dikenal == 1 ? "known" : "unknown");
}

// ---------- Parser perintah Serial ----------
void prosesPerintah(String baris) {
  baris.trim();
  if (baris.length() == 0) return;

  if (baris == "PING") {
    kirim("PONG rfid");
    return;
  }

  if (baris == "LED_OK") {
    ledHijau();
    delay(700);
    ledMati();
    kirim("LED_DONE");
    return;
  }

  // Mode interaktif: ketik "r" lalu Enter -> sistem tanya student_id -> tempel kartu.
  if (baris == "r") {
    Serial.println("Masukkan student_id (contoh: 40123292 atau S001):");
    while (!Serial.available()) delay(10);
    String sid = Serial.readStringUntil('\n');
    sid.trim();
    daftarKartu(sid);
    return;
  }

  int spasi = baris.indexOf(' ');
  String perintah = (spasi < 0) ? baris : baris.substring(0, spasi);

  // Daftarkan kartu RFID ke siswa: "CARD <student_id>" (mis. "CARD 40123292").
  if (perintah == "CARD" || perintah == "R") {
    String sid = (spasi < 0) ? String() : baris.substring(spasi + 1);
    sid.trim();
    if (sid.length() > 0) { daftarKartu(sid); return; }
    Serial.println("Format: CARD <student_id>  (contoh: CARD 40123292)");
    return;
  }

  kirim(String("ERR_UNKNOWN ") + perintah);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  delay(300);
  kirim(String("BOOT ") + FW_VERSION);

  SPI.begin(RC522_SCK_PIN, RC522_MISO_PIN, RC522_MOSI_PIN, RC522_SS_PIN);
  rfid.PCD_Init();
  rfid.PCD_DumpVersionToSerial();
  kirim("READY");

  ensureWifi();          // Coba sekali saat boot; kirim ulang otomatis bila putus.
  WiFi.setSleep(false);  // Cegah TLS handshake gagal setelah idle panjang.
}

void loop() {
  if (Serial.available()) {
    String baris = Serial.readStringUntil('\n');
    prosesPerintah(baris);
    return;
  }
  cekKartu();            // Non-blocking, ~1 ms bila tidak ada kartu.
  delay(50);
}
