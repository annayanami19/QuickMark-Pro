// drive.js — backup ke Google Drive (chrome.identity OAuth2 + Drive v3 REST).
// Privasi: data HANYA dikirim ke akun Drive milik user sendiri, scope minimum
// drive.file (app hanya melihat file yang ia buat sendiri), opt-in via tombol Hubungkan.
// Jalur token: (1) refresh_token tersimpan (jalur Edge), (2) chrome.identity.getAuthToken
// (Chrome — cache & refresh ditangani browser), (3) chrome.identity.launchWebAuthFlow
// (Edge/Brave — getAuthToken tak berjalan di sana; refresh token disimpan storage.local).
// Setup client ID: lihat docs/SETUP-DRIVE.md.
import { getSettings } from './settings.js';
import { exportJSON, applyImportJson, backupFileName, cloudKeep } from './io.js';

// Sakelar fitur: false = card Google Drive dirender nonaktif & auto-backup harian
// dilewati. Semua kode Drive tetap utuh — cukup ubah ke true untuk menghidupkan lagi.
export const DRIVE_ENABLED = false;

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'QuickMark Pro Backup';
const APP_PROP_QUERY = "appProperties has { key='app' and value='quickmark-pro' }";
const TOKENS_KEY = 'qmDriveTokens';

// ---------- Konfigurasi ----------
export function isConfigured() {
  return !!manifestClientId();
}

function manifestClientId() {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getManifest) return null;
  const m = chrome.runtime.getManifest();
  const id = m && m.oauth2 && m.oauth2.client_id;
  return id && !/^YOUR_/.test(id) ? id : null; // placeholder berarti belum di-setup
}

// ---------- Token ----------
function storedTokens() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(TOKENS_KEY, (out) => { void chrome.runtime.lastError; resolve((out && out[TOKENS_KEY]) || null); });
    } catch (e) { resolve(null); }
  });
}
function saveTokens(t) {
  return new Promise((resolve) => {
    try { chrome.storage.local.set({ [TOKENS_KEY]: t }, () => { void chrome.runtime.lastError; resolve(); }); }
    catch (e) { resolve(); }
  });
}

export async function getToken(interactive) {
  const cid = manifestClientId();
  if (!cid) throw new Error('OAuth client ID belum diisi di manifest.json — lihat docs/SETUP-DRIVE.md');
  // 1) Refresh token tersimpan (hasil launchWebAuthFlow sebelumnya — jalur Edge).
  const cached = await storedTokens();
  if (cached && cached.refresh_token) {
    if (cached.access_token && cached.expires_at > Date.now() + 60000) return cached.access_token;
    const fresh = await refreshAccessToken(cid, cached.refresh_token);
    await saveTokens({ ...cached, ...fresh });
    return fresh.access_token;
  }
  // 2) getAuthToken (Chrome) — token cache & refresh ditangani browser.
  if (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.getAuthToken) {
    try {
      const res = await chrome.identity.getAuthToken({ interactive: !!interactive, scopes: [SCOPE] });
      if (res && res.token) return res.token;
    } catch (e) { /* Edge/Brave: lanjut ke web auth flow */ }
  }
  // 3) launchWebAuthFlow (Edge/Brave) — minta authorization code, tukar refresh+access token.
  if (typeof chrome === 'undefined' || !chrome.identity || !chrome.identity.launchWebAuthFlow) {
    throw new Error('chrome.identity tidak tersedia di browser ini');
  }
  if (!interactive) throw new Error('Belum terhubung');
  const redirect = chrome.identity.getRedirectURL('/');
  const url = 'https://accounts.google.com/o/oauth2/v2/auth' +
    '?client_id=' + encodeURIComponent(cid) +
    '&response_type=code' +
    '&scope=' + encodeURIComponent(SCOPE) +
    '&redirect_uri=' + encodeURIComponent(redirect) +
    '&access_type=offline' +
    '&prompt=consent';
  const resUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  if (!resUrl) throw new Error('Autentikasi dibatalkan');
  const code = new URL(resUrl).searchParams.get('code');
  if (!code) throw new Error('Tidak mendapat authorization code');
  const tokens = await tokenExchange(cid, code, redirect);
  await saveTokens(tokens);
  return tokens.access_token;
}

