// popup.js — quick save + search + switcher profil (PRD §3.1, §3.2, §3.4).
import * as db from '../lib/db.js';
import { resolveActiveProfile, listProfiles, setActiveProfileId } from '../lib/profiles.js';
import { saveBookmark } from '../lib/save.js';
import { buildIndex, search as fuzzySearch, highlightRanges } from '../lib/search.js';
import { classify, confidenceOf, learningMap, builtinCategories } from '../lib/categorizer.js';
import { escapeHtml, toast, onBroadcast, faviconSrc, letterIcon, debounce } from '../lib/ui.js';
import { getSettings, applyTheme } from '../lib/settings.js';

const $ = (sel) => document.querySelector(sel);
let state = {
  tab: null, windowId: null, profile: null, profiles: [],
  categories: [], selectedCategory: undefined, // undefined = saran otomatis
  suggestion: null, index: [], settings: null,
  selIdx: -1, results: [], filters: { flag: null }
};

// applyTheme helper di settings.js (theme dark/light/system)
init();
async function init() {
  state.settings = await getSettings();
  applyTheme(state.settings.theme);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  state.windowId = tab.windowId;
  state.profile = await resolveActiveProfile(tab.windowId);
  state.profiles = await listProfiles();
  await renderSaveCard();
  renderProfileSwitcher();
  await reloadIndex();
  bindEvents();
  onBroadcast((msg) => {
    if (msg.type === 'settings-changed') {
      getSettings().then((st) => { state.settings = st; applyTheme(st.theme); return refreshAll(); });
    } else if (msg.type === 'profiles-changed' || msg.type === 'bookmarks-changed') refreshAll();
  });
}

// ---------- Save card ----------
async function renderSaveCard() {
  const { tab, profile } = state;
  $('#page-title').textContent = tab.title || '';
  $('#page-url').textContent = tab.url || '';
  renderFavicon($('#page-favicon'), tab.url);
  // Saran kategori: dataset aktif + learning profil.
  const learning = learningMap(await db.listLearning(profile.id));
  const enabledCats = builtinCategories(state.settings.datasetEnabled);
  // Kategori nonaktif (enabled === false) tidak masuk chips.
  const userCats = (await db.listCategories(profile.id)).filter((c) => c.enabled !== false);
  state.categories = catChips(enabledCats, userCats);
  // Saran hanya bila kategori sasarannya aktif — learning bisa menunjuk kategori nonaktif.
  const saran = classify(tab.url, tab.title || '', learning);
  const saranOk = saran.categoryId &&
    (enabledCats.some((c) => c.id === saran.categoryId) || userCats.some((c) => c.id === saran.categoryId));
  state.suggestion = saranOk ? { ...saran, name: catName(saran.categoryId) } : null;
  renderChips();
  // Cek duplikat lintas profil (popup in-memory sudah load semua bookmark).
  const url = normalizeUrlForCheck(tab.url);
  if (url) {
    const dup = await db.findDuplicateOf(url);
    renderDup(dup);
  }
}

import { normalizeUrl } from '../lib/dedup.js';

function normalizeUrlForCheck(url) {
  return url && /^https?:/i.test(url) ? normalizeUrl(url) : '';
}

function catName(id) {
  const c = state.categories.find((x) => x.id === id);
  return c ? c.name : id;
}

// Chips kategori: saran ditandai "Rekomendasi", lalu semua kategori profil + "Tanpa kategori".
function catChips(enabledCats, userCats) {
  const builtin = enabledCats.map((c) => ({ id: c.id, name: c.name, color: c.color, builtin: true }));
  const custom = (userCats || [])
    .filter((c) => c.enabled !== false)
    .filter((c) => !enabledCats.some((b) => b.id === c.id))
    .map((c) => ({ id: c.id, name: c.name, color: c.color, builtin: false }));
  return builtin.concat(custom);
}

function renderChips() {
  const host = $('#category-chips');
  host.innerHTML = '';
  const saran = state.suggestion;
  if (saran) {
    const conf = confidenceOf(saran.source);
    const btn = document.createElement('button');
    btn.className = 'qm-chip' + (state.selectedCategory === undefined ? ' active' : '');
    btn.style.setProperty('--chip-color', chipColor(saran.categoryId));
    btn.innerHTML = iconOf(saran.categoryId) + escapeHtml(saran.name) +
      (conf < 0.8 ? ' <span class="tag-rec">Rekomendasi</span>' : '');
    btn.onclick = () => { state.selectedCategory = state.selectedCategory === undefined ? null : undefined; renderChips(); };
    host.appendChild(btn);
  }
  let dividerAdded = false;
  for (const c of state.categories) {
    // Pemisah antara kategori bawaan dan kategori buatan user.
    if (!dividerAdded && c.builtin === false) {
      const div = document.createElement('span');
      div.className = 'qm-chip-div';
      div.textContent = 'kategori saya';
      host.appendChild(div);
      dividerAdded = true;
    }
    if (saran && c.id === saran.categoryId) continue;
    const btn = document.createElement('button');
    btn.className = 'qm-chip' + (state.selectedCategory === c.id ? ' active' : '');
    btn.style.setProperty('--chip-color', c.color);
    btn.innerHTML = iconOf(c.id) + escapeHtml(c.name);
    btn.onclick = () => { state.selectedCategory = state.selectedCategory === c.id ? undefined : c.id; renderChips(); };
    host.appendChild(btn);
  }
  updateCatToggle();
}

