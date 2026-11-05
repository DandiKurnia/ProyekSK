"""Uji driver serial tanpa hardware: firmware palsu mendorong baris event,
bridge membaca lewat opener injeksi. Jalankan: python test_fingerprint_bridge.py"""

import queue
import sys
import threading
import time

from fingerprint_serial import FingerprintBridge


class FakeSerial:
    """Meniru pyserial.Serial: baris masuk via feed(), perintah keluar tercatat."""

    def __init__(self):
        self._q: queue.Queue[str] = queue.Queue()
        self.written: list[str] = []

    def feed(self, line: str) -> None:
        self._q.put(line)

    def write(self, b: bytes) -> None:
        cmd = b.decode().strip()
        self.written.append(cmd)
        if cmd.startswith("LED_OK"):
            threading.Timer(0.05, lambda: self.feed("LED_DONE")).start()

    def flush(self) -> None:
        pass

    def readline(self) -> bytes:
        try:
            return (self._q.get(timeout=0.1) + "\n").encode()
        except queue.Empty:
            return b""

    def close(self) -> None:
        pass


def make_bridge() -> tuple[FingerprintBridge, FakeSerial]:
    fake = FakeSerial()
    b = FingerprintBridge(port="FAKE", opener=lambda p, baud: fake)
    b.start()
    assert b._wait(("READY", "BOOT"), 2.0) or True  # biarkan boot dulu
    return b, fake


def check(name: str, cond: bool) -> None:
    print(("OK  " if cond else "FAIL") + f" {name}")
    if not cond:
        raise SystemExit(f"GAGAL: {name}")


def main():
    b, fake = make_bridge()
    fake.feed("BOOT AICI-FPv1.0")
    fake.feed("READY 2")
    time.sleep(0.5)
    st = b.status()
    check("boot+ready terbaca", st["connected"] and st["sensor_ok"] is True and st["template_count"] == 2)
    check("firmware terbaca", st["firmware"] == "AICI-FPv1.0")

    # --- PING ---
    import threading
    def _pong():
        time.sleep(0.15)
        fake.feed("PONG 2")

    threading.Thread(target=_pong, daemon=True).start()
    check("ping ok", b.ping()["ok"] is True)

    # --- ENROLL sukses ---
    def _enroll_ok():
        time.sleep(0.15)
        for ln in ("ENROLLING 7", "PLACE 7 1", "REMOVE 7", "PLACE 7 2", "ENROLL_OK 7"):
            fake.feed(ln)
            time.sleep(0.05)

    threading.Thread(target=_enroll_ok, daemon=True).start()
    r = b.enroll(7)
    check("enroll slot 7 ok", r == {"ok": True, "slot": 7, "code": 0})
    check("perintah ENROLL terkirim", "ENROLL 7" in fake.written)

    # --- ENROLL gagal (sidik duplikat) ---
    def _enroll_fail():
        time.sleep(0.15)
        fake.feed("ENROLL_FAIL 7 -4")

    threading.Thread(target=_enroll_fail, daemon=True).start()
    r = b.enroll(7)
    check("enroll duplikat gagal + kode -4", r["ok"] is False and r["code"] == -4)

    # --- MATCH tanpa sesi -> dibuang ---
    fake.feed("MATCH 7 120")
    time.sleep(0.3)
    check("match tanpa sesi diabaikan", b.status()["ignored_matches"] == 1 and b.session()["state"] == "idle")

    # --- Sesi 2FA: MATCH slot benar -> verified ---
    b.open_session("S001", 7, ttl=5)
    time.sleep(0.1)
    fake.feed("MATCH 7 130")
    time.sleep(0.3)
    s = b.session()
    check("sesi verified", s["state"] == "verified" and s["student_id"] == "S001" and s["score"] == 130)

    # --- Sesi 2FA: 3x jari orang lain -> failed ---
    b.open_session("S002", 9, ttl=5)
    for _ in range(3):
        fake.feed("MATCH 5 110")
        time.sleep(0.2)
    s = b.session()
    check("slot salah 3x -> failed", s["state"] == "failed" and s["reason"] == "slot_mismatch" and s["attempts"] == 3)

    # --- Sesi 2FA: timeout TTL ---
    b.open_session("S003", 9, ttl=0.3)
    time.sleep(0.6)
    fake.feed("MATCH 9 140")  # datang terlambat: tidak dihitung
    time.sleep(0.2)
    s = b.session()
    check("sesi kedaluwarsa", s["state"] == "expired")

    # --- DELETE ---
    def _del():
        time.sleep(0.15)
        fake.feed("DELETE_OK 7")

    threading.Thread(target=_del, daemon=True).start()
    check("delete ok", b.delete(7)["ok"] is True and "DELETE 7" in fake.written)

    # --- Slot di luar 1..200 ditolak lokal ---
    check("enroll slot 0 ditolak", b.enroll(0)["ok"] is False)
    check("open_session slot 999 ditolak", b.open_session("S", 999)["ok"] is False)

    b.stop()
    print("\nSemua 13 cek lolos.")


