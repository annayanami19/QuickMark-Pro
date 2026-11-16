# PRD — QuickMark Pro (Bookmark Manager Extension)

| | |
|---|---|
| **Nama kerja** | QuickMark Pro |
| **Tanggal** | 2026-11-16 |
| **Status** | Draft — menunggu review |
| **Platform** | Chrome & Edge (Manifest V3) |
| **Stack** | Vanilla JS + IndexedDB + chrome.storage — tanpa framework, tanpa bundler |

---

## 1. Ringkasan Eksekutif

QuickMark Pro adalah extension bookmark manager untuk Chrome/Edge yang menyelesaikan tiga kelemahan utama bookmark bawaan dan bookmark manager yang ada:

1. **Bookmark native Chrome lambat dan kaku** — kritik umum (Ultrathink, 2025): pencarian native terasa lambat dan mengandalkan hierarki folder manual yang pengguna jarang merapikan. Manager pihak ketiga seperti Raindrop.io menutupi search dan tagging, tetapi bergantung cloud/akun dan berat.
2. **Hampir tidak ada manager dengan profil terpisah.** Riset 2025–2026 (Raindrop.io, Toby, Fannon search-bookmarks, PageOrg) menunjukkan semua manager bekerja pada satu set bookmark — tidak ada yang memisahkan konteks **work / personal** di dalam satu browser. Ini differentiator utama QuickMark Pro.
3. **Auto-kategorisasi selalu dijual sebagai fitur AI cloud**, padahal mayoritas bookmark bisa diklasifikasi akurat secara offline dari domain dan URL-nya (mis. `github.com` → Dev). Rule-based = 0 latency, 0 biaya, 0 kirim data keluar.

**Keputusan arsitektur utama:**

| Keputusan | Alasan |
|---|---|
| **Storage sendiri** (IndexedDB + chrome.storage), bukan mirror `chrome.bookmarks` | Profil kustom tidak didukung struktur folder native; storage sendiri memberi skema bebas, search cepat, dan kebal terhadap perubahan/perapihan bookmark native. `chrome.bookmarks` API tetap dipakai — khusus untuk **import** dari native. |
| **Kategorisasi rule-based murni** (domain mapping + keyword, offline) | Pilihan user: tanpa AI, tanpa API key, tanpa internet. Diimbangi dengan mekanisme "belajar" lokal: keputusan kategori user per domain disimpan dan menjadi saran utama berikutnya. |
| **Vanilla JS, tanpa framework/bundler** | Konsisten dengan pola workspace (convert-pro, toolkit-pro, dll.); beban bundle minimal = cerminan tujuan "ringan". MV3 popup/side panel butuh startup super cepat — framework hanya menambah biaya boot. |
| **Data besar di IndexedDB, setting kecil di chrome.storage.sync** | Sesuai panduan resmi Chrome: `chrome.storage.local` ~5 MB (naik dengan `unlimitedStorage`) dan `sync` ~100 KB/8 KB per item — hanya untuk setting, tema, dan profil aktif; bookmark & indeks search di IndexedDB. |

### Hasil riset fitur (benchmark 2025–2026)

| Sumber | Yang diadopsi | Yang tidak diadopsi |
|---|---|---|
| Raindrop.io | Full-text search pada judul/URL/deskripsi, collections (→ kategori), permanent preview visual | Cloud sync, akun, permanent copy halaman, AI suggestion |
| Fannon search-bookmarks-history-and-tabs | Fuzzy matching ala Sublime/VSCode, keyboard-first, tag filter | Gabungan search history+tab (di luar scope) |
| Ultrathink (kritik Chrome native) | Instant search, quick-access panel, organisasi rendah friksi (1-klik save) | — |
| Toby / PageOrg | Ide visual board & auto-tagging | Tab session management (di luar scope), AI tagging cloud |

### Kelayakan & risiko

| Aspek | Kesimpulan |
|---|---|
| Kelayakan teknis | **Feasible, risiko rendah.** Semua API yang dipakai stabil di MV3 (bookmarks, storage, sidePanel, commands, omnibox). Edge mendukung API Chromium yang sama. |
| Performance | **Ringan jika disiplin:** service worker MV3 dorman (bukan persistent background), indeks search precomputed, render list virtualized. Target: popup < 100 ms, search < 50 ms pada 10.000 bookmark. |
| Risiko utama | (a) Konsistensi data popup/side-panel/manager saat dua permukaan terbuka bersamaan → diselesaikan dengan satu module `db.js` + event `chrome.storage.onChanged`/BroadcastChannel; (b) kesan "rekomendasi kategori" bisa meleset → saran selalu bisa ditolak dan dipelajari lokal; (c) kuota chrome.storage.sync untuk setting — dijaga < 8 KB per item. |

