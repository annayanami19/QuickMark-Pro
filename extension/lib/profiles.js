// profiles.js — CRUD profil + profil aktif per jendela (chrome.storage.session per windowId).
import * as db from './db.js';
import { broadcast } from './ui.js';
import { isUnlocked } from './lock.js';

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

// Profil terlihat = tidak terkunci, atau terkunci tapi sedang di-unlock (lock.js).
// SATU PINTU penyaringan — semua permukaan (popup/panel/manager/panel web/omnibox) wajib pakai ini.
export async function listVisibleProfiles() {
  const all = await listProfiles();
  if (await isUnlocked()) return all;
  return all.filter((p) => !p.locked);
}

// Filter bookmark milik profil terkunci saat belum di-unlock — dipakai omnibox, manager,
// dan export HTML (satu pintu; data terkunci tidak boleh bocor ke hasil mana pun).
export async function filterVisibleBookmarks(bookmarks) {
  if (await isUnlocked()) return bookmarks;
  const locked = new Set((await db.getAll('profiles')).filter((p) => p.locked).map((p) => p.id));
  if (!locked.size) return bookmarks;
  return bookmarks.filter((b) => !locked.has(b.profileId));
}

// Guard mengunci: minimal satu profil harus tetap terlihat saat semua terkunci.
export async function assertCanLock(profileId) {
  const all = await listProfiles();
  const othersVisible = all.filter((p) => p.id !== profileId && !p.locked);
  if (!othersVisible.length) {
    const err = new Error('Minimal satu profil harus tetap terlihat — tidak bisa mengunci profil terakhir.');
    err.code = 'LAST_VISIBLE';
    throw err;
  }
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
// Profil aktif yang terkunci & belum di-unlock TIDAK diresolve — fallback ke default/profil terlihat.
export async function resolveActiveProfile(windowId) {
  await ensureProfiles();
  const visible = await listVisibleProfiles();
  const activeId = await getActiveProfileId(windowId);
  if (activeId) {
    const p = visible.find((x) => x.id === activeId);
    if (p) return p;
  }
  return visible.find((p) => p.isDefault) || visible[0];
}
