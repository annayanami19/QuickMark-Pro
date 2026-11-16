// io.js — import native/HTML Netscape/JSON, export, dedup, backup rotasi (PRD §3.6).
import * as db from './db.js';
import { normalizeUrl, findDuplicateGroups, pickSurvivor } from './dedup.js';
import { classify, recordDecision } from './categorizer.js';
import { getSettings } from './settings.js';

// ---------- Import dari bookmark native (chrome.bookmarks.getTree) ----------
// Folder native dijadikan saran kategori via classifier (folder → "title").
export async function importNative(profileId, mode) {
  const tree = await chrome.bookmarks.getTree();
  const items = [];
  flatten(tree, '', items);
  const result = await importItems(items, profileId, mode);
  return result;
}

function flatten(nodes, path, out) {
  for (const n of nodes || []) {
    if (n.url) {
      out.push({ url: n.url, title: n.title || '', folder: path });
    } else if (n.children) {
      const label = n.title && n.title !== 'Bookmarks Bar' && n.title !== 'Other bookmarks' ? n.title : '';
      flatten(n.children, path ? path + ' / ' + label : label, out);
    }
  }
}

// ---------- Import file HTML Netscape ----------
// Format ekspor standar semua browser. Folder <H3> dijadikan saran kategori.
export function parseNetscapeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items = [];
  const walk = (node, path) => {
    for (const child of node.children || []) {
      if (child.tagName === 'DT') {
        const h3 = child.querySelector(':scope > h3');
        const a = child.querySelector(':scope > a');
        if (a && a.getAttribute('href')) {
          items.push({ url: a.getAttribute('href'), title: a.textContent || '', folder: path });
        }
        if (h3) {
          walk(child.querySelector(':scope > dl') || child, path ? path + ' / ' + h3.textContent : h3.textContent);
        }
      } else if (child.tagName === 'DL') {
        walk(child, path);
      }
    }
  };
  walk(doc.body.querySelector('dl') || doc.body, '');
  return items;
}

// ---------- Import JSON QuickMark Pro ----------
// Struktur sama dengan exportJSON (round-trip aman).
export function parseQuickmarkJson(text) {
  const data = JSON.parse(text);
  if (!data || data.app !== 'quickmark-pro' || !Array.isArray(data.bookmarks)) {
    throw new Error('File JSON bukan format QuickMark Pro.');
  }
  return data;
}

// ---------- Mesin import umum ----------
// items: [{url, title, folder}] — kategorikan via classifier (folder → judul hay tambahan).
// mode: 'dedup' (lewatkan duplikat, default) | 'keep' (masukkan semua — dedup manual belakangan).
export async function importItems(items, profileId, mode) {
  const cats = await db.listCategories(profileId);
  const learningEntries = await db.listLearning(profileId);
  const result = { added: 0, skipped: 0, invalid: 0 };
  for (const it of items) {
    const url = normalizeUrl(it.url);
    if (!url) { result.invalid++; continue; }
    if (mode !== 'keep') {
      const dup = await db.findDuplicateOf(url);
      if (dup) { result.skipped++; continue; }
    }
    const saran = classify(url, (it.title || '') + ' ' + (it.folder || ''), learningMapOf(learningEntries));
    const bm = {
      id: crypto.randomUUID(),
      profileId,
      url,
      urlRaw: it.url,
      title: it.title || hostOf(it.url),
      note: '',
      categoryId: saran.categoryId,
      flags: { favorite: false, readLater: false },
      openCount: 0,
      lastOpened: null,
      createdAt: Date.now(),
      shared: false
    };
    const r = await db.addBookmark(bm);
    if (r.ok) result.added++; else result.skipped++;
  }
  return result;
}