---

## 2. Tujuan & Ukuran Keberhasilan

**Tujuan:**

1. Menyimpan bookmark dalam ≤ 2 klik dengan kategori & profil yang benar, tanpa meninggalkan halaman.
2. Menemukan bookmark kembali dalam < 1 detik lewat fuzzy search keyboard-first.
3. Memisahkan konteks work/personal (atau profil apa pun) di dalam satu browser, dengan switch sekali klik.
4. Tetap ringan: tanpa framework, tanpa background yang berjalan terus, tanpa data keluar dari browser.

**Ukuran keberhasilan:**

- Popup terbuka < 100 ms (persentil biasa, PC kantor biasa).
- Fuzzy search < 50 ms pada 10.000 bookmark, hasil tampil sejak ketikan pertama.
- Save bookmark: 1 klik default, 2 klik jika memilih kategori/profil lain.
- Kategori rule-based benar ≥ 70% pada dataset uji umum (github, youtube, toko online, berita); sisanya tertutup saran yang bisa dikoreksi dan dipelajari.
- Idle: service worker dorman (tidak ada proses aktif tanpa event); RAM extension page < 50 MB bahkan pada 10k bookmark.
- Tanpa satu pun request jaringan ke luar (kecuali fetch favicon bila mode online diaktifkan — default memakai cache/ikon huruf).

**Non-tujuan (di luar scope):**

- Tidak ada cloud sync lintas perangkat, akun user, atau server backend (data lokal; `chrome.storage.sync` hanya untuk setting kecil yang memang disinkronkan Chrome).
- Tidak ada AI/LLM, tidak ada API key.
- Tidak ada snapshot/permanent copy isi halaman (bukan read-later arsip seperti Pocket — read-later di sini hanya flag + filter).
- Tidak ada dukungan Firefox/Safari (Chrome + Edge saja; kode tetap dibuat Chromium-friendly).
- Tidak mengelola tab session (bukan Toby).

---

## 3. Fitur — Spesifikasi

### 3.1 Quick Save (popup, default aksi ikon toolbar)

- Klik ikon extension membuka popup dengan state halaman aktif terisi otomatis: judul, URL, favicon.
- **Satu klik tombol Simpan** → bookmark masuk ke profil aktif + kategori hasil saran rule-based (jika percaya diri), tanpa form tambahan.
- Panel opsional terbuka (chevron / otomatis bila saran rendah percaya): pilih kategori (chips, saran bawaan ditandai "Rekomendasi"), pilih profil, tambah catatan singkat, flag Read-later/Favorit.
- **Deteksi duplikat saat save:** URL sudah ada di profil mana pun → tampil inline "Sudah ada di [Profil]/[Kategori]" dengan aksi Timpa metadata / Simpan tetap / Batal.
- Toast konfirmasi + tombol Undo (hapus yang baru disimpan) selama 5 detik.
- Bookmark yang disimpan TIDAK ditulis ke chrome.bookmarks native (storage sendiri); opsi setting "mirror ke folder native" tersedia tapi default off.

### 3.2 Search (fuzzy, instant, keyboard-first)

- Input search di popup, side panel, dan manager — semua memakai engine yang sama.
- Sumber field: judul, URL, catatan, nama kategori, nama profil. Fuzzy ala Sublime/VSCode (subsequence + skor: posisi awal, kemacetan kata, exact match mendapat boost).
- Hasil mulai tampil sejak ketikan pertama, maks 30 item per render, scroll memuat tambahan (incremental).
- Navigasi keyboard: ↑/↓ pilih, Enter buka di tab aktif, Ctrl/Cmd+Enter tab baru, Shift+Delete hapus (dengan konfirmasi 2-klik inline).
- Filter cepat (chips di atas hasil): profil aktif, kategori, flag (Favorit / Read-later), tanpa kategori.
- Highlight bagian yang cocok pada judul/URL.
- Untuk 10.000+ bookmark: indeks precomputed (lihat §6) sehingga tetap < 50 ms.

