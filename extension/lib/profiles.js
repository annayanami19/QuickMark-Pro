// profiles.js — CRUD profil + profil aktif per jendela (chrome.storage.session per windowId).
import * as db from './db.js';
import { broadcast } from './ui.js';

export const DEFAULT_PROFILE_ID = 'pribadi';
export const DEFAULT_PROFILE = { id: 'pribadi', name: 'Pribadi', color: '#5eead4', isDefault: true };

export async function ensureProfiles() {
  const all = await db.getAll('profiles');
  if (all.length === 0) {
    await db.put('profiles', { ...DEFAULT_PROFILE });
    return [{ ...DEFAULT_PROFILE }];
  }
  return all;
}

export async function listProfiles() {
  const all = await db.getAll('profiles');
  return all.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.name.localeCompare(b.name));
}

export async function getProfile(id) {
  return db.get('profiles', id);
}

export async function createProfile(name, color) {
  const id = 'prof_' + crypto.randomUUID().slice(0, 8);
  const p = { id, name: name.trim(), color: color || '#60a5fa', isDefault: false };
  await db.put('profiles', p);
  broadcast('profiles-changed');
  return p;
}

export async function updateProfile(p) {
  await db.put('profiles', p);
  broadcast('profiles-changed');
  return p;
}

// Hapus profil: diblokir bila masih ada bookmark di dalamnya (PRD §3.4).
export async function deleteProfile(id) {
  const n = await db.countBookmarks(id);
  if (n > 0) {
    const err = new Error('Profil masih memiliki ' + n + ' bookmark. Pindahkan atau hapus dulu.');
    err.code = 'PROFILE_NOT_EMPTY';
    throw err;
  }
  await db.remove('profiles', id);
  // Kategori non-shared milik profil ikut terhapus; shared dipertahankan.
  const cats = await db.listAllCategories();
  const doomed = cats.filter((c) => c.profileId === id && !c.shared);
  for (const c of doomed) await db.remove('categories', c.id);
  await db.deleteLearningForProfile(id);
  broadcast('profiles-changed');
}

// Profil aktif per jendela — simpan di chrome.storage.session (hilang saat browser tutup,
// jendela baru mewarisi profil default sesuai PRD §3.4).
const WIN_KEY_PREFIX = 'qmActiveProfile:win:';

export async function getActiveProfileId(windowId) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    const out = await chrome.storage.session.get(WIN_KEY_PREFIX + windowId);
    return out[WIN_KEY_PREFIX + windowId] || null;
  }
  return null;
}

export async function setActiveProfileId(windowId, profileId) {
  if (typeof chrome !== 'undefined' && chrome.storage.session) {
    await chrome.storage.session.set({ [WIN_KEY_PREFIX + windowId]: profileId });
    broadcast('profiles-changed');
  }
}

// Profil aktif (fallback: default) — helper satu pintu untuk semua permukaan.
export async function resolveActiveProfile(windowId) {
  await ensureProfiles();
  const activeId = await getActiveProfileId(windowId);
  if (activeId) {
    const p = await getProfile(activeId);
    if (p) return p;
  }
  const all = await listProfiles();
  return all.find((p) => p.isDefault) || all[0];
}
