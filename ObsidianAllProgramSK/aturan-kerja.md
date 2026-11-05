# Aturan Kerja — WAJIB dibaca setiap sesi

## Git: JANGAN commit / push tanpa seizin user

- DILARANG `git commit`, `git push`, `git merge`, atau perintah tulis-riwayat lainnya **kecuali user memintanya eksplisit** di pesan yang sama.
- Pengecualian otomatis TIDAK ADA — termasuk "perubahan kecil", "cuma docs", atau "biar aman".
- Yang BOLEH tanpa izin: `git status`, `git diff`, `git log`, `git add` (staging saja, tanpa commit) — baca-saja, tidak mengubah riwayat.
- Alur baku: kerjakan perubahan → tunjukkan `git status`/`git diff` → **tanya user** → commit+push hanya setelah user setuju.
- Berlaku untuk seluruh repo `program/`, termasuk `apps/` dan `ObsidianAllProgramSK/`.

## Git Branch: Wajib Branch Baru Sebelum Coding Fitur

- SEBELUM mulai menulis kode untuk fitur/tugas baru, **WAJIB checkout ke branch baru** (misal: `feat/<nama-fitur>`, `fix/<nama-bug>`).
- DILARANG menumpuk fitur baru di branch yang sedang berjalan atau di `main`.
- Tujuannya agar tim tidak kagok, riwayat kerja terisolasi, dan mudah ganti branch antarfitur kapan saja.
- Alur: pastikan branch induk bersih → `git checkout -b <tipe>/<nama>` → baru mulai coding.
