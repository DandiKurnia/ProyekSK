# Komunikasi Firmware Kursi — Wi-Fi & HTTP ke Laptop

Potongan kode di `esp32Loadcell_WiFi.ino` yang **berkomunikasi ke luar board**: sambung Wi-Fi, kirim `POST` ke IP LAN laptop, dan retry/backoff saat gagal. Sisanya (HX711, histeresis, kalibrasi) ada di [README.md](README.md).

```
ESP32 ──Wi-Fi STA──> http://<IP-LAN-laptop>:3000/api/seats/status ──> Supabase
        (secrets.h)         (API_URL)                                (Route Handler)
```

| Bagian | Baris | Fungsi |
|---|---|---|
| `API_URL`, `DEVICE_ID`, `SEAT_ID`, timeout | `:16–31` | Alamat tujuan + identitas + interval |
| `secrets.h` | `:21` | SSID/password Wi-Fi (di-ignore git) |
| `ensureWifi()` | `:94–101` | Sambung ulang tiap 10 dtk bila putus |
| `postStatus()` | `:103–141` | Susun JSON, pilih klien HTTP/HTTPS, kirim POST |
| `flushPending()` | `:143–156` | Kirim status tertunda + backoff 2→30 dtk |
| Heartbeat di `loop()` | `:250–255` | Kirim ulang tiap 20 dtk walau status tetap |
| `setup()` Wi-Fi | `:207–219` | Konek awal, tunggu maks 10 dtk, lanjut walau gagal |

---

## 1. Alamat tujuan: `API_URL` (`:19`)

```cpp
// Dev: IP LAN laptop, mis. "http://192.168.1.10:3000/api/seats/status".
// Produksi: host Next.js, mis. "https://xxx.vercel.app/api/seats/status".
const char *API_URL = "http://192.168.1.6:3000/api/seats/status"; // IP LAN laptop (cek ipconfig sebelum flash)
```

- IP LAN laptop **berubah** setiap pindah jaringan/hotspot → cek `ipconfig` (Windows) atau `ip a` (Linux/macOS) sebelum flash.
- Port `3000` = `npm run dev` di `apps/web`. Kalau pakai `npm run build && npm start`, port tetap 3000 (atau `-p` bila diubah).
- Awalan `http://` → klien `WiFiClient` biasa; `https://` → `WiFiClientSecure` + `setInsecure()` (prototipe).
- Laptop dan ESP32 **harus satu jaringan**; firewall Windows harus mengizinkan port 3000 untuk jaringan privat.

Identitas yang ikut dikirim (`:23–25`):

```cpp
const char *DEVICE_ID = "SEAT-ESP-01"; // harus ada di tabel devices
const char *SEAT_ID   = "SEAT-01";     // seats.device_id harus = DEVICE_ID
const char *FIRMWARE_VERSION = "1.0.0"; // dikirim tiap POST, disimpan di devices.firmware_version
```

Interval yang mengatur irama komunikasi (`:27–31`):

```cpp
const uint32_t HEARTBEAT_MS = 20000;    // kirim ulang walau status tak berubah (jaga last_seen_at)
const uint32_t HTTP_TIMEOUT_MS = 6000;  // batas tunggu koneksi + respons HTTP
const uint32_t WIFI_RETRY_MS = 10000;   // jeda minimum antar percobaan sambung ulang Wi-Fi
const uint32_t RETRY_MIN_MS = 2000;     // backoff awal saat kirim gagal
const uint32_t RETRY_MAX_MS = 30000;    // backoff maksimum (tidak tumbuh tanpa batas)
```
---

## 2. Kredensial Wi-Fi: `secrets.h` (`:21`)

```cpp
#include "secrets.h" // WIFI_SSID + WIFI_PASS — tidak di-commit, lihat secrets.h.example
```

`secrets.h` ter-ignore git (`**/secrets.h` di `.gitignore`). Isinya hanya dua konstanta:

```cpp
#pragma once
const char *WIFI_SSID = "GANTI_SSID";
const char *WIFI_PASS = "GANTI_PASSWORD";
```

Tidak ada kunci Supabase di firmware — kredensial database hanya hidup di server Next.js.

---

## 3. Sambung awal di `setup()` (`:207–219`)

```cpp
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
```

Boot **tidak menggantung** kalau Wi-Fi belum siap: setelah 10 dtk firmware lanjut (tare HX711), lalu `ensureWifi()` di `loop()` yang mengejar koneksi.

---

## 4. Sambung ulang: `ensureWifi()` (`:94–101`)

```cpp
void ensureWifi(unsigned long now) {          // Jaga Wi-Fi tetap tersambung
  if (WiFi.status() == WL_CONNECTED) return;  // sudah tersambung: tidak ada kerja
  if (now - lastWifiAttempt < WIFI_RETRY_MS) return; // belum 10 dtk sejak percobaan terakhir
  lastWifiAttempt = now;                      // catat waktu percobaan
  Serial.println("Wi-Fi: menyambung ulang..."); // log ke Serial Monitor
  WiFi.disconnect();                          // bersihkan state koneksi lama
  WiFi.begin(WIFI_SSID, WIFI_PASS);           // mulai sambung ulang (non-blocking)
}
```

Non-blocking: dipanggil tiap iterasi `loop()` (`:237`) tetapi hanya benar-benar bekerja setiap 10 dtk. Data yang belum terkirim tetap di buffer (`dirty` / `pending*`).

