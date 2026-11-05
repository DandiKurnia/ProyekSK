"""Jembatan USB Serial ke firmware ESP32 + R503 (`esp32R503_Serial.ino` v1.0).

Peran modul ini:
1. Buka COM port, baca baris event dari firmware, kirim perintah.
2. Jalankan perintah sinkron (PING/ENROLL/DELETE/CLEAR/LED_OK) dengan timeout.
3. Simpan **sesi 2FA** lokal: firmware memindai 1:N terus-menerus tanpa perintah
   `VERIFY`, jadi yang menentukan "MATCH ini milik siapa" adalah sesi di sini.

Aturan sesi (lihat ObsidianAllProgramSK/docs/fingerprint.md):
- Sesi dibuka saat wajah terkunci: `open_session(student_id, slot, ttl)`.
- Hanya event `MATCH <slot> <confidence>` **setelah** sesi dibuka yang dihitung;
  `MATCH` di luar sesi dibuang (`ignored_matches`).
- Slot cocok -> `verified`. Slot lain / `NOMATCH` -> percobaan bertambah;
  habis `max_attempts` -> `failed`. Lewat TTL -> `expired`.

Threading: satu thread pembaca baris; semua state dikunci `_lock`.
"""

from __future__ import annotations

import os
import queue
import threading
import time
from typing import Callable, Optional

import serial  # pyserial
from serial.tools import list_ports

BAUD = 115200  # USB Serial ke laptop (UART2 ke sensor tetap 57600)
ENROLL_TIMEOUT = 40.0  # 2 sampel x 15 dtk tunggu jari + cadangan
MAX_ATTEMPTS = 3  # Jumlah salah tempel sebelum sesi 2FA hangus
DEFAULT_TTL = 30.0  # Umur sesi 2FA (detik)

# Prefiks USB-Serial yang umum di ESP32 DevKit
_PORT_HINTS = ("CH340", "CP210", "USB-SERIAL", "USB SERIAL", "FT232", "ESP32")


def find_port() -> Optional[str]:
    """Tebak COM port ESP32: env `FP_SERIAL_PORT` > nama USB-Serial > port pertama."""
    env = os.environ.get("FP_SERIAL_PORT")
    if env:
        return env
    ports = list(list_ports.comports())
    for p in ports:
        text = f"{p.description} {p.manufacturer}".upper()
        if any(h in text for h in _PORT_HINTS):
            return p.device
    return ports[0].device if ports else None


