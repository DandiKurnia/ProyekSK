# Aturan Kerja — WAJIB dibaca setiap sesi

## Git: JANGAN commit / push tanpa seizin user

- DILARANG `git commit`, `git push`, `git merge`, atau perintah tulis-riwayat lainnya **kecuali user memintanya eksplisit** di pesan yang sama.
- Pengecualian otomatis TIDAK ADA — termasuk "perubahan kecil", "cuma docs", atau "biar aman".
- Yang BOLEH tanpa izin: `git status`, `git diff`, `git log`, `git add` (staging saja, tanpa commit) — baca-saja, tidak mengubah riwayat.
- Alur baku: kerjakan perubahan → tunjukkan `git status`/`git diff` → **tanya user** → commit+push hanya setelah user setuju.
- Setelah `git commit`, **JANGAN langsung `git push`**. Biarkan commit tetap lokal; `push` HANYA bila user meminta eksplisit. Commit dan push adalah dua izin yang terpisah — izin commit BUKAN izin push.

## Git Branch: Wajib Branch Baru Sebelum Coding Fitur

- SEBELUM mulai menulis kode untuk fitur/tugas baru, **WAJIB checkout ke branch baru** (misal: `feat/<nama-fitur>`, `fix/<nama-bug>`).
- DILARANG menumpuk fitur baru di branch yang sedang berjalan atau di `main`.
- Tujuannya agar tim tidak kagok, riwayat kerja terisolasi, dan mudah ganti branch antarfitur kapan saja.
- Alur: pastikan branch induk bersih → `git checkout -b <tipe>/<nama>` → baru mulai coding.

## Git Branch: JANGAN gabungkan branch tanpa izin

- DILARANG `git merge`, `git rebase` lintas branch, cherry-pick, atau memasukkan satu branch ke branch lain **kecuali user memintanya eksplisit**.
- Branch yang berdiri sendiri berarti memang belum mau digabung. Jangan "rapikan" dengan menggabungkannya hanya karena kelihatan tertinggal dari `main`.
- **`feat/sensor-telemetry-display` (`fa617ab`) DILARANG digabung** ke branch mana pun dulu — user memutuskan branch ini tetap terpisah. Boleh di-push, tidak boleh di-merge/rebase ke branch lain.
- Semua branch `feat/*` lain saat ini satu garis leluhur (`main → feat/rfid-card-2fa → feat/attendance-checkout → feat/reports → feat/auth`). Konsekuensi: branch yang dibuat dari ujung garis itu ikut membawa commit branch di bawahnya.
- Sebelum membuat branch baru: kalau fiturnya **mandiri**, buat dari `main` (`git checkout main && git checkout -b feat/<nama>`), bukan menumpuk di ujung garis fitur. Kalau memang bergantung pada branch lain, sebutkan ketergantungannya ke user lebih dulu.
- Sebelum mengusulkan PR/merge, hitung dulu isi PR (`git log --oneline main..<branch>`) dan laporkan commit mana saja yang ikut — jangan biarkan PR membawa fitur lain tanpa sepengetahuan user.

## Alur Branch Tetap: branch → cek user → push → merge develop → hapus branch

- Branch integrasi: `develop`. Fitur masuk `main` nanti hanya lewat `develop`.
- Alur baku setiap pengerjaan, berurutan:
  1. Kerjakan di branch baru: dari `main` bila fitur mandiri, atau dari branch induknya bila memang bergantung — sebutkan ketergantungannya ke user.
  2. User cek hasil dulu.
  3. Push branch ke GitHub SETELAH user setuju.
  4. Merge branch ke `develop` (branch yang SUDAH di-push dan lolos cek).
  5. Hapus branch fitur setelah merge (lokal + remote), kecuali yang diperintah bertahan (`feat/sensor-telemetry-display`).
- Etap izin tetap berlaku: commit/push/merge/delete-remote masing-masing perlu perintah eksplisit user.

## Port & Proses Latar: JANGAN tinggalkan server menyala

- Program apa pun yang dijalankan untuk mengecek — **npm** (`next dev`, `next start`) dan **python** (`uvicorn`, skrip uji) — **WAJIB dimatikan** begitu pengecekan selesai. Jangan ditinggal hidup sampai turn berikutnya.
- Sebelum menjalankan server, cek dulu pemilik port: `netstat -ano | findstr :<port>`. DILARANG memakai port yang sedang dipegang proses lain — apalagi proses milik user.
- Port **8200 DILARANG** dipakai di mesin ini. Port itu masuk Windows dynamic port exclusion range (`netsh interface ipv4 show excludedportrange protocol=tcp` → `8135–8234`, dipesan Hyper-V/WinNAT), sehingga bind selalu gagal `[Errno 13] ... access permissions`. Face-service memakai **8000**.
- `[Errno 10048]` berarti port masih dipegang proses lain. Matikan pemiliknya dulu; jangan diam-diam pindah port tanpa memberi tahu user.
- Butuh server yang hidup lebih lama? Jalankan sebagai service bernama (`proc://<nama>`), lalu matikan eksplisit (`proc://<nama>/kill`) sebelum menutup sesi.
