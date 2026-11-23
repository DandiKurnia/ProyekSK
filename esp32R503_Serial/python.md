# Sisi Python — `apps/face-service` yang memegang port COM R503

`apps/face-service/fingerprint_serial.py` adalah satu-satunya proses yang membuka port USB ke kios ini; `apps/face-service/server.py` mengeksposnya ke Next.js lewat HTTP. Salinan kode di bawah = sumber apa adanya (cari ulang nomor baris bila file berubah).

Alur: firmware mengirim baris → `_run()` membaca → `_handle()` mengurai ke state (`self._events`, `self._session`) → `_apply_match()`/`_apply_card()` memutuskan sesi 2FA → Next.js membaca `/fingerprint/session` dan menulis `attendance`.

Event masuk yang dipakai (dari firmware): `BOOT`, `READY`, `SENSOR_FAIL`, `PONG`, `ENROLLING`, `PLACE`, `REMOVE`, `ENROLL_OK`/`ENROLL_FAIL`, `DELETE_OK`/`DELETE_FAIL`, `CLEAR_OK`/`CLEAR_FAIL`, `MATCH <slot> <score>`, `NOMATCH`, `CARDWAIT`, `CARD <UID>`, `CARD_OK <UID>`, `CARD_TIMEOUT`, `LED_DONE`.

Terkait: firmware [`esp32R503_Serial.ino`](esp32R503_Serial.ino) + [`README.md`](README.md); rantai penuh & sisi Next.js: [`code-komunikasi-r503.md`](../ObsidianAllProgramSK/docs/code-komunikasi-r503.md), [`code-attendance-routes.md`](../ObsidianAllProgramSK/docs/code-attendance-routes.md).

---

## 1. Baca port tanpa memblok — `_run()` (`fingerprint_serial.py:108–139`)

```python
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
```

## 2. Parse baris — `_handle()` (`:141–198`)

```python
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
                self.last_rfid = " ".join(args[1:])  # "READY <n> RFID" -> nama reader
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
            elif verb == "CARDWAIT" and self._card:
                self._card["stage"] = "waiting"  # Jendela enroll kartu dibuka firmware
            elif verb in ("CARD", "CARD_OK"):
                uid = (args[0] if args else "").upper()
                if uid:
                    self.last_card = uid
                    self._apply_card(uid)
                    if self._card and self._card.get("stage") in ("sending", "waiting"):
                        self._card.update(stage="done", ok=True, uid=uid)
            elif verb == "CARD_TIMEOUT" and self._card:
                self._card.update(stage="done", ok=False)
            elif verb in ("MATCH", "NOMATCH"):
                self._apply_match(verb, args)

            self._new.notify_all()  # Bangunkan penunggu perintah/sesi
```

## 3. Kirim & tunggu — `_send()` (`:274–282`), `_wait()` (`:260–272`)

```python
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
```

```python
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
```

## 4. Sesi 2FA — `open_session()` (`:346–377`) + `_apply_match()` (`:199–224`)

`open_session()` menyimpan `slot` (jari) dan `uids` (kartu terikat) hasil query Route Handler, lalu `_apply_match()` memutuskan:

```python
    def _apply_match(self, verb: str, args: list[str]) -> None:
        """Terapkan event sidik jari ke sesi. Dipanggil sudah di dalam `_lock`."""
        s = self._session
        if not self._session_active(s):
            self.ignored_matches += 1  # Jari di luar sesi: bukan absensi
            return

        if verb == "NOMATCH":
            self._fail_attempt(s, "no_match")
            return

        slot = _int(args, 0, -1)
        score = _int(args, 1, 0)
        if s.get("slot") is not None and slot == s["slot"]:
            s.update(
                state="verified",
                method="fingerprint",
                matched_slot=slot,
                score=score,
                reason="ok",
                verified_at=time.time(),  # dipakai Route Handler untuk batas umur bukti
            )
            return

        # Wajah siswa A tetapi jari slot lain (milik siswa B)
        s.update(matched_slot=slot, score=score)
        self._fail_attempt(s, "slot_mismatch")
```

Kartu: `_apply_card()` (`:227–243`) membandingkan `CARD <UID>` dengan `s["uids"]`, cocok → `state="verified", method="rfid"`.

## 5. Sisi FastAPI: endpoint yang dipanggil Next.js (`server.py:359–378`, `:402–405`)

```python
@app.post("/fingerprint/session", status_code=status.HTTP_201_CREATED)
def fingerprint_session_open(req: FingerSession):
    hasil = fp.bridge.open_session(
        req.student_id.strip(), req.slot, req.ttl, [u.strip().upper() for u in req.uids]
    )
    if not hasil["ok"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=hasil["error"])
    return hasil

@app.get("/fingerprint/session")
def fingerprint_session_get():
    return fp.bridge.session()

@app.delete("/fingerprint/session")
def fingerprint_session_cancel():
    return fp.bridge.cancel_session()
```

```python
@app.post("/fingerprint/led")
def fingerprint_led():
    """Kedip hijau di R503. Dipanggil Route Handler setelah baris attendance tersimpan."""
    return fp.bridge.led_ok()
```

## 6. Batas kepemilikan

- Python **tidak** menulis Supabase; ia hanya membuka sesi, menandai `verified`/`failed`/`expired`, dan menyediakan bukti.
- Sesi hanya `verified` bila slot jari = slot target **atau** UID kartu ∈ `uids`; `MATCH` di luar sesi dicatat `ignored_matches` (bukan absensi).
- Bukti harus dipakai ≤ 120 dtk (`verified_at`), dan Next.js yang memutuskan `present`/`late` + menulis baris.