---

## 5. Kirim status: `postStatus()` (`:103–141`)

```cpp
bool postStatus(const char *status, float grams) { // Kirim satu status ke Route Handler
  if (WiFi.status() != WL_CONNECTED) return false; // tanpa Wi-Fi: tandai gagal (backoff)
  char body[256];                             // buffer JSON body (maks 255 karakter)
  if (isnan(grams)) {                         // status "unknown": berat tidak tersedia
    snprintf(body, sizeof(body),              // rakit JSON tanpa field weight_kg
             "{\"device_id\":\"%s\",\"seat_id\":\"%s\",\"status\":\"%s\","
             "\"firmware_version\":\"%s\"}",
             DEVICE_ID, SEAT_ID, status, FIRMWARE_VERSION);
  } else {                                    // status lain: sertakan berat
    snprintf(body, sizeof(body),
             "{\"device_id\":\"%s\",\"seat_id\":\"%s\",\"status\":\"%s\","
             "\"weight_kg\":%.3f,\"firmware_version\":\"%s\"}",
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
```

Catatan penting:

- Body dirakit manual dengan `snprintf` (tanpa library JSON) — buffer 256 byte cukup untuk payload maksimum.
- `grams / 1000.0f` → `weight_kg` 3 desimal. Saat `unknown`, field `weight_kg` **tidak dikirim** sama sekali.
- Koneksi ditutup setiap request (`http.end()`), tidak ada keep-alive: wajar untuk 1 POST / 20 dtk.
- Hanya `200` dianggap sukses. `4xx`/`5xx`/timeout semuanya masuk jalur retry — lihat tabel kode di [README.md §6](README.md#6-kontrak-http-ke-backend).

Payload yang keluar:

```json
{"device_id":"SEAT-ESP-01","seat_id":"SEAT-01","status":"occupied","weight_kg":0.312,"firmware_version":"1.0.0"}
```

Log Serial saat sukses:

```
POST occupied -> 200 {"seat_id":"SEAT-01","status":"occupied","weight_kg":0.312,"changed":true,"history":true}
```

---

## 6. Retry & backoff: `flushPending()` (`:143–156`)

```cpp
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
```

Jadwal percobaan setelah gagal beruntun: **2 → 4 → 8 → 16 → 30 → 30 … detik**. Sukses mengembalikannya ke 2 dtk.

Dipanggil di dua tempat pada `loop()`:

```cpp
flushPending(now);                        // :242 - HX711 error: kirim "unknown" segera
...
flushPending(now);                        // :255 - jalur normal tiap iterasi
```

---

## 7. Heartbeat (`:250–255`)

```cpp
// Heartbeat: status terakhir dikirim ulang agar devices.last_seen_at segar
// dan Overview tidak menandai perangkat offline.
if (!dirty && now - lastHeartbeat >= HEARTBEAT_MS) { // 20 dtk tanpa kiriman sukses
  markDirty(seatState == OCCUPIED ? "occupied" : "empty", lastWeightG); // ulangi status terakhir
}
flushPending(now);                          // kirim bila waktunya (atau masih dalam backoff)
```

Tanpa heartbeat, `devices.last_seen_at` basi dan Overview menandai perangkat offline setelah `app_config.device_offline_seconds` (default 60 dtk) — padahal kursinya hanya tidak berubah status.

---

## 8. Sisi Next.js: penerima `POST /api/seats/status`

Kode Route Handler + klien Supabase dipisah ke [nextjs.md](nextjs.md) (salinan verbatim `apps/web/src/app/api/seats/status/route.ts` dan `apps/web/src/lib/supabase-server.ts`), supaya dokumen ini fokus ke firmware. Ringkasnya: nilai dari firmware disimpan apa adanya setelah lolos validasi (`400`/`403`/`404`/`409`), menulis `seat_status` + `seat_events`, meng-update heartbeat `devices`, dan membalas `200 { seat_id, status, weight_kg, changed, history }`.

---

## 9. Uji jalur komunikasi

1. Backend hidup: `cd apps/web && npm run dev` → `http://localhost:3000`.
2. Dari laptop, pastikan endpoint menjawab sebelum menyalahkan firmware:

   ```bash
   curl -s -X POST http://localhost:3000/api/seats/status \
     -H "Content-Type: application/json" \
     -d '{"device_id":"SEAT-ESP-01","seat_id":"SEAT-01","status":"empty","weight_kg":0,"firmware_version":"1.0.0"}'
   ```

3. Cari IP LAN laptop (`ipconfig` → IPv4, mis. `192.168.1.6`), isi `API_URL`, flash.
4. Serial Monitor 115200 baud — yang harus muncul: `Wi-Fi: menyambung.... OK 192.168.1.x`, lalu `POST empty -> 200 ...`.

| Gejala Serial | Penyebab |
|---|---|
| `Wi-Fi: menyambung.... GAGAL` | SSID/password salah, atau ESP32 di luar jangkauan |
| `POST ... -> -1` / `-11` | `API_URL` salah IP / beda jaringan / firewall blok port 3000 |
| `POST ... -> 404` | `DEVICE_ID` atau `SEAT_ID` belum ada di tabel `devices` / `seats` |
| `POST ... -> 409` | `seats.device_id` menunjuk perangkat lain |
| `Kirim gagal; coba lagi dalam 30000 ms` berulang | Backoff sudah mentok: jaringan/backend benar-benar mati |