class FingerprintBridge:
    """Satu instance per proses: port serial hanya boleh dibuka satu kali."""

    def __init__(
        self,
        port: Optional[str] = None,
        baud: int = BAUD,
        opener: Optional[Callable[[str, int], "serial.SerialBase"]] = None,
    ):
        self.port = port
        self.baud = baud
        # `opener` bisa diganti di test (firmware palsu) tanpa menyentuh hardware
        self._opener = opener or (lambda p, b: serial.Serial(p, b, timeout=0.2))
        self._ser = None
        self._lock = threading.RLock()
        self._new = threading.Condition(self._lock)
        self._events: list[tuple[str, list[str]]] = []  # Riwayat event terurai
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self.connected = False
        self.sensor_ok: Optional[bool] = None  # None = belum ada kabar BOOT/READY
        self.firmware = ""
        self.template_count = 0
        self.last_event = ""  # Baris terakhir mentah (untuk /fingerprint/status)
        self.ignored_matches = 0  # MATCH datang tanpa sesi aktif
        self._enroll: Optional[dict] = None  # Progres ENROLL untuk polling UI
        self._session: dict = {"state": "idle"}

    # ---------- Koneksi ----------
    def start(self) -> None:
        """Buka port + mulai thread pembaca. Aman dipanggil berulang."""
        with self._lock:
            if self._running:
                return
            self._running = True
        self._thread = threading.Thread(target=self._run, name="fp-serial", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        with self._lock:
            self._running = False
            ser, self._ser = self._ser, None
            self.connected = False
            self._new.notify_all()
        if ser is not None:
            try:
                ser.close()
            except Exception:
                pass

    def _run(self) -> None:
        """Loop koneksi: buka port, baca baris; kabel lepas -> coba lagi tiap 2 dtk."""
        while self._running:
            if self._ser is None:
                port = self.port or find_port()
                if not port:
                    time.sleep(2.0)
                    continue
                try:
                    ser = self._opener(port, self.baud)
                except Exception:
                    time.sleep(2.0)  # Port dipakai proses lain / belum tercolok
                    continue
                with self._lock:
                    self.port, self._ser, self.connected = port, ser, True
                    self._new.notify_all()
            try:
                raw = self._ser.readline()  # timeout 0.2 dtk -> tidak memblok loop
            except Exception:
                with self._lock:
                    self.connected = False
                    try:
                        self._ser.close()
                    except Exception:
                        pass
                    self._ser = None
                time.sleep(2.0)
                continue
            line = raw.decode("utf-8", "ignore").strip()
            if line:
                self._handle(line)

    # ---------- Parsing ----------
    def _handle(self, line: str) -> None:
        parts = line.split()
        verb, args = parts[0], parts[1:]
        with self._lock:
            self.last_event = line
            self._events.append((verb, args))
            if len(self._events) > 500:
                del self._events[:250]  # Batasi memori; penunggu memakai indeks

            if verb == "BOOT":
                self.firmware = " ".join(args)
                self.sensor_ok = None
            elif verb == "READY":
                self.sensor_ok = True
                self.template_count = _int(args, 0, self.template_count)
            elif verb == "SENSOR_FAIL":
                self.sensor_ok = False
            elif verb == "PONG":
                self.template_count = _int(args, 0, self.template_count)
            elif verb in ("ENROLL_OK", "DELETE_OK", "CLEAR_OK"):
                self.template_count = None  # Tidak akurat lagi; di-refresh via PING
                if verb == "ENROLL_OK" and self._enroll:
                    self._enroll.update(stage="done", ok=True)
            elif verb in ("ENROLL_FAIL", "DELETE_FAIL", "CLEAR_FAIL"):
                if verb == "ENROLL_FAIL" and self._enroll:
                    self._enroll.update(stage="done", ok=False, code=_int(args, 1, -1))
            elif verb == "ENROLLING":
                self._enroll = {
                    "slot": _int(args, 0, 0),
                    "stage": "wait_finger_1",
                    "ok": None,
                    "code": None,
                    "started_at": time.time(),
                }
            elif verb == "PLACE" and self._enroll:
                # PLACE dikirim 2x: sampel pertama & kedua
                self._enroll["stage"] = (
                    "wait_finger_2" if self._enroll["stage"] != "wait_finger_1" else "wait_finger_1"
                )
            elif verb == "REMOVE" and self._enroll:
                self._enroll["stage"] = "wait_finger_2"
            elif verb in ("MATCH", "NOMATCH"):
                self._apply_match(verb, args)

            self._new.notify_all()  # Bangunkan penunggu perintah/sesi

    def _apply_match(self, verb: str, args: list[str]) -> None:
        """Terapkan aturan sesi 2FA. Dipanggil sudah di dalam `_lock`."""
        s = self._session
        active = s.get("state") == "waiting" and time.time() < s.get("deadline", 0)
        if not active:
            if s.get("state") == "waiting":
                self._session = {**s, "state": "expired", "reason": "timeout"}
            self.ignored_matches += 1  # Jari di luar sesi: bukan absensi
            return

        if verb == "NOMATCH":
            s["attempts"] = s.get("attempts", 0) + 1
            s["reason"] = "no_match"
            if s["attempts"] >= MAX_ATTEMPTS:
                s["state"], s["reason"] = "failed", "no_match"
            return

        slot = _int(args, 0, -1)
        score = _int(args, 1, 0)
        if slot == s["slot"]:
            s.update(
                state="verified",
                matched_slot=slot,
                score=score,
                reason="ok",
                verified_at=time.time(),  # dipakai Route Handler untuk batas umur bukti 2FA
            )
            return

        # Wajah siswa A tetapi jari slot lain (milik siswa B)
        s["attempts"] = s.get("attempts", 0) + 1
        s.update(matched_slot=slot, score=score, reason="slot_mismatch")
        if s["attempts"] >= MAX_ATTEMPTS:
            s["state"] = "failed"

    # ---------- Utilitas ----------
    def _wait(self, verbs: tuple[str, ...], timeout: float) -> Optional[tuple[str, list[str]]]:
        """Tunggu event dengan salah satu `verb` baru (bukan riwayat lama)."""
        deadline = time.time() + timeout
        with self._lock:
            start = len(self._events)  # Abaikan event sebelum perintah dikirim
            while True:
                for verb, args in self._events[start:]:
                    if verb in verbs:
                        return verb, args
                sisa = deadline - time.time()
                if sisa <= 0 or not self._running:
                    return None
                self._new.wait(min(sisa, 0.2))

    def _send(self, cmd: str) -> bool:
        with self._lock:
            ser = self._ser
        if ser is None:
            return False
        try:
            ser.write((cmd + "\n").encode())
            ser.flush()
            return True
        except Exception:
            return False

    # ---------- Perintah sinkron ----------
    def ping(self, timeout: float = 2.0) -> dict:
        if not self._send("PING"):
            return {"ok": False, "error": "serial tidak terhubung"}
        hit = self._wait(("PONG",), timeout)
        if not hit:
            return {"ok": False, "error": "timeout menunggu PONG"}
        count = _int(hit[1], 0, self.template_count)
        with self._lock:
            self.template_count = count
        return {"ok": True, "template_count": count}

    def enroll(self, slot: int) -> dict:
        """Blokir sampai ENROLL_OK / ENROLL_FAIL (maks ENROLL_TIMEOUT)."""
        if not 1 <= slot <= 200:
            return {"ok": False, "error": "slot harus 1..200"}
        with self._lock:
            self._enroll = {"slot": slot, "stage": "sending", "ok": None, "code": None,
                            "started_at": time.time()}
        if not self._send(f"ENROLL {slot}"):
            with self._lock:
                self._enroll = None
            return {"ok": False, "error": "serial tidak terhubung"}

        hit = self._wait(("ENROLL_OK", "ENROLL_FAIL", "ERR_UNKNOWN"), ENROLL_TIMEOUT)
        if not hit:
            with self._lock:
                self._enroll = None
            return {"ok": False, "error": "timeout enrollment (jari tidak ditempel?)"}
        verb, args = hit
        if verb == "ENROLL_OK":
            return {"ok": True, "slot": _int(args, 0, slot), "code": 0}
        return {
            "ok": False,
            "slot": slot,
            "code": _int(args, 1, -1),
            "error": f"enrollment gagal (kode {_int(args, 1, -1)})",
        }

    def delete(self, slot: int, timeout: float = 3.0) -> dict:
        if not self._send(f"DELETE {slot}"):
            return {"ok": False, "error": "serial tidak terhubung"}
        hit = self._wait(("DELETE_OK", "DELETE_FAIL", "ERR_UNKNOWN"), timeout)
        if not hit or hit[0] != "DELETE_OK":
            return {"ok": False, "slot": slot, "error": "hapus slot gagal"}
        return {"ok": True, "slot": slot}

    def clear(self, timeout: float = 5.0) -> dict:
        if not self._send("CLEAR"):
            return {"ok": False, "error": "serial tidak terhubung"}
        hit = self._wait(("CLEAR_OK", "CLEAR_FAIL", "ERR_UNKNOWN"), timeout)
        return {"ok": bool(hit) and hit[0] == "CLEAR_OK", "error": None if hit and hit[0] == "CLEAR_OK" else "clear gagal"}

    def led_ok(self, timeout: float = 2.0) -> dict:
        if not self._send("LED_OK"):
            return {"ok": False, "error": "serial tidak terhubung"}
        hit = self._wait(("LED_DONE",), timeout)
        return {"ok": bool(hit)}

    # ---------- Sesi 2FA ----------
    def open_session(self, student_id: str, slot: int, ttl: float = DEFAULT_TTL) -> dict:
        if not 1 <= slot <= 200:
            return {"ok": False, "error": "slot harus 1..200"}
        with self._lock:
            self._session = {
                "state": "waiting",
                "student_id": student_id,
                "slot": slot,
                "attempts": 0,
                "reason": None,
                "matched_slot": None,
                "score": None,
                "opened_at": time.time(),
                "deadline": time.time() + ttl,
            }
            self._new.notify_all()
        return {"ok": True, **self.session()}

    def session(self) -> dict:
        with self._lock:
            s = dict(self._session)
            if s.get("state") == "waiting" and time.time() >= s.get("deadline", 0):
                s.update(state="expired", reason="timeout")
                self._session = dict(s)
            if s.get("state") == "waiting":
                s["remaining_s"] = round(s["deadline"] - time.time(), 1)
            return s

    def cancel_session(self) -> dict:
        with self._lock:
            if self._session.get("state") in ("waiting", "verified"):
                # `verified` ikut dikonsumsi supaya bukti 2FA tidak bisa dipakai dua kali
                self._session = {**self._session, "state": "cancelled", "reason": "cancelled"}
            self._new.notify_all()
            return dict(self._session)

    # ---------- Status untuk UI ----------
    def status(self) -> dict:
        with self._lock:
            return {
                "connected": self.connected,
                "port": self.port,
                "baud": self.baud,
                "firmware": self.firmware,
                "sensor_ok": self.sensor_ok,
                "template_count": self.template_count,
                "last_event": self.last_event,
                "ignored_matches": self.ignored_matches,
                "enroll": dict(self._enroll) if self._enroll else None,
                "session": self.session(),
            }


def _int(args: list[str], idx: int, default: int) -> int:
    try:
        return int(args[idx])
    except (IndexError, ValueError):
        return default


bridge = FingerprintBridge()  # Dibagi seluruh proses; `start()` dipanggil server
