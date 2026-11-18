// lock.js — profil terkunci: password global (PBKDF2-SHA256) + unlock state per sesi
// + export/import data terkunci terenkripsi (AES-GCM). Lihat docs/USERGUIDE.md "Profil terkunci".
// Privasi "soft": password menghalangi tampilan & jalur export normal — data tetap ada
// di IndexedDB (bisa dilihat via DevTools), bukan enkripsi database penuh.
// Password TIDAK PERNAH disimpan plaintext — hanya salt + hash PBKDF2 di storage.local.
// Unlock state di storage.session: otomatis bersih saat browser ditutup.
import * as db from './db.js';
import { broadcast } from './ui.js';

const LOCK_KEY = 'qmLock';              // storage.local: {salt, hash, iterations} (base64)
const UNLOCK_KEY = 'qmUnlocked';        // storage.session: {mode: 'timer'|'browser'|'manual', until}
const COOLDOWN_KEY = 'qmLockCooldown';  // storage.session: {fails, until}

const ITERATIONS = 150000;              // PBKDF2-SHA256 (OWASP 2023: 600k utk SHA-256, 150k kompromi performa popup)
const SALT_LEN = 16;                    // byte
const IV_LEN = 12;                      // byte (96 bit — standar GCM)
const MAX_FAILS = 5;
const COOLDOWN_MS = 30000;

// ---------- helper storage (guard agar tidak meledak di lingkungan tanpa chrome) ----------
async function getLocal(key) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return null;
  const out = await chrome.storage.local.get(key);
  void chrome.runtime.lastError;
  return out[key] || null;
}
async function getSession(key) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.session) return null;
  const out = await chrome.storage.session.get(key);
  return out[key] || null;
}
async function setSession(obj) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.session) return;
  await chrome.storage.session.set(obj);
}

// ---------- base64 (chunked — aman untuk payload besar) ----------
function b64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
function unb64(str) {
  const bin = atob(str);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

// Perbandingan konstan-waktu (hindari timing leak pada verifikasi hash).
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- password ----------
async function pbkdf2Hash(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, 256);
  return new Uint8Array(bits);
}

export async function hasPassword() {
  return !!(await getLocal(LOCK_KEY));
}

// Set/ganti password. Bila sudah ada password, wajib verifikasi yang lama.
export async function setPassword(newPw, oldPw) {
  const cur = await getLocal(LOCK_KEY);
  if (cur) {
    if (!oldPw) throw new Error('Password lama wajib diisi');
    if (!(await verifyPassword(oldPw, true))) throw new Error('Password lama salah');
  }
  if (!newPw || newPw.length < 4) throw new Error('Password minimal 4 karakter');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const hash = await pbkdf2Hash(newPw, salt, ITERATIONS);
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return true;
  await chrome.storage.local.set({ [LOCK_KEY]: { salt: b64(salt), hash: b64(hash), iterations: ITERATIONS } });
  return true;
}

// Verifikasi password. Bukan untuk ganti password: salah 5x beruntun = cooldown 30 detik.
export async function verifyPassword(pw, skipCooldown) {
  const rec = await getLocal(LOCK_KEY);
  if (!rec) throw new Error('Belum ada password — atur dulu di Pengaturan > Privasi');
  if (!skipCooldown) {
    const cd = await getSession(COOLDOWN_KEY);
    if (cd && cd.until > Date.now()) {
      throw new Error('Terlalu banyak percobaan — coba lagi dalam ' +
        Math.ceil((cd.until - Date.now()) / 1000) + ' detik');
    }
  }
  const hash = await pbkdf2Hash(pw, unb64(rec.salt), rec.iterations);
  const ok = constantTimeEqual(hash, unb64(rec.hash));
  if (!skipCooldown) {
    if (ok) {
      await setSession({ [COOLDOWN_KEY]: { fails: 0 } });
    } else {
      const cd = (await getSession(COOLDOWN_KEY)) || { fails: 0 };
      cd.fails = (cd.fails || 0) + 1;
      if (cd.fails >= MAX_FAILS) { cd.until = Date.now() + COOLDOWN_MS; cd.fails = 0; }
      await setSession({ [COOLDOWN_KEY]: cd });
    }
  }
  return ok;
}

// Hapus password (wajib password benar) — sekaligus melepas flag locked semua profil
// karena fitur kunci tidak bermakna tanpa password.
export async function removePassword(pw) {
  if (!(await verifyPassword(pw, true))) throw new Error('Password salah');
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.remove(LOCK_KEY);
  }
  const all = await db.getAll('profiles');
  let changed = false;
  for (const p of all) {
    if (p.locked) { delete p.locked; await db.put('profiles', p); changed = true; }
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    await chrome.storage.session.remove(UNLOCK_KEY);
  }
  if (changed) broadcast('profiles-changed');
}

// ---------- unlock state (storage.session — hilang saat browser ditutup) ----------
export async function isUnlocked() {
  const u = await getSession(UNLOCK_KEY);
  if (!u || !u.mode) return false;
  if (u.mode === 'manual' || u.mode === 'browser') return true; // manual: sampai dikunci; browser: sampai browser tutup
  return u.until > Date.now();
}

// mode: 'timer' (menit) | 'browser' | 'manual' — nilai dari settings.lockAutoMin.
export async function unlock(lockAutoMin) {
  let mode = 'timer', minutes = 15;
  if (lockAutoMin === 'browser' || lockAutoMin === 'manual') mode = lockAutoMin;
  else if (Number(lockAutoMin) > 0) minutes = Number(lockAutoMin);
  await setSession({ [UNLOCK_KEY]: { mode, until: mode === 'timer' ? Date.now() + minutes * 60000 : 0 } });
  broadcast('profiles-changed'); // semua permukaan me-refresh daftar profil
}

export async function lockNow() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    await chrome.storage.session.remove(UNLOCK_KEY);
  }
  broadcast('profiles-changed');
}

// Ada profil terkunci yang sedang tersembunyi (belum unlock)? — untuk entry point "Buka kunci".
export async function hasHiddenLocked() {
  return (await hiddenLockedCount()) > 0;
}

// Jumlah profil terkunci yang sedang tersembunyi — untuk label "N profil terkunci".
export async function hiddenLockedCount() {
  if (await isUnlocked()) return 0;
  const all = await db.getAll('profiles');
  return all.filter((p) => p.locked).length;
}

// ---------- export terenkripsi (AES-GCM 256 via PBKDF2) ----------
export function isEncryptedFile(obj) {
  return !!(obj && typeof obj === 'object' && obj.qmEnc === 1);
}

async function aesKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptExport(password, dataObj) {
  if (!password || password.length < 4) throw new Error('Password minimal 4 karakter');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await aesKey(password, salt, ITERATIONS);
  const plain = new TextEncoder().encode(JSON.stringify(dataObj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return {
    qmEnc: 1, v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS,
    salt: b64(salt), iv: b64(iv), data: b64(ct)
  };
}

export async function decryptExport(password, fileObj) {
  if (!isEncryptedFile(fileObj)) throw new Error('Bukan file terenkripsi QuickMark');
  const key = await aesKey(password, unb64(fileObj.salt), fileObj.iter || ITERATIONS);
  let pt;
  try {
    pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(fileObj.iv) }, key, unb64(fileObj.data));
  } catch (e) {
    throw new Error('Password salah atau file rusak');
  }
  return JSON.parse(new TextDecoder().decode(pt));
}
