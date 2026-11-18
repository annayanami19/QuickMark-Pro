# Panduan Pengguna — QuickMark Pro

## Simpan bookmark (Quick Save)

1. Buka halaman yang ingin disimpan.
2. Klik ikon QuickMark Pro (atau `Ctrl+Shift+K`) — popup menampilkan judul + URL halaman aktif.
3. Klik **Simpan** → bookmark masuk ke profil aktif dengan kategori rekomendasi otomatis.
4. Konfirmasi muncul sebagai toast dengan tombol **Undo** (5 detik) jika salah simpan.

Opsi tambahan:
- Klik chip kategori untuk memilih kategori lain (chip bertanda **Rekomendasi** = saran otomatis).
- Banyak kategori? Baris chip default **1 baris terlipat** — tombol `+N kategori ▾` membuka daftar lengkap (scrollable), `Sembunyikan ▴` melipat lagi.
- Tombol **…** membuka panel: catatan, flag **Baca nanti** / **Favorit**.
- Simpan tanpa membuka popup: `Ctrl+Shift+S` (ikon toolbar menampilkan badge OK/DUP sesaat).

## Panel cepat (manager & halaman web)

Lingkaran **+** mengambang di pojok kanan bawah halaman manager — klik untuk membuka panel tambah bookmark cepat (URL, judul, kategori, profil, flag).

- **Geser**: tarik lingkaran itu ke posisi mana pun.
- **Pengaturan posisi** ada di dua tempat: dropdown di dalam panel cepat, dan **Pengaturan → Panel cepat**:
  - **Diam di pojok** (default) — selalu kembali ke pojok kanan bawah.
  - **Bebas digeser** — posisi terakhir tersimpan (per browser).
- Panel terbuka ke arah atas-kiri FAB dan otomatis menjaga tetap di dalam viewport.
- Simpan dari panel cepat = alur yang sama dengan popup: kategori auto (atau pilih), duplikat ditolak dengan toast, learning per domain tercatat.

## Kategori: bawaan vs kategori saya

- Semua pemilih kategori (popup, panel cepat manager & halaman web, edit modal, bulk) memisahkan dua grup lewat **optgroup/label**: **Bawaan** (dataset aktif: Dev, Sosial Media, dll) dan **Kategori saya** (yang kamu buat sendiri di view Kategori).
- Pilihan "(otomatis)" memakai classifier — sama di semua permukaan.
- On/off dataset bawaan tetap di **Pengaturan → Dataset kategori bawaan**; daftar di situ hanya berisi bawaan.
- **Kategori buatan user juga bisa diaktifkan/nonaktifkan per kategori** (checkbox *aktif* di view Kategori). Nonaktif = disembunyikan dari semua pemilih kategori, bookmark yang memakainya **tetap utuh** — aman untuk menyembunyikan kategori sementara tanpa menghapus apa pun.

## Panel cepat di halaman web

- Saat browsing, FAB `+` muncul di pojok kanan bawah setiap situs http/https — klik untuk membuka form tambah bookmark (URL & judul halaman terisi otomatis).
- Bisa digeser (drag lingkarannya); posisi per-tab disimpan selama sesi tab.
- Kategori otomatis dipakai bila pilihan "(otomatis)" — classifier yang sama dengan popup.
- Form panel web **identik dengan panel cepat manager**: URL, judul, kategori (mengikuti profil terpilih + shared, grup Bawaan/Kategori saya), profil, flag, dan **Posisi** (Diam di pojok / Bebas digeser).
- Pilih kategori lewat **dropdown ber-cari**: ketik untuk menyaring, daftar ter-scroll di dalam — tidak memanjang walau kategori banyak. `Esc` menutup daftar tanpa menutup panel, `Enter` memilih kecocokan pertama, klik di luar menutup daftar.
- Ganti Posisi di panel web, Pengaturan, atau manager — ketiganya menyimpan setting yang sama dan saling mengikuti tanpa reload; posisi FAB tersimpan global (dipakai bersama).
- On/off: **Pengaturan → Panel cepat → Di halaman web**. Perubahan berlaku tanpa reload di tab yang sudah terbuka.
- Tidak muncul di halaman internal browser (`chrome://`, `edge://`, toko web) — memang sengaja.

## Duplikat

Jika URL sudah pernah disimpan, popup menampilkan banner **"Sudah ada di bookmark"** dengan pilihan **Timpa metadata** atau simpan tetap. Normalisasi URL membuang `utm_*`, fragment, dan trailing slash — duplikat dengan parameter tracking tetap terdeteksi.

## Cari bookmark

- Popup, side panel, dan halaman manager memakai engine fuzzy yang sama: ketik sebagian (mis. `gh prf` menemukan "GitHub Profile").
- Keyboard: `↑`/`↓` pilih, `Enter` buka di tab aktif, `Ctrl+Enter` tab baru.
- Dari address bar: ketik `qm <query>` → saran muncul di dropdown; `↓` memilih, `Enter` membuka.
- Filter cepat: chip **Favorit** dan **Baca nanti**; di side panel ada chip kategori dengan jumlah.

## Kategori

