// save.js — alur simpan bersama (dipakai popup & command quick-save di SW).
// Satu pintu agar popup dan shortcut tidak punya dua definisi alur save (PRD §4.5).
import * as db from './db.js';
import { normalizeUrl } from './dedup.js';
import { classify, recordDecision, learningMap } from './categorizer.js';
import { getSettings } from './settings.js';

// Simpan bookmark. opts: { categoryId (null = saran), note, flags, profileId, recordLearning }
// Return: { ok, reason?, bookmark?, suggestion? }
export async function saveBookmark(tab, profileId, opts) {
  const o = opts || {};
  const url = normalizeUrl(tab.url);
  if (!url) return { ok: false, reason: 'invalid-url' };
  const learning = learningMap(await db.listLearning(profileId));
  const saran = classify(url, tab.title || '', learning);
  const categoryId = o.categoryId !== undefined ? o.categoryId : saran.categoryId;
  const bm = {
    id: crypto.randomUUID(),
    profileId,
    url,
    urlRaw: tab.url,
    title: (tab.title || '').trim() || hostOf(url),
    note: o.note || '',
    categoryId,
    flags: o.flags || { favorite: false, readLater: false },
    openCount: 0,
    lastOpened: null,
    createdAt: Date.now(),
    shared: o.shared || false
  };
  const dup = await db.findDuplicateOf(url);
  if (dup && o.overwrite !== true) {
    return { ok: false, reason: 'duplicate', existing: dup, suggestion: saran };
  }
  const r = await db.addBookmark(bm);
  if (!r.ok) return { ok: false, reason: 'duplicate', existing: dup, suggestion: saran };
  if (o.recordLearning !== false && categoryId && o.categoryId !== undefined) {
    await recordDecision(profileId, url, categoryId);
  }
  await mirrorNativeIfEnabled(bm);
  return { ok: true, bookmark: bm, suggestion: saran };
}

// Mirror opsional ke folder native "QuickMark Pro" (setting default off — PRD §3.9).
async function mirrorNativeIfEnabled(bm) {
  const s = await getSettings();
  if (!s.mirrorNative) return;
  const tree = await chrome.bookmarks.getTree();
  const root = findQuickMarkFolder(tree[0]) || await chrome.bookmarks.create({ parentId: tree[0].id, title: 'QuickMark Pro' });
  await chrome.bookmarks.create({ parentId: root.id, title: bm.title, url: bm.urlRaw });
}

function findQuickMarkFolder(node) {
  if (node.title === 'QuickMark Pro' && !node.url) return node;
  for (const c of node.children || []) {
    const found = findQuickMarkFolder(c);
    if (found) return found;
  }
  return null;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}
