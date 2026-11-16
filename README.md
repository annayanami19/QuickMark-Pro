# QuickMark Pro

Bookmark manager extension untuk **Chrome & Edge** (Manifest V3): quick save 1-klik, fuzzy search instan, kategori otomatis offline (rule-based), dan **multi-profil** (work/personal) — differentiator utama yang tidak dimiliki manager lain.

> PRD lengkap: [PRD.md](PRD.md) · Dokumentasi teknis: [docs/](docs/)

## Struktur folder

```
quickmark-pro/
├── PRD.md            # Product Requirements Document (root — dokumen umum)
├── README.md         # File ini (root — umum)
├── docs/             # Dokumentasi terpisah (arsitektur, panduan, performance, dsb.)
└── extension/        # Kode extension (folder tersendiri — load unpacked dari sini)
    ├── manifest.json
    ├── background/sw.js     # Service worker MV3 (dorman; commands + omnibox + backup)
    ├── popup/               # Quick save + search (360x480)
    ├── panel/               # Side panel: browse kategori + search
    ├── manager/             # Halaman penuh: tabel, profil, statistik, data, settings
    ├── lib/                 # Modul inti: db, search, categorizer, profiles, dedup, io, save, settings, ui
    ├── data/categories.js   # Dataset kategori bawaan (domain + keyword, offline)
    ├── icons/               # 16/32/48/128
    └── tests/               # Unit test modul pure (Node runner)
```

## Install (load unpacked)

1. Buka `chrome://extensions` (Edge: `edge://extensions`).
2. Aktifkan **Developer mode**.
3. **Load unpacked** → pilih folder `extension/`.
4. Ikon QuickMark Pro muncul di toolbar. Shortcut default:
   - `Ctrl+Shift+K` — buka popup
   - `Ctrl+Shift+S` — quick-save halaman aktif
   - Ketik `qm <query>` di address bar — cari langsung dari omnibox

## Menjalankan test

```bash
cd extension
node tests/run.mjs
```

Cakupan: modul pure — `dedup.js` (normalisasi URL), `search.js` (fuzzy scoring), `categorizer.js` (rule-based classifier). Status terakhir: **18/18 pass**. Lihat [docs/TESTING.md](docs/TESTING.md).

## Prinsip yang dijaga

- **Ringan**: vanilla JS tanpa framework/bundler; service worker dorman; indeks search precomputed.
- **Privat**: tanpa `host_permissions`, tanpa content script, tanpa request jaringan (favicon online opt-in).
- **Offline-first**: kategorisasi rule-based murni lokal (learning per domain + domain mapping + keyword).

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arsitektur modul, skema data, alur MV3 |
| [docs/USERGUIDE.md](docs/USERGUIDE.md) | Panduan pemakaian per fitur |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Target & teknik performa |
| [docs/SECURITY-PRIVACY.md](docs/SECURITY-PRIVACY.md) | Permission, CSP, privasi data |
| [docs/TESTING.md](docs/TESTING.md) | Cara menjalankan & menambah test |
