# Testing — QuickMark Pro

## Strategi

Modul **pure** (tanpa `chrome.*`/DOM di jalur yang dites) dites di Node:

| Modul | Yang dites |
|---|---|
| `dedup.js` | Normalisasi URL (utm/fragment/trailing slash/non-http ditolak), grup duplikat, pemilihan survivor |
| `search.js` | Fuzzy scoring (exact > subsequence), buildIndex, urutan, filter kategori/flag, highlight ranges |
| `categorizer.js` | Domain mapping, subdomain, TLD rule, learning override, keyword dengan word-boundary, confidence |

UI (popup/panel/manager) dan API nyata (`chrome.*`, IndexedDB) dites manual di browser — lihat checklist di bawah (aturan workspace: pengujian UI milik user).

## Menjalankan

```bash
cd extension
node tests/run.mjs
```

Output: satu baris PASS/FAIL per test + ringkasan; exit code 1 bila ada FAIL (siap untuk CI).

## Menambah test

1. Buka `tests/suite.js`.
2. Tambah blok:
   ```js
   test('deskripsi perilaku', () => {
     assert.equal(hasilYangDiuji, nilaiDiharapkan);
   });
   ```
3. Jalankan ulang `node tests/run.mjs`.

Konsol browser (`tests/run.mjs` tidak butuh DOM) — suite.js aman di-import dari halaman extension juga bila ingin dibungkus runner HTML nanti.

## Checklist verifikasi manual (chrome://extensions → load unpacked `extension/`)

- [ ] Klik ikon → popup tampil < 100 ms dengan judul/URL halaman aktif.
- [ ] Simpan 1 klik → toast + Undo berfungsi; bookmark masuk kategori saran.
- [ ] Simpan URL yang sama → banner duplikat; parameter `?utm_source=x` dianggap sama.
- [ ] `Ctrl+Shift+S` → badge OK/DUP; halaman tersimpan tanpa popup.
- [ ] `qm <query>` di address bar → saran fuzzy; Enter membuka; openCount bertambah di Statistik.
- [ ] Switch profil di popup → bookmark baru masuk profil itu; jendela lain profil sendiri.
- [ ] Manager: filter kategori/profil/flag, bulk pindah/hapus, edit modal.
- [ ] Import native + HTML + JSON; export round-trip JSON; dedup scan/auto; backup + restore.
- [ ] Chips kategori popup: >1 baris memunculkan tombol `+N kategori ▾`; expand scrollable; collapse kembali; state tetap saat pilih chip.
- [ ] Panel cepat di halaman web: buka situs https apa pun → FAB pojok kanan bawah; klik buka form (URL/judul terisi otomatis); simpan → toast; drag FAB → posisi ikut (per-tab, sessionStorage); halaman chrome:// / edge:// → FAB TIDAK muncul; Pengaturan → matikan "Di halaman web" → FAB hilang tanpa reload (refresh halaman web jika belum terpakai); situs dengan CSP ketat → FAB tetap muncul (content script ISOLATED).
- [ ] Panel cepat manager: FAB pojok kanan bawah; klik buka panel; drag ke posisi lain berfungsi (mode Bebas → posisi tersimpan, reload tetap); mode Diam di pojok → kembali ke pojok; simpan dari panel → bookmark masuk + toast + tabel ter-refresh.
- [ ] Tema dark/light/system; `prefers-reduced-motion` tidak ada animasi dekoratif.
- [ ] Network panel: 0 request eksternal (favicon mode default).