function learningMapOf(entries) {
  const m = new Map();
  for (const e of entries || []) m.set(e.domain, e.categoryId);
  return m;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

// ---------- Export ----------
// JSON lengkap: profiles + categories + bookmarks + learning (round-trip).
export async function exportJSON() {
  const [profiles, categories, bookmarks, learning] = await Promise.all([
    db.getAll('profiles'), db.getAll('categories'), db.getAll('bookmarks'), db.getAll('learning')
  ]);
  return JSON.stringify({
    app: 'quickmark-pro',
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles, categories, bookmarks, learning
  }, null, 2);
}

// HTML Netscape (kompatibel semua browser).
export function bookmarksToNetscape(profiles, bookmarks, categoriesById) {
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = [];
  lines.push('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
  lines.push('<!-- Exported by QuickMark Pro -->');
  lines.push('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">');
  lines.push('<TITLE>Bookmarks</TITLE>');
  lines.push('<H1>Bookmarks</H1>');
  lines.push('<DL><p>');
  for (const p of profiles) {
    const bms = bookmarks.filter((b) => b.profileId === p.id);
    lines.push('    <DT><H3>' + esc(p.name) + '</H3>');
    lines.push('    <DL><p>');
    for (const b of bms) {
      const cat = b.categoryId ? categoriesById.get(b.categoryId) : null;
      lines.push('        <DT><A HREF="' + esc(b.urlRaw || b.url) + '"' +
        (cat ? ' TAGS="' + esc(cat.name) + '"' : '') + '>' + esc(b.title) + '</A>');
      if (b.note) lines.push('        <DD>' + esc(b.note));
    }
    lines.push('    </DL><p>');
  }
  lines.push('</DL><p>');
  return lines.join('\n');
}

// ---------- Dedup mandiri (Pengaturan) ----------
// mode: 'auto' (survivor dipertahankan, sisanya dihapus) | 'report' (kembalikan grup untuk review).
export async function runDedup(mode) {
  const all = await db.getAll('bookmarks');
  const groups = findDuplicateGroups(all);
  if (mode === 'report') return groups;
  let removed = 0;
  for (const g of groups) {
    const survivor = pickSurvivor(g);
    for (const bm of g) {
      if (bm.id !== survivor.id) {
        await db.remove('bookmarks', bm.id);
        removed++;
      }
    }
  }
  return { groups: groups.length, removed };
}

// ---------- Nama file backup Drive ----------
// Format: <YYYYMMDD>-<HHmmss>-<nama-bebas>.json — date-time = waktu backup berjalan,
// zero-padded agar urutan alfabetik di Drive = urutan waktu (mudah melihat backup terakhir).
// Waktu lokal perangkat. Nama bebas disanitasi dari karakter bermasalah untuk file/URL Drive.
export function sanitizeBackupName(raw) {
  const cleaned = String(raw || '')
    .replace(/[\\/:*?"<>|#%&{}$!'`+=@\[\]]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'quickmark-backup';
}

export function backupFileName(nameBase, now, ext) {
  const d = now instanceof Date ? now : new Date(now || Date.now());
  const p2 = (n) => String(n).padStart(2, '0');
  const date = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate());
  const time = p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  return date + '-' + time + '-' + sanitizeBackupName(nameBase) + (ext || '.json');
}

// ---------- Backup otomatis (chrome.storage.local — penamaan & rotasi SINKRON dengan Drive) ----------
// Key snapshot memakai format yang sama dengan nama file Drive (backupFileName):
// qmBackup:<YYYYMMDD>-<HHmmss>-<nama>.json — daftar lokal & Drive tampil dan berperilaku sama.
// Mode & jumlah (backupMode/backupKeep) dibaca dari setting yang sama; mode single = tersisa 1 snapshot.
const BACKUP_PREFIX = 'qmBackup:';

export async function createBackup() {
  const [json, s] = await Promise.all([exportJSON(), getSettings()]);
  const key = BACKUP_PREFIX + backupFileName(s.backupName);
  await chrome.storage.local.set({ [key]: json });
  await rotateBackups();
  return key;
}

export async function listBackups() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith(BACKUP_PREFIX))
    .sort()
    .reverse();
}

async function rotateBackups() {
  const s = await getSettings();
  const keep = s.backupMode === 'single'
    ? 1 // file tunggal: selalu sisa 1 — snapshot lama dihapus
    : Math.max(1, Math.min(50, parseInt(s.backupKeep, 10) || 5));
  const keys = await listBackups();
  const excess = keys.slice(keep);
  if (excess.length) await chrome.storage.local.remove(excess);
}

// Restore snapshot: baca JSON, bersihkan store data, tulis ulang.
// CATATAN: operasi destruktif — hanya dipanggil dari Pengaturan dengan konfirmasi 2-klik.
export async function restoreBackup(key) {
  const out = await chrome.storage.local.get(key);
  const json = out[key];
  if (!json) throw new Error('Backup tidak ditemukan: ' + key);
  return applyImportJson(json);
}

export async function applyImportJson(json) {
  const data = typeof json === 'string' ? parseQuickmarkJson(json) : json;
  await Promise.all([
    db.clearStore('profiles'), db.clearStore('categories'),
    db.clearStore('bookmarks'), db.clearStore('learning')
  ]);
  await db.bulkPut('profiles', data.profiles || []);
  await db.bulkPut('categories', data.categories || []);
  await db.bulkPut('bookmarks', data.bookmarks || []);
  await db.bulkPut('learning', data.learning || []);
  return { profiles: data.profiles.length, bookmarks: data.bookmarks.length };
}