### 3.3 Kategori — manual + rekomendasi bawaan (rule-based)

- **Manual:** user buat kategori bebas — nama, warna, ikon (dari set SVG bawaan), urutan. Kategori bisa nested 1 tingkat (sub-kategori) — cukup, tidak lebih (folder hierarki dalam adalah masalah Chrome native yang dihindari).
- **Aktif/nonaktif per kategori:** kategori buatan user punya toggle *aktif* (semacam dataset bawaan di Pengaturan). Nonaktif = disembunyikan dari semua pemilih kategori; bookmark yang memakainya tidak diubah (jaring pengaman — bukan penghapusan).
- **Bawaan (dataset terpasang saat install, bisa dimatikan per kategori di Pengaturan):** Dev, Desain, Sosial Media, Belanja, Berita, Hiburan, Belajar, Produktivitas, Keuangan, Travel, Game, Lainnya.
- **Rule-based classifier (offline, urutan prioritas):**
  1. **Belajar lokal per domain** — keputusan user sebelumnya untuk domain itu (paling kuat).
  2. **Domain mapping dataset** — tabel `domain → kategori` bawaan (`github.com`, `stackoverflow.com` → Dev; `youtube.com` → Hiburan; `tokopedia/shopee/amazon` → Belanja; dst) + subdomain TLD umum (`*.gov` → Pemerintahan).
  3. **Keyword URL/judul** — kata kunci di path/judul (`docs`, `tutorial`, `repo` → Dev; `promo`, `diskon`, `cart` → Belanja).
  4. Tidak cocok → tanpa saran; save tetap jalan, bookmark masuk "Tanpa kategori".
- Setiap saran tampil sebagai chip dengan label "Rekomendasi"; user bisa terima, ganti, atau tanpa kategori. Keputusan (domain → kategori) disimpan ke profil → classifier makin akurat seiring pakai.
- View kategori di side panel & manager: grid chip + jumlah; klik memfilter.

### 3.4 Profil (work / personal / bebas)

- Profil = konteks terpisah penuh: bookmark, kategori, keputusan classifier, statistik. Kategori bisa dibuat per profil ATAU disematkan "shared" lintas profil.
- Switcher profil: dropdown di popup, header side panel, dan manager — 1 klik pindah.
- **Profil aktif per jendela browser** (dijaga via `chrome.storage.session` per `windowId`); jendela baru mewarisi profil default.
- Boleh menandai bookmark "muncul di semua profil" (mis. dokumen resmi) — implementasi: flag `shared`, bukan duplikasi data.
- Nama & warna aksen profil bisa diubah; profil default "Pribadi" tidak bisa dihapus jika masih ada bookmark (harus dipindah/dihapus dulu).
- Delete profil: konfirmasi 2-klik + opsi ekspor dulu; bookmark di dalamnya ikut terhapus.

### 3.5 Read-later + Favorit

- Flag boolean per bookmark; toggle dari popup saat save, dari item list (ikon), dan dari keyboard (`l` pada item terpilih di manager).
- Filter khusus "Baca nanti" dan "Favorit" di semua permukaan + badge jumlah di header.
- Bookmark read-later yang dibuka lewat search/filter > 3 kali mendapat saran inline "Sudah sering dibuka — tandai selesai?" (mematikan flag).

### 3.6 Import / Export + Dedup + Backup

- **Import dari bookmark native** (via `chrome.bookmarks.getTree()`): flatten seluruh hierarki, folder native dijadikan saran kategori (dengan mapping classifier), target profil dipilih sebelum import.
- **Import file:** HTML Netscape bookmark (format ekspor standar semua browser) dan JSON QuickMark Pro.
- **Export:** JSON lengkap (profil + kategori + bookmark + keputusan classifier) dan HTML Netscape (kompatibel semua browser).
- **Dedup:** deteksi URL sama (normalisasi: strip trailing `/`, strip `utm_*` & fragment, lowercase host). Mode: Lepaskan duplikat (default) / Perlihatkan dulu (review pair-by-pair) / Biarkan. Bisa dijalankan mandiri dari Pengaturan atas seluruh data.
- **Backup otomatis lokal:** snapshot JSON ke `chrome.storage.local` (dengan `unlimitedStorage`) tiap 24 jam + tiap sebelum import bulk; rotasi maks 5 snapshot; restore dari Pengaturan.

