# Arsitektur — QuickMark Pro

MV3, vanilla JS ES modules, tanpa framework/bundler. Tiga permukaan UI (popup, side panel, manager) membaca IndexedDB **langsung** — service worker tidak dilibatkan untuk operasi data agar tetap dorman.

## Diagram modul

```
manifest.json
├── popup/popup.js ────┐
├── panel/panel.js ────┤   semua import modul lib/* langsung (ESM, relative path)
├── manager/manager.js ┘
│
└── background/sw.js (dorman — hanya event: commands, omnibox, alarms)

lib/
├── db.js           IndexedDB wrapper (satu skema, 5 store)
├── profiles.js     CRUD profil + profil aktif per windowId (chrome.storage.session)
├── settings.js     setting kecil via chrome.storage.sync + applyTheme
├── categorizer.js  rule-based classifier (pure classify + recordDecision → db)
├── search.js       buildIndex + fuzzyScore + search (pure)
├── dedup.js        normalizeUrl + findDuplicateGroups (pure)
├── save.js         alur save bersama (popup & command quick-save share satu pintu)
├── io.js           import native/HTML/JSON, export, dedup mandiri, backup rotasi
└── ui.js           escapeHtml, toast, confirm2, broadcast, virtualList, ikon SVG
```

## Keputusan arsitektur

| Keputusan | Alasan |
|---|---|
| Data di IndexedDB, setting kecil di `chrome.storage.sync` | Panduan resmi Chrome: sync ~100 KB total & 8 KB/item; data besar (bookmark/learning/favicon) butuh `unlimitedStorage` + IndexedDB. |
| SW dorman: listener top-level sinkron, tanpa state global | MV3 mematikan SW yang tidak terpakai; state global hilang tiap kill. Semua listener `chrome.commands/omnibox/alarms` didaftarkan langsung di top-level `sw.js`. |
| Halaman UI membaca db langsung, bukan lewat SW | Menghindari wake-up SW (jaga dorman) + latency lebih rendah. Konsistensi antar permukaan via `BroadcastChannel('quickmark')` (ui.js `broadcast`/`onBroadcast`). |
| Alur save satu pintu (`save.js`) | Popup dan command `quick-save` (sw.js) memakai fungsi yang sama — tidak ada dua definisi dedup/classify saat save (PRD §4.5). |
| `normalizeUrl` satu definisi (`dedup.js`) | Dipakai save, import, dedup, unique index — normalisasi berbeda antar jalur = duplikat bocor. |
| Sinkron live antar permukaan (feedback: data baru tak muncul tanpa refresh) | `saveSettings` memancarkan `settings-changed` via BroadcastChannel (satu pintu); manager/popup/panel mendengarkan lalu muat ulang state turunan (`refreshDerived`), content script mengambil meta fresh SETIAP panel dibuka. Pola resmi `storage.onChanged` tetap dipakai content script untuk toggle FAB. |
| Panel cepat FAB di halaman web (content script) | Tambah bookmark saat browsing tanpa buka popup. ISOLATED world + CSS prefix `qmp-` supaya tak bentrok halaman; save tetap satu pintu: `sendMessage('qm-save')` → SW → `saveBookmark` (IndexedDB extension tak terjangkau dari content script). On/off via setting `quickPanelSites` — dibaca langsung dari `storage.sync` + listener `storage.onChanged` (tanpa reload). |
| Panel cepat FAB di manager, drag + mode corner/free | Tambah bookmark dari manager tanpa buka popup; mode & posisi tersimpan (`quickPanelMode` di sync, posisi di local — posisi bergantung ukuran layar, bukan data yang perlu sync). |
| Chips kategori popup collapsible (1 baris + expand) | Mencegah panel memanjang saat kategori bertambah banyak. |
| Dataset kategori sebagai ES module (`data/categories.js`) | JSON import dengan `with { type: 'json' }` butuh Chrome modern & rapuh; module JS aman di semua context dan tetap tanpa build step. |

## Skema data (IndexedDB `quickmark`, v1)

| Store | keyPath | Index |
|---|---|---|
| `profiles` | `id` | — |
| `categories` | `id` | `by_profile` (profileId: profil atau `'shared'`) |
| `bookmarks` | `id` | `by_profile`, `by_profile_url` (unique: ['profileId','url']), `by_category`, `by_created`, `by_open` |
| `learning` | `['profileId','domain']` | — |
| `favicons` | `host` | — |

Bookmark: `{ id, profileId, url (ternormalisasi), urlRaw, title, note, categoryId, flags:{favorite,readLater}, openCount, lastOpened, createdAt, shared }`.

Unique index `by_profile_url` = pertahanan duplikat terakhir; ConstraintError ditangkap `addBookmark` → `{ok:false, reason:'duplicate'}`.

## Alur MV3 penting

- **Profil aktif per jendela**: `chrome.storage.session` key `qmActiveProfile:win:<windowId>` — hilang saat browser tutup; jendela baru fallback ke profil default (PRD §3.4).
- **Omnibox**: `content` saran = URL (dibuka saat Enter); query mentah → buka hasil teratas. `openCount` di-increment saat dibuka lewat QuickMark (statistik pasif).
- **Backup**: `chrome.alarms` harian (`qmBackupDaily`) → snapshot JSON penuh ke `chrome.storage.local`, rotasi maks 5 (io.js). Import bulk selalu backup dulu lewat UI manager.
- **Mirror native (default off)**: bila aktif, save juga ditulis ke folder `QuickMark Pro` di chrome.bookmarks (save.js `mirrorNativeIfEnabled`).

## Batasan yang disengaja

- Kategori nested maks 1 tingkat (tidak ada hierarki folder dalam — masalah UX Chrome native yang dihindari).
- Tidak ada agregasi statistik di background; semua dihitung on-demand saat view statistik dibuka.
- Tidak ada framework → komponen UI (dropdown, modal, toast, virtual list) ditulis sendiri di `ui.js` + CSS token bersama (`lib/common.css`).
