// sw.js — service worker MV3 QuickMark Pro.
// Aturan dorman (PRD §6): semua listener didaftarkan SINKRON di top-level, tanpa state global,
// tanpa interval. Pekerjaan: commands, omnibox, alarm backup harian.

import * as db from '../lib/db.js';
import { resolveActiveProfile, listProfiles } from '../lib/profiles.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { builtinCategories } from '../lib/categorizer.js';
import { saveBookmark } from '../lib/save.js';
import { buildIndex, search as fuzzySearch } from '../lib/search.js';
import { createBackup } from '../lib/io.js';

const BACKUP_ALARM = 'qmBackupDaily';

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureBackupAlarm();
  if (reason === 'install') {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureBackupAlarm();
});

async function ensureBackupAlarm() {
  const existing = await chrome.alarms.get(BACKUP_ALARM);
  if (!existing) {
    chrome.alarms.create(BACKUP_ALARM, { delayInMinutes: 60, periodInMinutes: 24 * 60 });
  }
}

// ---------- Command: quick-save (Ctrl+Shift+S) ----------
// activeTab di-grant saat command dipicu — dapat url/title tanpa "tabs" permission.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'quick-save' || !tab) return;
  const profile = await resolveActiveProfile(tab.windowId);
  const r = await saveBookmark(tab, profile.id, {});
  if (r.ok) {
    await flashBadge('OK');
  } else if (r.reason === 'duplicate') {
    await flashBadge('DUP');
  } else {
    await flashBadge('ERR');
  }
});

async function flashBadge(text) {
  await chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#0d9488' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }).catch(() => {}), 1500);
}

// ---------- Pesan dari content script panel cepat di halaman web ----------
// qm-meta: daftar profil + kategori profil aktif. qm-save: simpan bookmark
// lewat satu pintu saveBookmark (alur sama dengan popup & shortcut).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !sender || !sender.tab) return false;
  if (msg.type === 'qm-meta') {
    handleQuickMeta(sender.tab.windowId).then(sendResponse).catch(() => sendResponse(null));
    return true; // respons async
  }
  if (msg.type === 'qm-mode') {
    // Mode posisi FAB dari panel cepat halaman web — lewat saveSettings agar
    // broadcast 'settings-changed' terpicu dan manager/popup ikut sinkron.
    saveSettings({ quickPanelMode: msg.mode })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, reason: 'error:' + (e && e.message) }));
    return true;
  }
  if (msg.type === 'qm-save') {
    handleQuickSave(sender.tab.windowId, msg.payload || {})
      .then(sendResponse).catch((e) => sendResponse({ ok: false, reason: 'error:' + (e && e.message) }));
    return true;
  }
  return false;
});

async function handleQuickMeta(windowId) {
  const profile = await resolveActiveProfile(windowId);
  const profiles = await listProfiles();
  // Hanya kategori aktif untuk panel cepat web — nonaktif disembunyikan.
  const categories = (await db.listCategories(profile.id)).filter((c) => c.enabled !== false);
  // Semua kategori aktif lintas profil — panel web menyaring milik profil terpilih + shared
  // saat select Profil diganti (sinkron dengan filter catOptionsGrouped di manager).
  const allCategories = (await db.listAllCategories())
    .filter((c) => c.enabled !== false)
    .map((c) => ({ id: c.id, name: c.name, color: c.color, profileId: c.profileId }));
  const s = await getSettings();
  return {
    profiles,
    categories,
    allCategories,
    builtin: builtinCategories(s.datasetEnabled).map((c) => ({ id: c.id, name: c.name, color: c.color })),
    activeProfileId: profile.id
  };
}

async function handleQuickSave(windowId, payload) {
  const profile = payload.profileId
    ? (await db.get('profiles', payload.profileId)) || (await resolveActiveProfile(windowId))
    : await resolveActiveProfile(windowId);
  return saveBookmark(
    { url: payload.url, title: payload.title },
    profile.id,
    {
      categoryId: payload.categoryId === null ? undefined : payload.categoryId,
      flags: payload.flags || { favorite: false, readLater: false }
    }
  );
}

// ---------- Omnibox "qm" ----------
// Engine search yang sama dengan UI (PRD §3.7). Content = URL (dibuka saat Enter),
// description = judul + meta kategori.
chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const results = await searchFor(text, 8);
  suggest(results.map((r) => ({
    content: r.bm.urlRaw || r.bm.url,
    description: escapeDesc(r.bm.title) + ' — ' + escapeDesc(r.bm.url)
  })));
});

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  // text = content saran (URL) atau query mentah — bila mentah, buka hasil teratas.
  let url = text;
  if (!/^https?:\/\//i.test(text)) {
    const results = await searchFor(text, 1);
    if (!results.length) return;
    url = results[0].bm.urlRaw || results[0].bm.url;
    await db.incrementOpen(results[0].bm.id);
  } else {
    const all = await db.getAll('bookmarks');
    const hit = all.find((b) => (b.urlRaw || b.url) === text);
    if (hit) await db.incrementOpen(hit.id);
  }
  if (disposition === 'newForegroundTab') {
    await chrome.tabs.create({ url });
  } else if (disposition === 'newBackgroundTab') {
    await chrome.tabs.create({ url, active: false });
  } else {
    await chrome.tabs.update({ url });
  }
});

async function searchFor(query, limit) {
  const all = await db.getAll('bookmarks');
  const idx = buildIndex(all);
  return fuzzySearch(query, idx, { limit });
}

function escapeDesc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- Alarm backup harian ----------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== BACKUP_ALARM) return;
  try {
    await createBackup();
  } catch (e) {
    console.error('Backup harian gagal:', e);
  }
});