### 3.7 Shortcut + Omnibox

- `chrome.commands`:
  - `open-quickmark` (Ctrl+Shift+K default) — buka popup/side panel sesuai setting.
  - `quick-save` (Ctrl+Shift+S default) — simpan halaman aktif langsung tanpa membuka popup (pakai profil & saran kategori aktif); toast konfirmasi.
  - Shortcut bisa diubah user lewat halaman `chrome://extensions/shortcuts` (tampil petunjuk di Pengaturan).
- `chrome.omnibox` keyword `qm`: ketik `qm <query>` di address bar → suggestion dropdown berisi hasil fuzzy search (maks 8, skor relevansi, deskripsi = kategori + profil), Enter membuka hasil pertama, ↓ memilih.
- Kedua jalur memakai engine search yang sama dengan UI — satu implementasi.

### 3.8 Statistik ringan

- Dashboard mini di manager: total bookmark, per kategori (bar horizontal), per profil, 10 terbaru, 10 paling dibuka.
- Hitung "dibuka" secara pasif: saat bookmark dibuka lewat QuickMark Pro (popup/panel/omnibox) increment counter + `lastOpened`. Tidak ada tracking navigasi di luar itu (bukan `tabs.onUpdated` global — lebih hemat & lebih privat).
- Semua agregasi dihitung on-demand dari IndexedDB saat view statistik dibuka; tidak ada agregasi berjalan di background.

### 3.9 Pengaturan

- Tema: Dark (default) / Light / System; hormati `prefers-reduced-motion`.
- Profil default + perilaku jendela baru (warisi jendela asal / profil default).
- Dataset kategori bawaan: on/off per kategori.
- Favicon: cache lokal (default) / online (Google s2) / ikon huruf saja.
- Backup: interval, jumlah rotasi, tombol backup sekarang / restore.
- Mirror native: off (default) / on — bila on, tiap save juga ditulis ke folder "QuickMark Pro" di chrome.bookmarks.
- Data: tombol dedup, export, import, hapus semua data (konfirmasi 2-klik + ketik nama extension).
- Semua setting tersimpan otomatis (auto-save), tanpa tombol Save.

---

### 3.10 Panel cepat + chips collapsible (revisi feedback 2026-11-16)

- **Chips kategori popup collapsible**: default 1 baris terlipat (mask fade); tombol `+N kategori ▾` muncul hanya saat overflow; expand = daftar scrollable maks 120px. Mencegah save-card memanjang saat kategori bertambah.
- **Panel cepat (FAB manager)**: lingkaran `+` mengambang pojok kanan bawah halaman manager — klik membuka form tambah bookmark cepat (URL, judul, kategori, profil, flag). Bisa di-drag bebas (pointer events, clamp viewport). Pengaturan posisi (di panel cepat & view Pengaturan): **Diam di pojok** (default) atau **Bebas digeser** — posisi tersimpan di `chrome.storage.local`.
- **Panel cepat di halaman web** (revisi feedback 2): content script menyuntikkan FAB yang sama di setiap situs http/https — klik membuka form quick-add (URL/judul terisi otomatis dari halaman), bisa di-drag. Save lewat `runtime.sendMessage` → service worker → `saveBookmark` (satu pintu). Bisa dimatikan di Pengaturan (`quickPanelSites`). Tradeoff izin: content script http/https membuat browser menampilkan peringatan akses situs saat install.

---

## 4. Arsitektur

### 4.1 Struktur folder

```
quickmark-pro/
├── manifest.json            # MV3, permission minimal
├── background/
│   └── sw.js                # service worker: commands, omnibox, mirror native, backup timer
├── popup/
│   ├── popup.html / popup.css / popup.js     # quick save + search + switcher profil
├── panel/
│   ├── panel.html / panel.css / panel.js     # side panel: browse kategori + search
├── manager/
│   ├── manager.html / manager.css / manager.js  # halaman penuh: kelola, profil, import/export, statistik, settings
├── lib/
│   ├── db.js                # IndexedDB wrapper: satu skema, migrasi, bulk load
│   ├── search.js            # fuzzy engine + indeks precomputed (dipakai semua permukaan)
│   ├── categorizer.js       # rule-based classifier + dataset kategori + learning per domain
│   ├── profiles.js          # CRUD profil, profil aktif per windowId
│   ├── dedup.js             # normalisasi URL + deteksi duplikat
│   ├── io.js                # import native/HTML/JSON, export, backup rotasi
│   └── ui.js                # komponen kecil bersama: toast, confirm 2-klik, chips, virtual list
├── data/
│   └── categories.json      # dataset kategori bawaan (domain map + keyword)
├── icons/                   # 16/32/48/128 + set ikon SVG kategori
└── tests/                   # unit test pure modules (search, categorizer, dedup, io)
```

