// panel.js — side panel: browse kategori + search + filter flag (PRD §3.2, §3.3, §3.5).
import * as db from '../lib/db.js';
import { resolveActiveProfile, listProfiles, setActiveProfileId } from '../lib/profiles.js';
import { buildIndex, search as fuzzySearch, highlightRanges } from '../lib/search.js';
import { escapeHtml, onBroadcast, virtualList, faviconSrc, letterIcon, debounce } from '../lib/ui.js';
import { getSettings, applyTheme } from '../lib/settings.js';

const $ = (sel) => document.querySelector(sel);
let state = {
  profile: null, profiles: [], bookmarks: [], index: [],
  categoryId: null, flag: null, settings: null, windowId: null, vlist: null
};

init();
async function init() {
  state.settings = await getSettings();
  applyTheme(state.settings.theme);
  // Side panel tidak punya tab sendiri — pakai jendela aktif.
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  state.windowId = tab ? tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
  state.profile = await resolveActiveProfile(state.windowId);
  state.profiles = await listProfiles();
  await reload();
  renderProfileSwitcher();
  renderCatChips();
  renderFilterChips();
  renderList('');
  $('#btn-manager').onclick = () => chrome.tabs.create({ url: 'manager/manager.html' });
  const onType = debounce(() => renderList($('#search-input').value.trim()), 80);
  $('#search-input').addEventListener('input', onType);
  $('#search-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const res = fuzzySearch($('#search-input').value.trim(), filteredIndex(), { limit: 1 });
      if (res.length) openBookmark(res[0].entry.bm);
    }
  });
  onBroadcast(async (msg) => {
    if (msg.type === 'settings-changed') {
      state.settings = await getSettings();
      applyTheme(state.settings.theme);
    }
    if (msg.type === 'bookmarks-changed' || msg.type === 'profiles-changed' || msg.type === 'settings-changed') await refresh();
  });
}

async function reload() {
  state.bookmarks = await db.listBookmarks(state.profile.id);
  state.index = buildIndex(state.bookmarks);
  renderBadgeBar();
}

function filteredIndex() {
  return state.index.filter((e) => {
    if (state.categoryId && e.cat !== state.categoryId) return false;
    if (state.flag && !(e.bm.flags && e.bm.flags[state.flag])) return false;
    return true;
  });
}

function renderList(q) {
  const host = $('#list');
  const res = fuzzySearch(q, filteredIndex(), { limit: 500 });
  const items = res.map((r) => r.entry);
  state.vlist = virtualList(host, items, {
    rowHeight: 44,
    render: (entry) => rowHtml(entry, q),
    onActivate: (entry) => openBookmark(entry.bm)
  });
  attachFaviconFallbacks(host);
  if (!items.length) {
    host.innerHTML = '<div class="qm-empty">' + (q ? 'Tidak ada hasil.' : 'Belum ada bookmark di profil ini.') + '</div>';
  }
}

function rowHtml(entry, q) {
  const bm = entry.bm;
  const title = hl(bm.title || bm.url, q);
  const flags = [];
  if (bm.flags && bm.flags.favorite) flags.push('★');
  if (bm.flags && bm.flags.readLater) flags.push('📌'.replace('📌', 'R'));
  return '<div class="r-main"><div class="r-title">' + title + '</div>' +
    '<div class="r-url mono">' + escapeHtml(shortUrl(bm.url)) + '</div></div>' +
    faviconHtml(bm.url) +
    '<div class="r-flags">' + flags.join('') + '</div>';
}

function hl(text, q) {
  if (!q) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(text.slice(idx + q.length));
}

function shortUrl(u) {
  try { const x = new URL(u); return x.host + (x.pathname === '/' ? '' : x.pathname); } catch (e) { return u; }
}

function faviconHtml(url) {
  if (state.settings.faviconMode === 'letter') {
    const li = letterIcon(url);
    return '<span class="qm-letter" style="background:' + li.color + '">' + li.letter + '</span>';
  }
  const li = letterIcon(url);
  return '<img class="qm-favicon" src="' + faviconSrc(url, state.settings.faviconMode) + '" data-letter="' + li.letter + '" data-color="' + li.color + '">';
}

function attachFaviconFallbacks(host) {
  host.querySelectorAll('img.qm-favicon').forEach((img) => {
    img.addEventListener('error', () => {
      const span = document.createElement('span');
      span.className = 'qm-letter';
      span.style.background = img.dataset.color || '#60a5fa';
      span.textContent = img.dataset.letter || '?';
      img.replaceWith(span);
    });
  });
}

async function openBookmark(bm) {
  await db.incrementOpen(bm.id);
  await chrome.tabs.create({ url: bm.urlRaw || bm.url });
}

// ---------- Chips kategori dengan jumlah ----------
async function renderCatChips() {
  const host = $('#cat-chips');
  host.innerHTML = '';
  // Hanya kategori aktif di chips — nonaktif disembunyikan (bookmark tetap ada).
  const cats = (await db.listCategories(state.profile.id)).filter((c) => c.enabled !== false);
  const counts = {};
  for (const e of state.index) counts[e.cat || ''] = (counts[e.cat || ''] || 0) + 1;
  const mk = (id, label, color) => {
    const btn = document.createElement('button');
    btn.className = 'qm-chip' + (state.categoryId === id ? ' active' : '');
    if (color) btn.style.setProperty('--chip-color', color);
    btn.textContent = label + ' (' + (counts[id || ''] || 0) + ')';
    btn.onclick = () => {
      state.categoryId = state.categoryId === id ? null : id;
      renderCatChips();
      renderList($('#search-input').value.trim());
    };
    host.appendChild(btn);
  };
  mk(null, 'Semua');
  for (const c of cats) mk(c.id, c.name, c.color);
  if (counts['']) mk('', 'Tanpa kategori', 'var(--text-dim)');
}

function renderFilterChips() {
  const host = $('#filter-chips');
  host.innerHTML = '';
  const opts = [['favorite', 'Favorit'], ['readLater', 'Baca nanti']];
  for (const [flag, label] of opts) {
    const on = state.flag === flag;
    const n = state.index.filter((e) => e.bm.flags && e.bm.flags[flag]).length;
    const btn = document.createElement('button');
    btn.className = 'qm-chip' + (on ? ' active' : '');
    btn.textContent = label + ' (' + n + ')';
    btn.onclick = () => {
      state.flag = on ? null : flag;
      renderFilterChips();
      renderList($('#search-input').value.trim());
    };
    host.appendChild(btn);
  }
}

// ---------- Profil switcher (bentuk sama dengan popup) ----------
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
      await refresh();
    };
    menu.appendChild(item);
  }
  host.appendChild(menu);
  btn.onclick = (ev) => { ev.stopPropagation(); menu.classList.toggle('open'); };
  document.addEventListener('click', () => menu.classList.remove('open'), { once: true });
}

function renderBadgeBar() {
  const total = state.bookmarks.length;
  const rl = state.bookmarks.filter((b) => b.flags && b.flags.readLater).length;
  const fav = state.bookmarks.filter((b) => b.flags && b.flags.favorite).length;
  $('#badge-bar').innerHTML = 'Total: <b>' + total + '</b> · Baca nanti: <b>' + rl + '</b> · Favorit: <b>' + fav + '</b>';
}

async function refresh() {
  state.profiles = await listProfiles();
  await reload();
  renderProfileSwitcher();
  renderCatChips();
  renderFilterChips();
  renderList($('#search-input').value.trim());
}