// Collapse chips: default 1 baris; tombol muncul hanya saat overflow (banyak kategori).
function updateCatToggle() {
  const host = $('#category-chips');
  const toggle = $('#cat-toggle');
  const collapsed = host.classList.contains('collapsed');
  const count = host.querySelectorAll('.qm-chip').length;
  const overflow = host.scrollHeight > 32;
  toggle.classList.toggle('hidden', !overflow && !collapsed);
  toggle.textContent = collapsed
    ? '+' + count + ' kategori ▾'
    : 'Sembunyikan ▴';
}

function toggleCats() {
  const host = $('#category-chips');
  host.classList.toggle('collapsed');
  host.classList.toggle('expanded');
  updateCatToggle();
}

// Helper kecil untuk chips/ikon — diambil dari kategori builtin atau custom.
function chipColor(id) {
  const c = state.categories.find((x) => x.id === id);
  return c ? c.color : 'var(--accent)';
}
function iconOf(id) {
  // Ikon SVG dirender via ui.icon — di sini cukup titik warna agar popup ramping.
  return '<span class="qm-dot" style="background:' + chipColor(id) + '"></span>';
}

function renderDup(dup) {
  const el = $('#dup-banner');
  if (!dup) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = 'Sudah ada di bookmark (' + escapeHtml(dup.profileId) + ')' +
    ' <button id="dup-overwrite" class="qm-btn-ghost">Timpa metadata</button>';
  $('#dup-overwrite').onclick = () => doSave({ overwrite: true });
}

function renderFavicon(img, url) {
  const mode = state.settings.faviconMode;
  if (!url) return;
  if (mode === 'letter') {
    const li = letterIcon(url);
    img.style.display = 'none';
    img.insertAdjacentHTML('afterend', '<span class="qm-letter" style="background:' + li.color + '">' + li.letter + '</span>');
    return;
  }
  img.src = faviconSrc(url, mode);
  img.onerror = () => {
    const li = letterIcon(url);
    img.style.display = 'none';
    img.insertAdjacentHTML('afterend', '<span class="qm-letter" style="background:' + li.color + '">' + li.letter + '</span>');
  };
}

// ---------- Simpan ----------
async function doSave(overrides) {
  const o = overrides || {};
  const profile = state.profile;
  const categoryId = state.selectedCategory === undefined ? undefined : state.selectedCategory || null;
  const flags = {
    favorite: $('#flag-favorite').checked,
    readLater: $('#flag-readlater').checked
  };
  const r = await saveBookmark(state.tab, profile.id, {
    categoryId,
    note: $('#note-input').value.trim(),
    flags,
    overwrite: o.overwrite === true
  });
  if (r.ok) {
    toast($('#toast-host'), 'Tersimpan ke ' + profile.name, {
      actionLabel: 'Undo',
      onAction: async () => {
        await db.deleteBookmark(r.bookmark.id);
        refreshAll();
      }
    });
    refreshAll();
  } else if (r.reason === 'invalid-url') {
    toast($('#toast-host'), 'URL tidak bisa disimpan (bukan http/https)');
  } else {
    renderDup(r.existing);
    toast($('#toast-host'), 'Sudah ada di bookmark');
  }
}

// ---------- Profil switcher ----------
function renderProfileSwitcher() {
  const host = $('#profile-switcher');
  host.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = 'qm-profile-btn';
  btn.innerHTML = '<span class="qm-profile-dot" style="background:' + state.profile.color + '"></span>' +
    escapeHtml(state.profile.name) + ' ▾';
  host.appendChild(btn);
  const menu = document.createElement('div');
  menu.className = 'qm-profile-menu glass';
  for (const p of state.profiles) {
    const item = document.createElement('button');
    item.className = 'qm-profile-item' + (p.id === state.profile.id ? ' active' : '');
    item.innerHTML = '<span class="qm-profile-dot" style="background:' + p.color + '"></span>' + escapeHtml(p.name);
    item.onclick = async () => {
      await setActiveProfileId(state.windowId, p.id);
      state.profile = p;
      menu.classList.remove('open');
      await renderSaveCard();
      renderProfileSwitcher();
    };
    menu.appendChild(item);
  }
  host.appendChild(menu);
  btn.onclick = (ev) => {
    ev.stopPropagation();
    menu.classList.toggle('open');
  };
  document.addEventListener('click', () => menu.classList.remove('open'), { once: true });
}

// ---------- Search ----------
async function reloadIndex() {
  const bms = await db.listBookmarks(state.profile.id);
  state.index = buildIndex(bms);
}