- Saat save: saran kategori otomatis dari rule-based (learning per domain → domain mapping → keyword). Koreksi yang kamu pilih **dipelajari** — domain yang sama berikutnya langsung disarankan kategori pilihanmu.
- Kelola kategori di **Kelola → Kategori**: tambah (nama + warna + milik profil atau shared), **Edit** membuka modal penuh (nama + warna + milik), hapus (bookmark di dalamnya aman — jadi "tanpa kategori").
- Kategori milik profil hanya muncul di profil itu; kategori shared muncul di semua profil. Pemilih kategori (panel cepat manager, edit modal) mengikuti profil yang sedang dipilih.
- Semua pemilih kategori — panel cepat manager & web, modal edit, bulk bar "Pindah kategori", filter tabel Bookmark — berupa **dropdown ber-cari**: kotak pencarian menyaring nama kategori, daftar ter-scroll di dalam (tidak memanjang walau kategori bertambah).
- View **Kelola → Kategori** dikelompokkan per profil: baris **profil jadi parent** — klik untuk membuka/menutup daftar kategori di dalamnya, plus grup **Shared (semua profil)** paling atas. Di atasnya ada filter: cari nama kategori + pilih profil; saat filter aktif semua grup hasil terbuka otomatis.
- Tombol **Buka semua / Tutup semua** di kartu filter membuka atau menutup seluruh grup sekaligus. Status buka-tutup tersimpan di storage — refresh halaman tetap ingat.
- Dataset bawaan (Dev, Belanja, Berita, dll.) bisa dimatikan per kategori di **Pengaturan**.
- Checkbox *aktif* per kategori buatan di view Kategori: **nonaktif** hanya menyembunyikan kategori dari semua pemilih (popup, panel, panel cepat web, dropdown manager) — bookmark yang memakainya tetap ada dan tetap berlabel. Edit modal bookmark yang memakai kategori nonaktif tetap menampilkannya (tanda *nonaktif*) supaya kategori tidak terlepas saat disimpan.

## Tampilan Bookmark (Kelola → Bookmark)

- Dua tampilan, pilih lewat dropdown **Tampilan** di toolbar: **Tabel** (bawaan — kolom lengkap, pilih-banyak + bulk action) dan **Hierarki** — 3 level: **profil → kategori → bookmark** (dua tingkat parent, klik untuk membuka/menutup; bookmark tanpa kategori masuk grup "(tanpa kategori)"; chip kategori tetap tampil di tiap baris bookmark; tanpa bulk selection, tiap baris ada tombol **Buka** & **Edit**).
- Filter profil, kategori, pencarian, dan flag tetap bekerja di kedua tampilan; saat filter aktif semua grup terbuka otomatis.
- Di tampilan Hierarki ada tombol **Buka semua / Tutup semua** di toolbar. Status buka-tutup (profil & kategori) tersimpan di storage — refresh halaman tetap ingat.
- Pilihan tersimpan di storage — refresh halaman tidak kembali ke default. Tampilan awal juga bisa diatur dari **Pengaturan → Umum → Tampilan Bookmark**.

## Profil (work / personal)