### 4.2 Manifest & permission

- `manifest_version: 3`; `action.default_popup`; `side_panel.default_path`; `commands` (2 shortcut); `omnibox: { keyword: "qm" }`.
- Permission: `storage`, `unlimitedStorage`, `bookmarks` (khusus import native & mirror), `favicon`, `sidePanel`, `commands` (implisit), `omnibox` (implisit).
- **TANPA `host_permissions` luas** dan tanpa content script — extension tidak membaca isi halaman; hanya judul/URL via `chrome.tabs` (aktif tab, saat diminta user).

### 4.3 Skema data (IndexedDB, DB `quickmark`)

- `bookmarks`: `{ id (uuid), profileId, url (dinormalisasi), urlRaw, title, note, categoryId, flags: {favorite, readLater}, openCount, lastOpened, createdAt }` — index: `by_profile`, `by_profile_url` (unique), `by_category`, `by_created`, `by_open`.
- `categories`: `{ id, profileId | "shared", name, color, icon, order, builtIn }` — index `by_profile`.
- `profiles`: `{ id, name, color, isDefault }`.
- `learning`: `{ domain, categoryId, profileId, count }` — keputusan classifier user.
- Setting & profil aktif (per windowId): `chrome.storage.session` (per jendela, hilang saat browser tutup → jendela baru mewarisi default); setting persisten: `chrome.storage.sync` (jaga < 8 KB/item); snapshot backup: `chrome.storage.local`.

### 4.4 Pola MV3 & konsistensi lintas permukaan

- Service worker **dormant**: listener didaftarkan sinkron di top-level (aturan MV3), tidak ada state global, tidak ada persistent loop. Pekerjaan: event `commands`, `omnibox`, backup harian via `chrome.alarms`.
- Popup, panel, dan manager memuat sendiri modul `lib/*` (ES modules) dan membaca IndexedDB langsung — tanpa roundtrip ke service worker (lebih cepat, sw tetap dorman).
- Konsistensi antar permukaan yang terbuka bersamaan: `BroadcastChannel('quickmark')` broadcast per perubahan tulis + re-render bertarget.

### 4.5 Dilarang / dijaga

- Tidak ada framework, bundler, node_modules, atau CDN di package (keamanan + ringan).
- Tidak ada evaluasi dinamis (`eval`, `new Function`) — kebijakan CSP MV3.
- Data tidak pernah keluar browser; tidak ada request ke domain mana pun kecuali favicon mode online yang opt-in.
- Normalisasi URL dilakukan di satu fungsi (`dedup.js`) yang dipakai save, import, dedup, search — tidak ada dua definisi.

---

## 5. Desain UI

### 5.1 Bahasa visual

- Glassmorphism ringan mengikuti bahasa visual workspace (glass card, radius 14–18px, border `rgba(255,255,255,.08)`), tetapi **tanpa animasi latar aurora** — popup harus terbuka < 100 ms dan animasi dekoratif melawan itu.
- Accent per profil: warna aksen profil aktif mewarnai border atas popup & item switcher (umpan balik konteks instan — "aku sedang di Work").
- Dark default, Light & System tersedia. Font system stack (Segoe UI Variable); mono untuk URL.
- Semua komponen custom (dropdown, dialog, toast, scrollbar) — tanpa kontrol native, mengikuti pola workspace; aksesibel keyboard (Escape, ↑/↓, Enter).

### 5.2 Tiga permukaan

