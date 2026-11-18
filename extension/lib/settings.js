// settings.js — setting persisten kecil via chrome.storage.sync (jaga < 8 KB — PRD §4.3).
// Semua permukaan membaca lewat sini; auto-save tanpa tombol (PRD §3.9).
// Tiap save memancarkan 'settings-changed' via BroadcastChannel — permukaan lain reaksi live
// (pola resmi: storage.onChanged untuk lintas context, broadcast untuk halaman extension).
import { broadcast } from './ui.js';

export const DEFAULT_SETTINGS = {
  theme: 'dark',                    // dark | light | system
  defaultProfileId: null,           // null = profil isDefault
  newWindowProfile: 'default',      // default | inherit
  datasetEnabled: {},               // { [builtinId]: true|false } — default semua aktif
  faviconMode: 'cache',             // cache | online | letter
  mirrorNative: false,
  backupIntervalHours: 24,
  backupMax: 5,
  quickPanelMode: 'corner',         // corner (diam kanan bawah) | free (bebas digeser)
  quickPanelSide: 'br',             // pojok saat mode corner: br (default)
  quickPanelSites: true,            // tampilkan panel cepat (FAB) di halaman web via content script
  bookmarkView: 'table',            // tampilan daftar Bookmark manager: table (bawaan) | tree (hierarki)
  backupMode: 'multi',              // penyimpanan backup LOKAL & DRIVE (saling sinkron): multi (file baru ber-timestamp) | single (1 file, diganti tiap backup)
  backupName: 'quickmark-backup',   // bagian nama bebas pada nama file/key backup — dipakai lokal & Drive
  backupKeep: 5,                    // sisakan N backup terbaru — rotasi lokal & Drive, hanya berlaku mode multi
  backupToDrive: false,             // alarm harian ikut mengirim backup ke Drive (butuh koneksi aktif)
  lockAutoMin: 15                   // durasi profil terkunci tampil setelah unlock: menit (1/5/15/30/60) | 'browser' (sampai browser tutup) | 'manual' (tampil terus sampai dikunci)
};

const KEY = 'settings';

export async function getSettings() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
    return { ...DEFAULT_SETTINGS };
  }
  const out = await chrome.storage.sync.get(KEY);
  return Object.assign({}, DEFAULT_SETTINGS, out[KEY] || {});
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const merged = Object.assign({}, cur, patch);
  await chrome.storage.sync.set({ [KEY]: merged });
  broadcast('settings-changed');
  return merged;
}

export async function onSettingsChanged(fn) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return () => {};
  const listener = (changes, area) => {
    if (area === 'sync' && changes[KEY]) fn(changes[KEY].newValue || {});
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// Terapkan tema ke dokumen (dark/light/system) — dipakai semua permukaan.
export function applyTheme(theme) {
  let t = theme || 'dark';
  if (t === 'system') {
    t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  document.documentElement.dataset.theme = t;
}
