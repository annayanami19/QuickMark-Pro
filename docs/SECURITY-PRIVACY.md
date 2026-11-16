# Keamanan & Privasi — QuickMark Pro

## Permission yang dipakai (semua minimal)

| Permission | Alasan | Risiko |
|---|---|---|
| `storage` | Setting (sync) & profil per jendela (session) | rendah |
| `unlimitedStorage` | Bookmark + learning + backup snapshot | rendah (lokal saja) |
| `bookmarks` | Import dari bookmark native + mirror opsional | medium — TIDAK dipakai membaca isi halaman |
| `favicon` | Render favicon via endpoint `_favicon/` (`runtime.getURL`) | rendah |
| `sidePanel` | Side panel UI | rendah |
| `alarms` | Backup harian | rendah |
| `activeTab` | Baca judul/URL tab aktif saat user invoke (klik ikon / shortcut) | minimal — tidak ada akses tab pasif |
| content script (`http/https` saja) | Suntik FAB panel cepat di halaman web — HANYA menambah overlay DOM sendiri (prefix `qmp-`), tidak membaca/mengubah konten halaman; komunikasi satu arah ke SW via `runtime.sendMessage` | medium — muncul peringatan "baca data situs" saat install; skema non-web (chrome://, edge://, file) tidak tersentuh |

**Tidak ada**: `host_permissions` (terpisah), `tabs` (bukan activeTab), `notifications`, `history`, `downloads`.

## Privasi data

- Semua data (bookmark, kategori, learning, favicon cache, backup) disimpan **lokal** di IndexedDB/`chrome.storage` milik browser.
- Tidak ada request jaringan ke domain mana pun. Satu-satunya jalur keluar adalah mode favicon **Online** (opt-in, default off) yang memuat ikon dari CDN.
- Statistik "paling dibuka" dihitung **hanya** dari bookmark yang dibuka lewat QuickMark Pro — tanpa tracking navigasi (`tabs.onUpdated` tidak dipakai).
- Kategorisasi 100% offline (rule-based) — URL tidak pernah dikirim ke service AI apa pun.

## CSP & kebiasaan aman (MV3)

- `script-src 'self'`: **tidak ada** inline `<script>`, inline event handler (`onclick="..."` di string HTML), atau `eval`/`new Function`. Semua handler dipasang via `addEventListener`/`onclick` property JS. Favicon fallback memakai listener `error` via JS, bukan atribut inline.
- Semua teks user/URL dirender melalui `escapeHtml` (ui.js) — tidak ada `innerHTML` dengan string mentah user.
- Normalisasi URL menolak scheme non-http(s) (`javascript:` dll.) sebelum tersimpan.

## Penanganan data sensitif

- Backup snapshot memuat seluruh bookmark — tersimpan di `chrome.storage.local` device itu saja; ekspor keluar hanya saat user mengekspor file secara eksplisit.
- **Hapus semua data** (Pengaturan → Zona bahaya) memakai konfirmasi 2-klik; restore backup juga 2-klik karena destruktif.
- Tidak ada logging ke console di jalur normal (kecuali error backup di SW).

## Checklist audit cepat

1. Network panel saat pakai popup/panel/manager → harus 0 request eksternal (mode favicon cache).
2. Grep repo: `grep -r "eval\|new Function\|innerHTML=['\"]<script" extension/lib` → tidak ada hasil.
3. `chrome://extensions` → Inspector service worker → SW idle = stopped.