```
Popup (360×480)                Side panel                     Manager (tab penuh)
┌──────────────────┐   ┌──────────────────────┐   ┌────────────────────────────┐
│ favicon judul    │   │ Search bar           │   │ Sidebar nav: Bookmark/     │
│ [Simpan] 1 klik  │   │ Profil switcher      │   │  Kategori/Profil/Statistik/│
│ chips kategori   │   │ Chips kategori       │   │  Data & Backup/Pengaturan  │
│ profil ▾ catatan │   │ List hasil (virtual) │   │ Tabel bookmark: search,    │
│ search bar       │   │ Read-later badge     │   │  filter multi, bulk action │
│ hasil fuzzy      │   │ + tombol buka Manager│   │ Import/Export, dedup,      │
└──────────────────┘   └──────────────────────┘   │  statistik, settings       │
                                                  └────────────────────────────┘
```

- **Popup** = save dulu, search kedua. Panel opsional (expand) untuk kategori/profil/catatan.
- **Side panel** = browse & search santai di samping halaman; list virtualized; buka manager dari header.
- **Manager** = kontrol penuh: tabel dengan kolom (favicon+judul, URL mono, kategori chip, profil, flag, dibuka, tanggal), multi-select + bulk (pindah kategori/profil, hapus), edit inline.
- Konfirmasi destruktif pola "klik LAGI" (bukan dialog OS).
- Toast glass bawah-tengah, 3.2s, dengan Undo bila konteksnya mendukung.

---

## 6. Performance

| Aspek | Target | Cara |
|---|---|---|
| Buka popup | < 100 ms | Tanpa framework; skeleton render dulu dari cache in-memory; bulk load IndexedDB sekali per permukaan (semua bookmark ke array in-memory — 10k item ≈ 5–10 MB, aman) |
| Fuzzy search | < 50 ms / 10k bookmark | Indeks precomputed saat load: array `{id, titleLower, urlLower, noteLower}` + skor subsequence satu-pass; tanpa regex per token; hasil sort parsial (top-30, bukan full sort) |
| Render list | Tidak jank pada ribuan item | Virtualized list sederhana (windowing ~30 baris terlihat) di panel & manager; popup maks 30 hasil + "muat lagi" |
| Service worker | Dormant saat idle | Listener top-level sinkron; tanpa interval; backup via `chrome.alarms` (sekali/hari); SW mati lagi setelah event selesai |
| Memori extension page | < 50 MB @ 10k bookmark | Payload per bookmark disimpan ramping (tanpa duplikasi field); string indeks dibangun lazy untuk note |
| Startup extension | < 50 ms background | SW tidak memuat lib UI; modul di-import on-demand per event |
| Favicon | 0 jank & 0 jaringan default | Cache di IndexedDB (`favicons` store) saat pertama save (via endpoint `_favicon/` + `favicon` permission); fallback ikon huruf warna kategori |

Ukuran package target: < 200 KB tanpa ikon; seluruhnya statis, tanpa build step.

---

## 7. Roadmap Implementasi

| Fase | Isi | Estimasi relatif |
|---|---|---|
| **Fase 1 — Fondasi** | Scaffold `quickmark-pro/`, manifest MV3, `db.js` (skema + migrasi), `profiles.js` + profil aktif per window, popup quick-save (simpan + duplikat check + toast undo), unit test db | Terbesar |
| **Fase 2 — Search & Kategori** | `search.js` (indeks + fuzzy + highlight), `categorizer.js` (dataset + rule + learning), chips kategori di popup, filter di popup search | Sedang |
| **Fase 3 — Panel & Manager** | Side panel (browse kategori, list virtualized), manager page (tabel, bulk action, edit inline, statistik), `io.js` (import native/HTML/JSON, export, dedup, backup rotasi) | Sedang |
| **Fase 4 — Pintasan & Polish** | `commands` (open + quick-save), omnibox `qm`, tema light/system, a11y keyboard audit, ikon & branding, packaging review (ukuran, permission audit) | Ringan-sedang |

Urutan dipilih karena popup save adalah inti nilai (harus benar sejak Fase 1), search & kategori adalah pengalaman harian berikutnya, sementara panel/manager adalah permukaan yang paling bisa mengikuti pola yang sudah ada.

---

## 8. Kriteria Penerimaan

**Quick Save:**
- [ ] Klik ikon → popup tampil < 100 ms dengan judul/URL/favicon halaman aktif terisi.
- [ ] Simpan 1 klik → bookmark masuk profil aktif + kategori saran (jika ada); toast + Undo 5 detik berfungsi.
- [ ] URL duplikat terdeteksi lintas profil (normalisasi utm/fragment) dan tampil pilihan Timpa/Simpan tetap/Batal.
- [ ] Shortcut `quick-save` menyimpan tanpa popup; toast konfirmasi tampil.