def check_api():
    """Lapisan HTTP: endpoint FastAPI memakai bridge palsu yang sama."""
    from fastapi.testclient import TestClient

    import fingerprint_serial as fpm

    fake = FakeSerial()
    fake.feed("BOOT AICI-FPv1.0")
    fake.feed("READY 0")
    fpm.bridge = fpm.FingerprintBridge(port="FAKE", opener=lambda p, b: fake)

    import server  # dimuat setelah bridge diganti

    with TestClient(server.app) as c:
        fake.feed("BOOT AICI-FPv1.0")
        fake.feed("READY 0")
        time.sleep(0.4)
        r = c.get("/fingerprint/status")
        print("status:", r.status_code, "connected:", r.json()["connected"])
        assert r.status_code == 200 and r.json()["connected"] is True

        # 1. Enroll async
        def fw():
            time.sleep(0.2)
            for ln in ("ENROLLING 12", "PLACE 12 1", "REMOVE 12", "PLACE 12 2", "ENROLL_OK 12"):
                fake.feed(ln)
                time.sleep(0.05)

        threading.Thread(target=fw, daemon=True).start()
        r = c.post("/fingerprint/enroll", json={"slot": 12})
        print("post /enroll:", r.status_code, r.json())
        assert r.status_code == 202

        s = None
        for _ in range(40):
            s = c.get("/fingerprint/enroll/status").json()
            if not s["active"]:
                break
            time.sleep(0.1)
        print("enroll final:", s)
        assert s is not None and s["ok"] is True and s["code"] == 0

        # 2. Sesi 2FA: buka -> tempel jari -> verified
        r = c.post("/fingerprint/session", json={"student_id": "S001", "slot": 12, "ttl": 5})
        assert r.status_code == 201 and r.json()["state"] == "waiting"
        fake.feed("MATCH 12 128")
        time.sleep(0.3)
        sess = c.get("/fingerprint/session").json()
        print("session final:", sess["state"], "score:", sess["score"])
        assert sess["state"] == "verified" and sess["score"] == 128 and sess.get("verified_at")

        # 3. LED konfirmasi: firmware balas LED_DONE
        r = c.post("/fingerprint/led", json={})
        print("led:", r.status_code, r.json())
        assert r.status_code == 200 and r.json().get("ok") is True

        # 4. Konsumsi sesi: verified -> cancelled, tidak bisa dipakai ulang
        assert c.delete("/fingerprint/session").json()["state"] == "cancelled"
        assert c.get("/fingerprint/session").json()["state"] == "cancelled"

        # 3. Delete slot
        def del_reply():
            time.sleep(0.1)
            fake.feed("DELETE_OK 12")

        threading.Thread(target=del_reply, daemon=True).start()
        r = c.delete("/fingerprint/12")
        print("delete 12:", r.status_code, r.json())
        assert r.status_code == 200

    print("\nSMOKE_API_OK")


if __name__ == "__main__":
    main()
    check_api()
