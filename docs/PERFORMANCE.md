# Performance — QuickMark Pro

## Target & cara (PRD §6)

| Aspek | Target | Implementasi |
|---|---|---|
| Buka popup | < 100 ms | Tanpa framework; bulk load IndexedDB sekali per permukaan ke array in-memory (10k bookmark ≈ 5–10 MB, aman); render segera tanpa menunggu favicon. |
| Fuzzy search | < 50 ms / 10k bookmark | `buildIndex` precomputed (lowercase title/url/note sekali); `fuzzyScore` satu-pass O(len) tanpa regex per token; sort sekali di akhir + `slice(limit)`. |
| Render list besar | tanpa jank | `virtualList` (windowing ~30 baris terlihat) di side panel & manager; manager batasi hasil 1000 baris tabel. |
| Service worker | dorman saat idle | Listener top-level sinkron; tanpa interval; backup via `chrome.alarms` (1×/hari); SW tidak dipakai untuk operasi data UI. |
| Statistik | nol biaya idle | Agregasi on-demand saat view dibuka; tidak ada agregasi berkala. |
| Favicon | 0 jaringan default | Mode `cache`: endpoint `_favicon/` via `runtime.getURL` (permission `favicon`), fallback ikon huruf saat error; mode `online` opt-in eksplisit. |

## Keputusan yang membeli kecepatan

1. **Tanpa framework/bundler** — popup hanya parse ~9 file JS kecil; tidak ada hydrate/bootstrapping.
2. **Indeks in-memory sekali load** — trade-off RAM (< 50 MB @ 10k) vs latency; reload hanya saat broadcast 'bookmarks-changed'.
3. **Top-N parsial** — hasil dibatasi (popup 30, panel 500) sebelum render; scroll/muat tambahan.
4. **SW zero-work** — omnibox & command menghitung sendiri di SW (bulk load sekali per event), lalu SW mati lagi.
5. **CSS tanpa animasi latar** — aurora sengaja tidak dibawa dari gaya workspace lain; transisi hanya toast (0.18s).

## Cara mengukur ulang

- Popup: DevTools → Performance → record buka popup (p95 target < 100 ms di PC kantor biasa).
- Search 10k: generate dummy bookmark via manager → import JSON dummy → ukur `performance.now()` di console:
  ```js
  const t0 = performance.now(); // panggil renderResults dari module scope
  ```
- SW dorman: Task Manager Chrome (Shift+Esc) — proses extension tidak menunjukkan CPU saat idle; `chrome://serviceworker-internals` menunjukkan SW stopped.
- Ukuran package: `du -sh extension/` — target < 200 KB tanpa ikon (realita: ~90 KB kode + ~10 KB ikon).