**Search:**
- [ ] Fuzzy match subsequence (mis. "gh prf" menemukan "GitHub Profile"); exact match & awalan kata mendapat skor lebih tinggi.
- [ ] Hasil tampil sejak ketikan pertama, < 50 ms pada dataset 10.000 bookmark (diuji dengan generator dummy).
- [ ] ↑/↓/Enter/Ctrl+Enter/Shift+Delete berfungsi; highlight cocok tampil; hasil > 30 dimuat incremental.
- [ ] Engine yang sama dipakai popup, panel, dan omnibox — hasil konsisten.

**Kategori:**
- [ ] Kategori manual: buat/rename/warna/ikon/urutan/hapus (hapus menanyakan nasib bookmark di dalamnya).
- [ ] Rule-based: domain dataset, subdomain TLD, dan keyword menghasilkan saran benar pada dataset uji; saran tanpa kecocokan = tanpa kategori, save tetap jalan.
- [ ] Koreksi user (ganti kategori saat save) tersimpan ke `learning` dan menjadi saran pertama untuk domain sama berikutnya.
- [ ] Dataset bawaan bisa dimatikan per kategori di Pengaturan.

**Profil:**
- [ ] Buat/switch/rename/ubah warna/hapus profil; data (bookmark, kategori non-shared, learning, statistik) terpisah penuh antar profil.
- [ ] Profil aktif per jendela: 2 jendela bisa beda profil; jendela baru mewarisi sesuai setting.
- [ ] Flag `shared` menampilkan bookmark di semua profil tanpa duplikasi data.
- [ ] Hapus profil dengan bookmark terblokir sampai bookmark dipindah/dihapus; konfirmasi 2-klik + tawaran export.

**Read-later & Favorit:**
- [ ] Flag bisa diset dari popup, item list, dan keyboard; filter + badge jumlah benar di semua permukaan.
- [ ] Bookmark read-later dibuka > 3x lewat QuickMark mendapat saran "tandai selesai".

**Import/Export/Dedup/Backup:**
- [ ] Import native (chrome.bookmarks), HTML Netscape, dan JSON — folder native menjadi saran kategori; target profil dipilih sebelum import.
- [ ] Export JSON & HTML bisa di-reimport (round-trip tidak kehilangan data pada JSON).
- [ ] Dedup 3 mode berfungsi; laporan jumlah duplikat sebelum eksekusi.
- [ ] Backup otomatis harian + sebelum import bulk; rotasi maks 5; restore mengembalikan data utuh.

**Shortcut & Omnibox:**
- [ ] Ctrl+Shift+K membuka panel, Ctrl+Shift+S quick-save; keduanya tercatat & bisa diubah via chrome://extensions/shortcuts.
- [ ] `qm <query>` di omnibox menampilkan maks 8 saran berurut relevansi; Enter buka pertama; ↓ memilih.

**Statistik:**
- [ ] Angka total/per kategori/per profil/terbaru/terbuka benar; dihitung on-demand (tidak ada agregasi di background).
- [ ] openCount hanya bertambah bila bookmark dibuka lewat QuickMark Pro.

**Kualitas & Privasi:**
- [ ] Tanpa `host_permissions`, tanpa content script, tanpa request jaringan (kecuali favicon online opt-in) — diverifikasi di Network panel.
- [ ] Service worker dormant saat idle (verifikasi via chrome://serviceworker-internals / task manager).
- [ ] Popup/panel/manager menampilkan data konsisten saat terbuka bersamaan (perubahan di satu permukaan langsung terlihat di lainnya).
- [ ] Unit test hijau untuk `search.js`, `categorizer.js`, `dedup.js`, `io.js` (modul pure).
- [ ] Tema Dark/Light/System; `prefers-reduced-motion` dihormati; semua kontrol keyboard-accessible.
- [ ] Ukuran package < 200 KB (tanpa ikon); tanpa node_modules/CDN/eval.

**Kompatibilitas:**
- [ ] Chrome stable & Edge stable (Chromium terkini): semua fitur di atas identik di keduanya.