async function tokenExchange(cid, code, redirect) {
  const body = new URLSearchParams({
    code, client_id: cid, redirect_uri: redirect,
    grant_type: 'authorization_code', access_type: 'offline'
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error('Token exchange gagal: ' + res.status);
  const t = await res.json();
  if (!t.access_token) throw new Error('Tidak mendapat access token');
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token || '',
    expires_at: Date.now() + (t.expires_in || 3600) * 1000
  };
}

async function refreshAccessToken(cid, refreshToken) {
  const body = new URLSearchParams({
    refresh_token: refreshToken, client_id: cid, grant_type: 'refresh_token'
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error('Refresh token gagal: ' + res.status);
  const t = await res.json();
  return { access_token: t.access_token, expires_at: Date.now() + (t.expires_in || 3600) * 1000 };
}

// Putuskan: hapus refresh token lokal + cabut token Google (best-effort).
export async function disconnect() {
  await chrome.storage.local.remove(TOKENS_KEY);
  try {
    if (chrome.identity && chrome.identity.getAuthToken) {
      const res = await chrome.identity.getAuthToken({ interactive: false, scopes: [SCOPE] });
      const token = res && res.token;
      if (token) {
        if (chrome.identity.removeCachedAuthToken) {
          await chrome.identity.removeCachedAuthToken({ token });
        }
        await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' });
      }
    }
    if (chrome.identity && chrome.identity.clearAllCachedAuthTokens) {
      await chrome.identity.clearAllCachedAuthTokens();
    }
  } catch (e) { /* token mungkin memang sudah tidak ada */ }
}

// ---------- Drive v3 ----------
async function api(path, opts = {}) {
  const token = await getToken(false);
  const res = await fetch('https://www.googleapis.com/' + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) }
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('Drive API ' + res.status + ': ' + detail.slice(0, 200));
  }
  return res.json();
}

// Folder "QuickMark Pro Backup" — dicari lalu dibuat bila belum ada.
export async function ensureFolderId() {
  const q = "mimeType = 'application/vnd.google-apps.folder' and name = '" + FOLDER_NAME + "' and trashed = false";
  const found = await api('drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)&pageSize=1');
  if (found.files && found.files.length) return found.files[0].id;
  const created = await api('drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { app: 'quickmark-pro' }
    })
  });
  return created.id;
}

// Daftar backup di folder (nama zero-padded → sort nama = urut waktu, terbaru dulu).
export async function listCloudBackups() {
  const folderId = await ensureFolderId();
  const q = "'" + folderId + "' in parents and trashed = false and " + APP_PROP_QUERY;
  const data = await api('drive/v3/files?q=' + encodeURIComponent(q) +
    '&fields=' + encodeURIComponent('files(id,name,size,createdTime)') +
    '&pageSize=100&orderBy=name%20desc');
  return (data.files || []).sort((a, b) => b.name.localeCompare(a.name));
}

// Upload snapshot penuh (exportJSON) — nama dari pengaturan, mode/rotasi dari setting yang sama.
export async function uploadBackup() {
  if (!DRIVE_ENABLED) throw new Error('Fitur Google Drive dinonaktifkan sementara');
  const s = await getSettings();
  const json = await exportJSON();
  const name = backupFileName(s.backupName);
  const folderId = await ensureFolderId();
  const metadata = {
    name,
    parents: [folderId],
    mimeType: 'application/json',
    appProperties: { app: 'quickmark-pro' }
  };
  const boundary = 'qmBk' + Math.random().toString(36).slice(2);
  const body = '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: application/json\r\n\r\n' +
    json + '\r\n' +
    '--' + boundary + '--';
  const created = await api('upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
    body
  });
  // Rotasi: mode single = sisa 1; mode multi = sisakan backupKeep terbaru.
  const files = await listCloudBackups();
  const excess = files.slice(cloudKeep(s));
  for (const f of excess) await api('drive/v3/files/' + f.id, { method: 'DELETE' });
  return { id: created.id, name: created.name, removed: excess.length };
}

export async function deleteCloudBackup(id) {
  await api('drive/v3/files/' + id, { method: 'DELETE' });
}

// Hapus SEMUA file backup di folder app — DESTRUKTIF; UI wajib konfirmasi 2-klik.
export async function deleteAllCloudBackups() {
  const files = await listCloudBackups();
  for (const f of files) await api('drive/v3/files/' + f.id, { method: 'DELETE' });
  return files.length;
}

// Unduh + pulihkan — DESTRUKTIF (menimpa semua data); UI wajib konfirmasi dulu.
export async function restoreCloudBackup(id) {
  const token = await getToken(false);
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media', {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!res.ok) throw new Error('Drive download ' + res.status);
  const text = await res.text();
  return applyImportJson(text);
}