- Ganti profil: dropdown kanan-atas popup / side panel — 1 klik.
- Profil aktif **per jendela browser**: jendela kerja bisa di profil "Kantor", jendela pribadi di "Pribadi".
- Kelola di **Kelola → Profil**: tambah, rename, warna aksen, hapus (diblokir selama profil masih berisi bookmark), kunci/sembunyikan (lihat [Profil terkunci](#profil-terkunci-privasi)).
- Bookmark penting lintas konteks: edit bookmark → flag `shared` via kategori shared.

## Baca nanti & Favorit

- Flag dari popup saat save, tombol di panel, atau checkbox di manager.
- Bookmark read-later yang dibuka lewat QuickMark > 3 kali mendapat saran "tandai selesai" (mematikan flag).

## Profil terkunci (privasi)

Sembunyikan profil beserta seluruh bookmark-nya dari semua permukaan — popup, side panel, panel cepat di halaman web, manager, statistik, dan omnibox `qm` — sampai dibuka dengan password.

- **Atur password** (sekali): **Kelola → Pengaturan → card Privasi** — set password (min 4 karakter). Satu password global untuk semua profil terkunci.
- **Kunci profil**: **Kelola → Profil** → tombol **Kunci** di baris profil (butuh password sudah diatur; minimal satu profil harus tetap terlihat).
- **Buka kunci**: baris "N profil terkunci — Buka kunci" di bawah header popup / side panel, atau tombol **Buka kunci** di view Profil manager → masukkan password.
- **Durasi tampil**: Pengaturan → Privasi → *Durasi tampil* — 1/5/15/30/60 menit (default 15), *Sampai browser ditutup*, atau *Tampil terus sampai dikunci manual*. Tombol **Kunci sekarang** menyembunyikan lagi seketika. Browser restart selalu mengunci ulang.
- **Salah password 5x** beruntun = cooldown 30 detik.
- **Ganti / hapus password**: card Privasi. Hapus password (wajib tahu password lama) juga melepas semua status terkunci.
- **Backup & export data terkunci** — jalur TERPISAH:
  - Backup lokal (otomatis/manual), Google Drive, Export JSON/HTML biasa **tidak pernah memuat** data profil terkunci — file-nya aman dibagikan.
  - Satu-satunya cadangan: **Kelola → Data & Backup → card Backup lokal → Export terenkripsi** — file `YYYYMMDD-HHmmss-<nama>-private.json` terenkripsi AES-256 (terproteksi password; tanpa password isinya tidak terbaca).
  - Pulihkan: Import → Dari file JSON → pilih file `-private.json` → masukkan password → hanya data terkunci yang diganti (data lain tidak tersentuh).
- **Lupa password = data terkunci tidak bisa dibuka.** Tidak ada reset. Pastikan menyimpan file terenkripsi + password-nya.
- Batas jujur: ini privasi "soft" — data masih tersimpan di IndexedDB browser (bisa dilihat via DevTools oleh yang menguasai perangkat). Password menghalangi tampilan & jalur export normal, bukan enkripsi database penuh.

## Import / Export / Dedup / Backup (Kelola → Data & Backup)

- **Import**: file **JSON QuickMark** berisi SEMUA profil, kategori & bookmark — dipulihkan langsung tanpa memilih profil (konfirmasi timpa 2-klik karena menggantikan data). File **HTML Netscape** / bookmark **native browser** bersifat per-profil: di barisan itulah profil tujuan + mode (lewatkan duplikat / masukkan semua) dipakai. Folder native dijadikan saran kategori.
- **Export**: JSON lengkap (round-trip aman) atau HTML Netscape (kompatibel semua browser). Nama file unduhan mengikuti pengaturan penamaan backup — format `YYYYMMDD-HHmmss-<nama>.json` / `.html`. Data profil terkunci TIDAK ikut (jalurnya: **Export terenkripsi** — lihat [Profil terkunci](#profil-terkunci-privasi)); restore/import file biasa menghapus profil terkunci yang ada (ada peringatan di konfirmasi).
- **Dedup**: Scan dulu (laporan jumlah grup), lalu Auto-dedup (survivor = yang paling sering dibuka).
- **Backup lokal** (card pertama): otomatis harian; tombol **Backup sekarang** untuk manual; tiap snapshot ada **Restore** (menimpa seluruh data, konfirmasi 2-klik) dan **Hapus** (konfirmasi 2-klik); tombol **Hapus semua** membersihkan seluruh snapshot lokal (konfirmasi 2-klik). Snapshot lokal memakai nama format yang sama dengan file Drive — daftar lokal & Drive tampil seragam, dan mode/jumlahnya mengikuti pengaturan backup yang sama (saling sinkron).
- **Google Drive** (card kedua, terpisah dari Backup lokal):
  - **Hubungkan Google Drive** — login akun Google + setujui scope `drive.file` (app hanya melihat file buatannya sendiri). Di Edge jalur login otomatis jatuh ke popup web (refresh token disimpan lokal). Setup client ID sekali saja: **docs/SETUP-DRIVE.md**.
  - **Backup ke Drive** — kirim snapshot penuh ke folder "QuickMark Pro Backup" di Drive; rotasi/mode memakai pengaturan yang sama dengan backup lokal (saling sinkron).
  - **Auto harian** — centang agar alarm backup harian ikut mengirim ke Drive; kegagalan jaringan tidak membatalkan backup lokal.
  - **Daftar file Drive** — Muat daftar → per file ada **Restore** (menimpa semua data, konfirmasi 2-klik) dan **Hapus** (konfirmasi 2-klik); tombol **Hapus semua** membersihkan seluruh file backup di Drive (konfirmasi 2-klik).
  - **Putuskan** — hapus refresh token lokal + revoke akses di Google; akses juga bisa dicabut dari [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
  - **Mode penyimpanan**: *File baru* (tiap backup membuat file ber-timestamp — ada riwayat) atau *File tunggal* (1 file, diganti tiap backup; nama selalu mencerminkan backup terakhir).
  - **Nama file**: bagian bebas yang bisa diedit; format lengkap `YYYYMMDD-HHmmss-<nama>.json` (urutan alfabetik = urutan waktu). Contoh langsung terlihat di card.
  - **Sisakan file**: N backup terbaru yang dipertahankan (default 5) — hanya berlaku mode *File baru*; mengatur rotasi lokal & Drive sekaligus.

## Statistik & Pengaturan

- **Kelola → Statistik**: total, per kategori (bar), 10 terbaru, 10 paling dibuka — dihitung on-demand.
- **Kelola → Pengaturan**: tema (Dark/Light/System), profil default, mode favicon (cache lokal default / online / ikon huruf), mirror ke bookmark native (off default), dataset kategori on/off, privasi/password profil terkunci, hapus semua data.

## Shortcut

| Aksi | Default |
|---|---|
| Buka popup | `Ctrl+Shift+K` |
| Quick-save halaman aktif | `Ctrl+Shift+S` |
| Cari dari address bar | `qm <query>` |

Ubah di `chrome://extensions/shortcuts` (Edge: `edge://extensions/shortcuts`).
