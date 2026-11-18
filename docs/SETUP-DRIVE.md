# Setup Google Drive (Backup Cloud)

> **STATUS: FITUR DINONAKTIFKAN SEMENTARA.** Card Google Drive tidak dirender, `lib/drive.js` tidak dimuat, dan `manifest.json` tidak lagi memuat permission `identity`, `host_permissions` googleapis, maupun blok `oauth2`. Dokumen ini tetap disimpan sebagai panduan saat fitur dihidupkan kembali.

Untuk menghidupkan kembali:
1. `extension/lib/drive.js` → `export const DRIVE_ENABLED = true;`
2. `extension/manager/manager.js` → `const DRIVE_ENABLED = true;`
3. `extension/manifest.json` → tambahkan kembali di `permissions`: `"identity"`; tambahkan `"host_permissions": ["https://www.googleapis.com/*"]`; tambahkan blok `"oauth2": { "client_id": "...", "scopes": ["https://www.googleapis.com/auth/drive.file"] }`.
4. Reload extension, lalu ikuti langkah setup client ID di bawah.

Fitur backup ke Google Drive butuh **OAuth client ID** milikmu sendiri — sekali setup, gratis. Ikuti langkah ini:

## 1. Buat project di Google Cloud Console

1. Buka [console.cloud.google.com](https://console.cloud.google.com) → pilih/buat project (nama bebas, mis. "QuickMark Pro").
2. Menu **APIs & Services → Library** → cari **"Google Drive API"** → **Enable**.
3. Daftarkan aplikasi (2025: menu **OAuth consent screen** lama pindah ke **Google Auth Platform**):
   - Buka [console.developers.google.com/auth/clients](https://console.developers.google.com/auth/clients) atau ketik `Google Auth Platform` di search bar atas konsol.
   - Registrasi dulu bila diminta: user type **External** (gratis, user mana pun), App name "QuickMark Pro", email support & developer.
   - Halaman **Audience** → **Test users** → tambahkan alamat Gmail milikmu (wajib selama status aplikasi "Testing" — akun lain akan diblokir Google).
   - Halaman **Data access** → *Add scope* → tambahkan `https://www.googleapis.com/auth/drive.file` (opsional di mode Testing, scope dikirim runtime).
4. Halaman **Clients** → tombol **CREATE CLIENT**:
   - Application type: **Chrome Extension**.
   - **Item ID / Application ID**: isi extension ID milikmu.

## 2. Tahu extension ID-mu

- **Saat development (unpacked)**: buka `chrome://extensions` (Edge: `edge://extensions`, aktifkan Developer mode) → salin **ID** di kartu extension.
- **Saat dipublikasi ke Chrome Web Store / Edge Add-ons**: ID ditetapkan store dan **berubah** dari ID dev. Solusi agar ID stabil: tambahkan field `key` di manifest (isi public key proyek) — lihat [docs Chrome](https://developer.chrome.com/docs/extensions/how-to/distribute/host-an-extension#manifest-key) atau generate: `openssl genrsa 2048 | openssl rsa -pubout -outform DER | openssl base64` → ID dihitung dari key ini.

## 3. Isi client ID ke manifest

Edit `extension/manifest.json`:

```json
"oauth2": {
  "client_id": "<NAMA-PROJECT>.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/drive.file"]
}
```

Ganti `YOUR_CLIENT_ID.apps.googleusercontent.com` dengan client ID asli, **reload extension**.

## 4. Coba

Kelola → Data & Backup → card **Google Drive** → **Hubungkan Google Drive** → login + setujui scope `drive.file` → status "Terhubung" → **Backup ke Drive**.

## Catatan penting

- **Chrome**: `chrome.identity.getAuthToken` — prompt consent muncul otomatis, token dikelola browser.
- **Edge/Brave**: `getAuthToken` tidak berjalan di sana; QuickMark otomatis jatuh ke `launchWebAuthFlow` (popup Google login, refresh token disimpan di `chrome.storage.local`, key `qmDriveTokens`).
- **Privasi**: data hanya dikirim ke **akun Drive milikmu sendiri** (scope `drive.file` — app hanya melihat file buatannya sendiri), tanpa server perantara. Cabut akses kapan pun: tombol **Putuskan** (revoke token) atau [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- **Verifikasi Google**: untuk distribusi ≤100 user, status "Testing" sudah cukup (ada warning layar consent). Verifikasi penuh (privacy policy + video demo) gratis, hanya perlu waktu — jalankan saat mau publikasi luas.
- **Biaya**: gratis — GCP project, Drive API, OAuth, kuota 15 GB (file backup ~2–5 MB per 10 ribu bookmark).
