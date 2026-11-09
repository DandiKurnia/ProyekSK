#include <Arduino.h>
#include <math.h>
#include "HX711.h"


const uint8_t HX711_DOUT_PIN = 19;
const uint8_t HX711_SCK_PIN  = 18;

HX711 loadCell;

// Faktor awal dari data uji sebelumnya: (853728 - 660691) / 174 ~= 1109.4
// Jika nilai gram terbaca negatif saat ditambah beban, ubah tandanya menjadi -1109.4.
const float CALIBRATION_FACTOR = 1109.4f;

// Koreksi nilai kecil di sekitar nol. Contoh -2.2 g akan ditampilkan sebagai 0 g.
const float ZERO_DEADBAND_G = 3.0f;

// Ambang prototipe untuk beban contoh 30 gram (BUKAN ambang manusia sebenarnya).
// Hysteresis mencegah status berulang-ulang berubah karena noise.
const float OCCUPIED_THRESHOLD_G = 20.0f;  // beban >= 20 g untuk menyatakan terisi
const float EMPTY_THRESHOLD_G    = 10.0f;  // beban <= 10 g memulai timer kosong
const float RECOVERY_THRESHOLD_G = 15.0f;  // beban >= 15 g membatalkan timer kosong

const unsigned long OCCUPIED_CONFIRM_MS = 1000; // beban harus stabil 1 detik
const unsigned long ABSENCE_DELAY_MS   = 5000; // kosong 5 detik => dianggap absen
const unsigned long PRINT_INTERVAL_MS  = 500;

enum SeatState {
  WAITING_FOR_LOAD,
  OCCUPIED,
  EMPTY_PENDING,
  ABSENT
};

SeatState seatState = WAITING_FOR_LOAD;
unsigned long occupiedCandidateSince = 0;
unsigned long emptySince = 0;
unsigned long lastPrint = 0;
float lastWeightG = 0.0f;

const char* stateText(SeatState state) {
  switch (state) {
    case WAITING_FOR_LOAD: return "MENUNGGU BEBAN PERTAMA";
    case OCCUPIED:         return "TERISI";
    case EMPTY_PENDING:    return "KOSONG SEMENTARA - TIMER 5 DETIK";
    case ABSENT:           return "ABSEN - BEBAN HILANG >= 5 DETIK";
    default:               return "STATUS TIDAK DIKETAHUI";
  }
}

float readWeightGrams() {
  // Rata-rata 5 pembacaan untuk meredam noise.
  float grams = loadCell.get_units(5);

  // Abaikan deviasi kecil di sekitar nol, termasuk nilai -2.2 g.
  if (fabsf(grams) <= ZERO_DEADBAND_G) {
    grams = 0.0f;
  }
  return grams;
}

void updateSeatState(float grams, unsigned long now) {
  switch (seatState) {
    case WAITING_FOR_LOAD:
    case ABSENT:
      // Saat awal, jangan menganggap absen hanya karena kursi memang kosong.
      // Status baru menjadi TERISI setelah beban >= 20 g bertahan 1 detik.
      if (grams >= OCCUPIED_THRESHOLD_G) {
        if (occupiedCandidateSince == 0) {
          occupiedCandidateSince = now;
        }

        if (now - occupiedCandidateSince >= OCCUPIED_CONFIRM_MS) {
          seatState = OCCUPIED;
          occupiedCandidateSince = 0;
          emptySince = 0;
          Serial.println("EVENT: kursi terisi / siswa terdeteksi berada di kursi.");
        }
      } else {
        occupiedCandidateSince = 0;
      }
      break;

    case OCCUPIED:
      // Timer hanya dimulai setelah beban turun <= 10 g.
      if (grams <= EMPTY_THRESHOLD_G) {
        emptySince = now;
        seatState = EMPTY_PENDING;
        Serial.println("EVENT: beban turun; mulai hitung 5 detik.");
      }
      // Pada rentang 10-20 g, pertahankan status sebelumnya (hysteresis).
      break;

    case EMPTY_PENDING:
      // Jika beban kembali >= 15 g sebelum 5 detik, batal anggap absen.
      if (grams >= RECOVERY_THRESHOLD_G) {
        seatState = OCCUPIED;
        emptySince = 0;
        Serial.println("EVENT: beban kembali; timer absen dibatalkan.");
      } else if (now - emptySince >= ABSENCE_DELAY_MS) {
        seatState = ABSENT;
        emptySince = 0;
        Serial.println("EVENT: ABSEN - beban tetap rendah selama 5 detik.");
      }
      // Jika nilai berada di antara 10-15 g, timer tetap berjalan,
      // kecuali jika pulih mencapai 15 g.
      break;
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("=== TES LOAD CELL: ambang 30 g / absen 5 detik ===");
  Serial.println("Pastikan load cell TIDAK diberi beban saat startup/tare.");

  loadCell.begin(HX711_DOUT_PIN, HX711_SCK_PIN);
  loadCell.set_scale(CALIBRATION_FACTOR);

  while (!loadCell.wait_ready_timeout(1000)) {
    Serial.println("HX711 belum terbaca. Periksa VCC, GND, DT/DOUT, dan SCK/CLK.");
    delay(500);
  }

  delay(2000);       // beri waktu sinyal stabil
  loadCell.tare(20); // set kondisi tanpa beban sebagai nol

  Serial.println("Tare selesai.");
  Serial.println("Aturan: >=20 g selama 1 detik = TERISI.");
  Serial.println("<=10 g memulai timer; jika tidak pulih ke >=15 g selama 5 detik = ABSEN.");
  Serial.println("-------------------------------------------------------");
}

void loop() {
  if (!loadCell.wait_ready_timeout(500)) {
    Serial.println("ERROR: HX711 tidak siap / tidak terbaca.");
    delay(300);
    return;
  }

  lastWeightG = readWeightGrams();
  const unsigned long now = millis();
  updateSeatState(lastWeightG, now);

  if (now - lastPrint >= PRINT_INTERVAL_MS) {
    lastPrint = now;
    Serial.print("Berat: ");
    Serial.print(lastWeightG, 1);
    Serial.print(" g | Status: ");
    Serial.print(stateText(seatState));

    if (seatState == EMPTY_PENDING) {
      unsigned long elapsed = now - emptySince;
      unsigned long remaining = (elapsed >= ABSENCE_DELAY_MS)
                                  ? 0
                                  : ABSENCE_DELAY_MS - elapsed;
      Serial.print(" | Sisa timer: ");
      Serial.print(remaining / 1000.0f, 1);
      Serial.print(" detik");
    }
    Serial.println();
  }

  delay(100);
}