function renderResults() {
  const host = $('#search-results');
  const q = $('#search-input').value.trim();
  const res = fuzzySearch(q, state.index, { limit: 30, filters: state.filters.flag ? { flag: state.filters.flag } : null });
  state.results = res;
  state.selIdx = -1;
  if (!res.length) {
    host.innerHTML = '<div class="qm-empty">' + (q ? 'Tidak ada hasil.' : 'Belum ada bookmark di profil ini.') + '</div>';
    return;
  }
  host.innerHTML = res.map((r, i) => resultHtml(r, i)).join('');
  attachFaviconFallbacks(host);
  host.querySelectorAll('.qm-result').forEach((el) => {
    el.onclick = () => openResult(Number(el.dataset.i), evActive());
  });
}

function evActive() { return true; }

function resultHtml(r, i) {
  const bm = r.entry.bm;
  const title = hl(bm.title || bm.url, $('#search-input').value);
  return '<div class="qm-result" data-i="' + i + '">' +
    faviconImg(bm.url) +
    '<div class="r-title">' + title + '</div>' +
    '<div class="r-url mono">' + escapeHtml(shortUrl(bm.url)) + '</div>' +
    '</div>';
}

function hl(text, q) {
  const safe = escapeHtml(text);
  const ranges = highlightRanges(q, text);
  if (!ranges) return safe;
  const [s, e] = ranges[0];
  // Highlight pada teks hasil escape: posisi bisa bergeser bila ada entity —
  // cara aman: highlight pada teks asli dulu, baru escape per bagian.
  return escapeHtml(text.slice(0, s)) + '<mark>' + escapeHtml(text.slice(s, e)) + '</mark>' + escapeHtml(text.slice(e));
}

function shortUrl(u) {
  try { return new URL(u).host + (new URL(u).pathname === '/' ? '' : new URL(u).pathname); } catch (e) { return u; }
}

function faviconImg(url) {
  const li = letterIcon(url);
  if (state.settings.faviconMode === 'letter') {
    return '<span class="qm-letter" style="background:' + li.color + '">' + li.letter + '</span>';
  }
  return '<img class="qm-favicon" src="' + faviconSrc(url, state.settings.faviconMode) + '" data-letter="' + li.letter + '" data-color="' + li.color + '">';
}

// Pasang fallback ikon huruf via listener — CSP MV3 melarang inline handler.
function attachFaviconFallbacks(host) {
  host.querySelectorAll("img.qm-favicon").forEach((img) => {
    img.addEventListener("error", () => {
      const span = document.createElement("span");
      span.className = "qm-letter";
      span.style.background = img.dataset.color || "#60a5fa";
      span.textContent = img.dataset.letter || "?";
      img.replaceWith(span);
    });
  });
}
async function openResult(i, active) {
  const r = state.results[i];
  if (!r) return;
  const url = r.entry.bm.urlRaw || r.entry.bm.url;
  await db.incrementOpen(r.entry.bm.id);
  if (active) {
    await chrome.tabs.update({ url });
    window.close();
  } else {
    await chrome.tabs.create({ url, active: false });
  }
}

// ---------- Filter chips (flag) ----------
function renderFilterChips() {
  const host = $('#search-filters');
  host.innerHTML = '';
  const opts = [['favorite', 'Favorit'], ['readLater', 'Baca nanti']];
  for (const [flag, label] of opts) {
    const on = state.filters.flag === flag;
    const btn = document.createElement('button');
    btn.className = 'qm-chip' + (on ? ' active' : '');
    btn.textContent = label;
    btn.onclick = () => {
      state.filters.flag = on ? null : flag;
      renderFilterChips();
      renderResults();
    };
    host.appendChild(btn);
  }
}

// ---------- Events ----------
function bindEvents() {
  $('#btn-save').onclick = () => doSave({});
  $('#btn-expand').onclick = () => $('#save-extra').classList.toggle('hidden');
  $('#cat-toggle').onclick = toggleCats;
  $('#btn-manager').onclick = () => chrome.tabs.create({ url: 'manager/manager.html' });
  $('#btn-panel').onclick = async () => {
    // Buka side panel jendela ini lalu tutup popup.
    await chrome.sidePanel.open({ windowId: state.windowId });
    window.close();
  };
  const onType = debounce(() => renderResults(), 80);
  $('#search-input').addEventListener('input', onType);
  $('#search-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      moveSel(ev.key === 'ArrowDown' ? 1 : -1);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const i = state.selIdx >= 0 ? state.selIdx : 0;
      openResult(i, !ev.ctrlKey);
    }
  });
}

function moveSel(delta) {
  const rows = document.querySelectorAll('#search-results .qm-result');
  if (!rows.length) return;
  state.selIdx = Math.min(rows.length - 1, Math.max(0, state.selIdx + delta));
  rows.forEach((r, i) => r.classList.toggle('sel', i === state.selIdx));
  rows[state.selIdx].scrollIntoView({ block: 'nearest' });
}

async function refreshAll() {
  state.profiles = await listProfiles();
  await reloadIndex();
  await renderSaveCard();
  renderProfileSwitcher();
  renderFilterChips();
  renderResults();
}
