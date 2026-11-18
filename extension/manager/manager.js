// manager.js — kontrol penuh: bookmark (tabel+bulk), kategori, profil, statistik,
// data & backup, pengaturan (PRD §3.6–§3.9).
import * as db from '../lib/db.js';
import { listProfiles, listVisibleProfiles, assertCanLock, filterVisibleBookmarks, createProfile, updateProfile, deleteProfile, resolveActiveProfile } from '../lib/profiles.js';
import { buildIndex, search as fuzzySearch } from '../lib/search.js';
import { normalizeUrl } from '../lib/dedup.js';
import { runDedup, exportJSON, bookmarksToNetscape, parseNetscapeHtml, parseQuickmarkJson, importItems, importNative, createBackup, listBackups, restoreBackup, deleteBackup, clearBackups, exportLockedData, applyLockedImport, sanitizeBackupName, backupFileName } from '../lib/io.js';
import { escapeHtml, toast, confirm2, onBroadcast, debounce, faviconSrc, letterIcon, uid, askPassword } from '../lib/ui.js';
import { hasPassword, setPassword, verifyPassword, removePassword, isUnlocked, unlock, lockNow, hiddenLockedCount, encryptExport, decryptExport, isEncryptedFile } from '../lib/lock.js';
import { getSettings, saveSettings, applyTheme, DEFAULT_SETTINGS } from '../lib/settings.js';
// Google Drive NONAKTIF: modul lib/drive.js tidak di-import sama sekali (tidak dimuat
// browser). Untuk menghidupkan kembali: set DRIVE_ENABLED = true di sini DAN di
// lib/drive.js, lalu reload extension.
const DRIVE_ENABLED = false;

const $ = (sel) => document.querySelector(sel);
const state = {
  profiles: [], categories: [], bookmarks: [], index: [],
  profileId: '*', categoryId: null, flag: null, q: '',
  selected: new Set(), catOpen: new Set(), bmTreeOpen: new Set(), settings: null, catsById: new Map(), activeView: 'bookmarks'
};

// Simpan setting + toast hasil. Semua kontrol pengaturan di manager lewat sini supaya
// user tahu perubahannya benar-benar tersimpan — atau gagal beserta alasannya.
// Return setting baru, atau null bila gagal (pemanggil tetap boleh lanjut render).
async function saveSetting(patch, label) {
  try {
    const st = await saveSettings(patch);
    state.settings = st;
    toast($('#toast-host'), 'Tersimpan: ' + label);
    return st;
  } catch (e) {
    const msg = (e && e.message) ? e.message : 'tidak diketahui';
    toast($('#toast-host'), 'Gagal menyimpan ' + label + ' — ' + msg);
    return null;
  }
}

init();
async function init() {
  state.settings = await getSettings();
  applyTheme(state.settings.theme);
  // Muat status buka-tutup grup (view Kategori & hierarki Bookmark) — persist di storage.local.
  await Promise.all([
    loadTreeOpen('qmCatOpen', state.catOpen),
    loadTreeOpen('qmBmTreeOpen', state.bmTreeOpen)
  ]);
  await reload();
  bindNav();
  bindBroadcast();
  // FAB diikat sebelum view dirender supaya tetap hidup di SEMUA view,
  // walau render satu view gagal (feedback: FAB hanya muncul di Pengaturan).
  initQuickPanel().catch((e) => console.error('initQuickPanel', e));
  renderAll();
  restoreLastView();
}

// Pulihkan menu terakhir yang diklik (per-tab via sessionStorage) — refresh
// tidak lagi melompat balik ke Bookmark sehingga tidak perlu klik dua kali.
function restoreLastView() {
  let view = 'bookmarks';
  try { view = sessionStorage.getItem('qmView') || 'bookmarks'; } catch (e) {}
  if (view === 'bookmarks' || !document.getElementById('view-' + view)) return;
  state.activeView = view;
  document.querySelectorAll('#mg-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.mg-view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  renderView(view);
}

async function reload() {
  // Profil terkunci (belum di-unlock) tidak masuk state — semua view otomatis bersih.
  state.profiles = await listVisibleProfiles();
  const visIds = new Set(state.profiles.map((p) => p.id));
  state.categories = (await db.listAllCategories()).filter((c) => c.shared || visIds.has(c.profileId));
  const { builtin } = categoryChoices(state.categories, state.settings.datasetEnabled);
  state.catsById = new Map(builtin.map((c) => [c.id, c]).concat(state.categories.map((c) => [c.id, c])));
  state.bookmarks = await filterVisibleBookmarks(await db.getAll('bookmarks'));
  state.index = buildIndex(state.bookmarks);
}

function bindNav() {
  document.querySelectorAll('#mg-nav button').forEach((btn) => {
    btn.onclick = () => {
      state.activeView = btn.dataset.view;
      try { sessionStorage.setItem('qmView', state.activeView); } catch (e) {}
      document.querySelectorAll('#mg-nav button').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.mg-view').forEach((v) => v.classList.remove('active'));
      btn.classList.add('active');
      $('#view-' + btn.dataset.view).classList.add('active');
      renderView(btn.dataset.view);
    };
  });
}

function bindBroadcast() {
  onBroadcast(async (msg) => {
    if (msg.type === 'bookmarks-changed' || msg.type === 'profiles-changed') {
      await reload();
      renderAll();
      renderActiveView();
    } else if (msg.type === 'settings-changed' || msg.type === 'categories-changed') {
      await refreshDerived();
    }
  });
}

// Muat ulang state turunan dari settings (catsById, index, tema) lalu render view aktif —
// dipakai saat setting dataset/favicon berubah agar dropdown & tabel langsung ikut.
async function refreshDerived() {
  state.settings = await getSettings();
  applyTheme(state.settings.theme);
  await reload();
  renderAll();
  renderActiveView();
}

// Render ulang view yang sedang terbuka (renderAll hanya me-render bookmarks).
function renderActiveView() {
  if (state.activeView && state.activeView !== 'bookmarks') renderView(state.activeView);
}

function renderAll() {
  renderView('bookmarks');
  renderProfileInfo();
  // View lain dirender saat nav diklik (hemat — PRD §6).
}

function renderView(name) {
  if (name === 'bookmarks') renderBookmarks();
  else if (name === 'categories') renderCategories();
  else if (name === 'profiles') renderProfiles();
  else if (name === 'stats') renderStats();
  else if (name === 'data') renderData();
  else if (name === 'settings') renderSettings();
}

function renderProfileInfo() {
  const cur = state.profiles.find((p) => p.isDefault);
  $('#mg-profile-info').innerHTML = 'Profil default<br><b>' + escapeHtml(cur ? cur.name : '-') + '</b><br>' +
    state.profiles.length + ' profil · ' + state.bookmarks.length + ' bookmark';
}

// ---------- View: Bookmark ----------
function renderBookmarks() {
  const v = $('#view-bookmarks');
  v.innerHTML = '<h1>Bookmark</h1>' +
    '<div class="mg-sub">Cari, filter, edit, dan bulk action. Profil aktif mengikuti pilihan di bawah.</div>' +
    '<div class="mg-toolbar">' +
    '<input id="bm-q" type="text" placeholder="Cari bookmark (fuzzy)…">' +
    '<select id="bm-profile"><option value="*">Semua profil</option></select>' +
    '<div id="bm-cat-dd"></div>' +
    '<button id="bm-flag-fav" class="qm-btn-ghost">Favorit</button>' +
    '<button id="bm-flag-rl" class="qm-btn-ghost">Baca nanti</button>' +
    '<select id="bm-viewmode" title="Tampilan daftar bookmark">' +
    '<option value="table">Tampilan: Tabel</option>' +
    '<option value="tree">Tampilan: Hierarki</option></select>' +
    (state.settings.bookmarkView === 'tree'
      ? '<button id="bm-expand" class="qm-btn-ghost">Buka semua</button>' +
        '<button id="bm-collapse" class="qm-btn-ghost">Tutup semua</button>'
      : '') +
    '</div><div id="bm-bulk"></div><div id="bm-table"></div>';
  const selProfile = $('#bm-profile');
  for (const p of state.profiles) {
    selProfile.insertAdjacentHTML('beforeend', '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>');
  }
  // Filter kategori: dropdown ber-cari (daftar bisa panjang). Isinya sama seperti
  // sebelumnya — semua kategori DB, termasuk nonaktif agar bookmarknya tetap bisa difilter.
  const catFilter = createCatPicker({
    value: state.categoryId || '',
    emptyLabel: 'Semua kategori',
    groups: [{ label: 'Kategori saya', items: state.categories }],
    onPick: (v) => { state.categoryId = v || null; renderBookmarkView(); }
  });
  $('#bm-cat-dd').appendChild(catFilter.root);
  selProfile.value = state.profileId;
  selProfile.onchange = () => { state.profileId = selProfile.value; renderBookmarkView(); };
  // Pilih tampilan daftar: Tabel (bawaan) atau Hierarki (parent profil, anak bookmark).
  // Tersimpan di chrome.storage.sync — refresh tidak kembali ke default.
  const selView = $('#bm-viewmode');
  selView.value = (state.settings.bookmarkView === 'tree') ? 'tree' : 'table';
  selView.onchange = async (ev) => {
    await saveSetting({ bookmarkView: ev.target.value }, 'Tampilan bookmark');
    renderBookmarks();
  };
  if (state.settings.bookmarkView === 'tree') {
    $('#bm-expand').onclick = async () => {
      state.bmTreeOpen = new Set(bmTreeAllKeys());
      await saveTreeOpen('qmBmTreeOpen', state.bmTreeOpen);
      renderBookmarkTree();
    };
    $('#bm-collapse').onclick = async () => {
      state.bmTreeOpen.clear();
      await saveTreeOpen('qmBmTreeOpen', state.bmTreeOpen);
      renderBookmarkTree();
    };
  }
  $('#bm-flag-fav').onclick = () => { state.flag = state.flag === 'favorite' ? null : 'favorite'; renderBookmarkView(); };
  $('#bm-flag-rl').onclick = () => { state.flag = state.flag === 'readLater' ? null : 'readLater'; renderBookmarkView(); };
  const onType = debounce(() => { state.q = $('#bm-q').value.trim(); renderBookmarkView(); }, 80);
  $('#bm-q').addEventListener('input', onType);
  renderBookmarkView();
}

// Dispatch tampilan daftar bookmark sesuai setting bookmarkView ('table' | 'tree').
function renderBookmarkView() {
  if ((state.settings.bookmarkView || 'table') === 'tree') renderBookmarkTree();
  else renderTable();
}

// Tampilan hierarki: parent = profil (baris sendiri, klik buka/tutup), anak = bookmark.
// Struktur & pola sama dengan view Kategori (mg-cat-head / mg-cat-body).
function renderBookmarkTree() {
  const host = $('#bm-table');
  const bulk = $('#bm-bulk');
  if (bulk) bulk.innerHTML = ''; // hierarki tanpa selection — bulk action hanya di tampilan tabel
  const res = currentResults();
  if (!res.length) {
    host.innerHTML = '<div class="mg-card glass mg-muted">Tidak ada bookmark yang cocok.</div>';
    return;
  }
  // Kelompokkan per profil; profil tak dikenal (mis. terhapus) jadi grup di belakang.
  const byProf = {};
  for (const r of res) {
    const pid = r.entry.bm.profileId || '';
    (byProf[pid] = byProf[pid] || []).push(r.entry.bm);
  }
  const groups = [];
  for (const p of state.profiles) {
    if (byProf[p.id]) groups.push({ key: p.id, name: p.name, items: byProf[p.id] });
  }
  const known = new Set(state.profiles.map((p) => p.id));
  for (const k of Object.keys(byProf)) {
    if (!known.has(k)) groups.push({ key: k, name: '(profil tak dikenal)', items: byProf[k] });
  }
  const forceOpen = !!(state.q || state.categoryId || state.flag || state.profileId !== '*');
  // 3 level: parent profil -> sub-grup kategori -> baris bookmark.
  // Key buka-tutup berprefiks agar tidak bentrok antar level ('p:profilId', 'c:profilId|catId').
  host.innerHTML = '<div class="mg-card glass">' + groups.map((g) => {
    const open = forceOpen || state.bmTreeOpen.has('p:' + g.key);
    // Kelompokkan bookmark profil ini per kategori; tanpa kategori -> grup tersendiri.
    const byCat = {};
    for (const bm of g.items) {
      const cid = bm.categoryId || '';
      (byCat[cid] = byCat[cid] || []).push(bm);
    }
    const catGroups = [];
    for (const cid of Object.keys(byCat)) {
      const c = cid ? state.catsById.get(cid) : null;
      catGroups.push({ key: g.key + '|' + cid, name: c ? c.name : '(tanpa kategori)', color: c ? c.color : null, items: byCat[cid] });
    }
    catGroups.sort((a, b) => a.name.localeCompare(b.name, 'id'));
    return '<div class="mg-cat-head" data-key="p:' + g.key + '">' +
      '<span class="mg-cat-chev' + (open ? ' open' : '') + '">▸</span>' +
      '<b>' + escapeHtml(g.name) + '</b>' +
      '<span class="mg-muted">' + g.items.length + ' bookmark</span></div>' +
      (open ? '<div class="mg-cat-body">' + catGroups.map((cg) => {
        const cOpen = forceOpen || state.bmTreeOpen.has('c:' + cg.key);
        return '<div class="mg-cat-head sub" data-key="c:' + cg.key + '">' +
          '<span class="mg-cat-chev' + (cOpen ? ' open' : '') + '">▸</span>' +
          (cg.color ? '<span class="mg-cat-dot" style="background:' + cg.color + '"></span>' : '') +
          '<b>' + escapeHtml(cg.name) + '</b>' +
          '<span class="mg-muted">' + cg.items.length + ' bookmark</span></div>' +
          (cOpen ? '<div class="mg-cat-body deep">' + cg.items.map(bmTreeRow).join('') + '</div>' : '');
      }).join('') + '</div>' : '');
  }).join('') + '</div>';
  bindFaviconFallbacks(host);
  host.querySelectorAll('.mg-cat-head').forEach((h) => {
    h.addEventListener('click', () => {
      const key = h.dataset.key;
      if (state.bmTreeOpen.has(key)) state.bmTreeOpen.delete(key); else state.bmTreeOpen.add(key);
      saveTreeOpen('qmBmTreeOpen', state.bmTreeOpen); // persist — refresh tetap ingat
      renderBookmarkTree();
    });
  });
  host.querySelectorAll('.bm-row').forEach((row) => {
    const bm = state.bookmarks.find((b) => b.id === row.dataset.id);
    if (!bm) return;
    row.querySelector('.bm-open').onclick = () => chrome.tabs.create({ url: bm.urlRaw || bm.url });
    row.querySelector('.bm-edit').onclick = () => openEditModal(bm);
  });
}

// Baris bookmark di tampilan hierarki — ikon, judul, URL, flag, chip kategori, aksi.
function bmTreeRow(bm) {
  const cat = bm.categoryId ? state.catsById.get(bm.categoryId) : null;
  const fav = bm.flags && bm.flags.favorite;
  const rl = bm.flags && bm.flags.readLater;
  return '<div class="mg-list-row bm-row" data-id="' + bm.id + '">' +
    faviconHtml(bm) +
    '<div class="grow"><b>' + escapeHtml(bm.title || bm.url) + '</b>' +
    (fav ? ' <span class="mg-flag">★</span>' : '') + (rl ? ' <span class="mg-flag">R</span>' : '') +
    '<div class="t-url mono">' + escapeHtml(bm.url) + '</div></div>' +
    (cat ? '<span class="mg-cat-chip"><span class="mg-cat-dot" style="background:' + cat.color + '"></span>' + escapeHtml(cat.name) + '</span>' : '') +
    '<button class="qm-btn-ghost bm-open">Buka</button>' +
    '<button class="qm-btn-ghost bm-edit">Edit</button></div>';
}

// Fallback ikon huruf untuk semua <img> favicon di host — dipakai tabel & hierarki.
function bindFaviconFallbacks(host) {
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

function currentResults() {
  const scoped = state.profileId === '*' ? state.index : state.index.filter((e) => e.bm.profileId === state.profileId);
  return fuzzySearch(state.q, scoped, { limit: 1000, filters: { categoryId: state.categoryId, flag: state.flag } });
}

function renderTable() {
  const res = currentResults();
  const host = $('#bm-table');
  if (!res.length) {
    host.innerHTML = '<div class="mg-card glass mg-muted">Tidak ada bookmark yang cocok.</div>';
    $('#bm-bulk').innerHTML = '';
    return;
  }
  const rows = res.map((r) => rowHtml(r.entry.bm)).join('');
  host.innerHTML = '<table class="mg-table"><thead><tr>' +
    '<th style="width:28px"><input type="checkbox" id="bm-sel-all"></th>' +
    '<th style="width:44px"></th><th>Judul</th><th>URL</th><th>Kategori</th><th>Profil</th><th style="width:60px">Buka</th><th></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
  $('#bm-sel-all').onchange = (ev) => {
    if (ev.target.checked) res.forEach((r) => state.selected.add(r.entry.bm.id));
    else state.selected.clear();
    renderTable();
  };
  bindRowEvents(host);
  renderBulkBar(res);
}

function rowHtml(bm) {
  const cat = bm.categoryId ? state.catsById.get(bm.categoryId) : null;
  const catChip = cat
    ? '<span class="mg-cat-chip"><span class="mg-cat-dot" style="background:' + cat.color + '"></span>' + escapeHtml(cat.name) + '</span>'
    : '<span class="mg-muted">—</span>';
  const prof = state.profiles.find((p) => p.id === bm.profileId);
  const fav = bm.flags && bm.flags.favorite;
  const rl = bm.flags && bm.flags.readLater;
  return '<tr data-id="' + bm.id + '">' +
    '<td><input type="checkbox" class="bm-sel" ' + (state.selected.has(bm.id) ? 'checked' : '') + '></td>' +
    '<td>' + faviconHtml(bm) + '</td>' +
    '<td class="t-title" title="' + escapeHtml(bm.title) + '">' + escapeHtml(bm.title) + ' ' +
      (fav ? '<span class="mg-flag">★</span>' : '') + (rl ? '<span class="mg-flag">R</span>' : '') + '</td>' +
    '<td class="t-url mono" title="' + escapeHtml(bm.url) + '">' + escapeHtml(bm.url) + '</td>' +
    '<td>' + catChip + '</td>' +
    '<td>' + (prof ? escapeHtml(prof.name) : '?') + '</td>' +
    '<td>' + (bm.openCount || 0) + '</td>' +
    '<td><button class="qm-btn-ghost bm-edit">Edit</button></td></tr>';
}

function faviconHtml(bm) {
  const li = letterIcon(bm.url);
  if (state.settings.faviconMode === 'letter') {
    return '<span class="qm-letter" style="background:' + li.color + '">' + li.letter + '</span>';
  }
  return '<img class="qm-favicon" src="' + faviconSrc(bm.url, state.settings.faviconMode) + '" data-letter="' + li.letter + '" data-color="' + li.color + '">';
}

function bindRowEvents(host) {
  bindFaviconFallbacks(host);
  host.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    const bm = state.bookmarks.find((b) => b.id === id);
    tr.querySelector('.bm-sel').onchange = (ev) => {
      if (ev.target.checked) state.selected.add(id); else state.selected.delete(id);
      renderBulkBar(currentResults());
    };
    tr.querySelector('.bm-edit').onclick = () => openEditModal(bm);
    tr.querySelector('.t-title').ondblclick = () => openEditModal(bm);
  });
}

function renderBulkBar(res) {
  const host = $('#bm-bulk');
  if (!state.selected.size) { host.innerHTML = ''; return; }
  host.innerHTML = '<div class="mg-bulk"><b>' + state.selected.size + '</b> dipilih · ' +
    '<div id="bulk-cat-dd"></div>' +
    '<select id="bulk-profile"><option value="">Pindah profil…</option></select>' +
    '<button id="bulk-fav" class="qm-btn-ghost">★ Favorit</button>' +
    '<button id="bulk-rl" class="qm-btn-ghost">R Baca nanti</button>' +
    '<button id="bulk-del" class="qm-btn-danger">Hapus</button></div>';
  const catPicker = createCatPicker({
    emptyLabel: 'Pindah kategori…',
    groups: catGroupsFor(null),
    onPick: (v) => bulkApply(v ? { categoryId: v } : null)
  });
  $('#bulk-cat-dd').appendChild(catPicker.root);
  const selProf = $('#bulk-profile');
  for (const p of state.profiles) selProf.insertAdjacentHTML('beforeend', '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>');
  selProf.onchange = () => bulkApply(selProf.value ? { profileId: selProf.value } : null);
  $('#bulk-fav').onclick = () => bulkApply({ setFlag: ['favorite', true] });
  $('#bulk-rl').onclick = () => bulkApply({ setFlag: ['readLater', true] });
  $('#bulk-del').onclick = (ev) => confirm2(ev.target, 'Yakin? Klik lagi', async () => {
    await db.deleteBookmarks([...state.selected]);
    state.selected.clear();
    await afterWrite('Bookmark dihapus');
  });
}

async function bulkApply(patch) {
  if (!patch) return;
  const ids = [...state.selected];
  for (const id of ids) {
    const bm = state.bookmarks.find((b) => b.id === id);
    if (!bm) continue;
    if (patch.categoryId !== undefined) bm.categoryId = patch.categoryId;
    if (patch.profileId !== undefined) bm.profileId = patch.profileId;
    if (patch.setFlag) bm.flags[patch.setFlag[0]] = patch.setFlag[1];
    await db.updateBookmark(bm);
  }
  state.selected.clear();
  await afterWrite('Bulk action diterapkan');
}

async function afterWrite(msg) {
  await reload();
  renderAll();
  renderActiveView(); // view Kategori/Profil/Data yang sedang terbuka ikut segar
  broadcast('bookmarks-changed');
  if (msg) toast($('#toast-host'), msg);
}


// Kelompok kategori aktif untuk pemilih: Bawaan + Kategori saya. Bila profileId diisi,
// kategori buatan difilter ke milik profil itu + shared — sama dengan listCategories
// di popup/panel/web. Kategori nonaktif disembunyikan (openEditModal menyisipkan kembali
// kategori nonaktif yang sedang dipakai bookmark).
function catGroupsFor(profileId) {
  const picked = categoryPickerChoices(state.categories, state.settings.datasetEnabled);
  const custom = profileId
    ? picked.custom.filter((c) => c.profileId === profileId || c.profileId === 'shared')
    : picked.custom;
  const groups = [];
  if (picked.builtin.length) groups.push({ label: 'Bawaan', items: picked.builtin });
  if (custom.length) groups.push({ label: 'Kategori saya', items: custom });
  return groups;
}

// Dropdown kategori: tombol pemicu + popover (kotak cari + daftar scroll).
// Pengganti <select> yang memanjang tak terbatas saat kategori bertambah —
// dipakai toolbar tabel, bulk bar, modal edit, dan panel cepat (FAB).
function createCatPicker(opts) {
  const root = document.createElement('div');
  root.className = 'qm-cdd';
  root.innerHTML = '<button type="button" class="qm-cdd-btn">' +
    '<span class="qm-cdd-lab"></span><span class="qm-cdd-car">▾</span></button>' +
    '<div class="qm-cdd-pop"><input type="text" class="qm-cdd-search" placeholder="Cari kategori…">' +
    '<div class="qm-cdd-list"></div></div>';
  const lab = root.querySelector('.qm-cdd-lab');
  const pop = root.querySelector('.qm-cdd-pop');
  const search = root.querySelector('.qm-cdd-search');
  const list = root.querySelector('.qm-cdd-list');
  let value = opts.value || '';
  let emptyLabel = opts.emptyLabel || '(otomatis)';
  let groups = opts.groups || [];

  function setLabel() {
    if (value === '') { lab.textContent = emptyLabel; return; }
    for (const g of groups) {
      const c = g.items.find((x) => x.id === value);
      if (c) { lab.textContent = c.name + (c.tag ? ' ' + c.tag : ''); return; }
    }
    lab.textContent = emptyLabel;
  }

  function renderList(q) {
    const needle = (q || '').trim().toLowerCase();
    const hit = groups
      .map((g) => ({ label: g.label, items: g.items.filter((c) => !needle ||
        (c.name + ' ' + (c.tag || '')).toLowerCase().indexOf(needle) !== -1) }))
      .filter((g) => g.items.length);
    let html = '<button type="button" class="qm-cdd-item' + (value === '' ? ' sel' : '') +
      '" data-id="">' + escapeHtml(emptyLabel) + '</button>';
    if (needle && !hit.length) {
      html += '<div class="qm-cdd-empty">Tidak ada kategori yang cocok</div>';
    } else {
      html += hit.map((g) => '<div class="qm-cdd-group">' + escapeHtml(g.label) + '</div>' +
        g.items.map((c) =>
          '<button type="button" class="qm-cdd-item' + (c.id === value ? ' sel' : '') +
          '" data-id="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) +
          (c.tag ? ' <span class="qm-cdd-tag">' + escapeHtml(c.tag) + '</span>' : '') + '</button>'
        ).join('')).join('');
    }
    list.innerHTML = html;
    list.querySelectorAll('.qm-cdd-item').forEach((b) => {
      b.addEventListener('click', () => {
        value = b.dataset.id;
        setLabel();
        close();
        if (opts.onPick) opts.onPick(value);
      });
    });
  }

  function isOpen() { return pop.classList.contains('open'); }
  function open() {
    // Tutup picker lain yang masih terbuka (toolbar & bulk bar bisa tampil bersamaan).
    document.querySelectorAll('.qm-cdd-pop.open').forEach((p) => { if (p !== pop) p.classList.remove('open'); });
    search.value = '';
    renderList('');
    pop.classList.add('open');
    search.focus();
  }
  function close() { pop.classList.remove('open'); }

  root.querySelector('.qm-cdd-btn').addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (isOpen()) close(); else open();
  });
  search.addEventListener('input', () => renderList(search.value));
  search.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { close(); ev.stopPropagation(); } // jangan sampai ikut menutup panel/modal
    if (ev.key === 'Enter' && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault(); ev.stopPropagation();
      const first = list.querySelector('.qm-cdd-item');
      if (first) first.click();
    }
  });
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && isOpen()) { close(); ev.stopPropagation(); }
  });
  document.addEventListener('click', (ev) => {
    if (isOpen() && !root.contains(ev.target)) close();
  });
  setLabel();
  return {
    root,
    get value() { return value; },
    // Ganti isi daftar (mis. profil FAB berganti); value di-reset bila tak ada lagi di daftar.
    setGroups(g, empty) {
      groups = g;
      if (empty !== undefined) emptyLabel = empty;
      if (value && !groups.some((x) => x.items.some((c) => c.id === value))) value = '';
      setLabel();
    }
  };
}

// ---------- Edit modal ----------
function openEditModal(bm) {
  const host = $('#modal-host');
  host.innerHTML = '<div class="mg-modal-backdrop"><div class="mg-modal glass">' +
    '<h2>Edit bookmark</h2>' +
    '<div class="mg-row"><label>Judul</label><input id="em-title" type="text" value="' + escapeHtml(bm.title) + '"></div>' +
    '<div class="mg-row"><label>URL</label><input id="em-url" type="text" class="mono" value="' + escapeHtml(bm.url) + '"></div>' +
    '<div class="mg-row"><label>Catatan</label><input id="em-note" type="text" value="' + escapeHtml(bm.note || '') + '"></div>' +
    '<div class="mg-row"><label>Kategori</label><div id="em-cat-dd"></div></div>' +
    '<div class="mg-row"><label>Profil</label><select id="em-profile"></select></div>' +
    '<div class="mg-row"><label>Flag</label><label style="min-width:0"><input type="checkbox" id="em-fav" ' + (bm.flags.favorite ? 'checked' : '') + '> Favorit</label>' +
    '<label style="min-width:0"><input type="checkbox" id="em-rl" ' + (bm.flags.readLater ? 'checked' : '') + '> Baca nanti</label></div>' +
    '<div class="mg-row" style="justify-content:flex-end"><button id="em-cancel" class="qm-btn-ghost">Batal</button>' +
    '<button id="em-save" class="qm-btn-primary">Simpan</button></div></div></div>';
  const emGroups = catGroupsFor(bm.profileId);
  // Jaring pengaman: bookmark memakai kategori nonaktif → tetap disisipkan (grup sendiri)
  // agar kategori tidak diam-diam terlepas saat simpan.
  if (bm.categoryId && !emGroups.some((g) => g.items.some((c) => c.id === bm.categoryId))) {
    const off = state.catsById.get(bm.categoryId);
    if (off) emGroups.unshift({ label: 'Nonaktif', items: [{ id: off.id, name: off.name, tag: '(nonaktif)' }] });
  }
  const emCat = createCatPicker({ value: bm.categoryId || '', emptyLabel: '(tanpa kategori)', groups: emGroups });
  $('#em-cat-dd').appendChild(emCat.root);
  const selProf = $('#em-profile');
  for (const p of state.profiles) selProf.insertAdjacentHTML('beforeend', '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>');
  selProf.value = bm.profileId;
  $('#em-cancel').onclick = () => { host.innerHTML = ''; };
  $('#em-save').onclick = async () => {
    bm.title = $('#em-title').value.trim() || bm.title;
    const newUrl = $('#em-url').value.trim();
    bm.url = normalizeUrl(newUrl) || bm.url;
    bm.urlRaw = newUrl || bm.urlRaw;
    bm.note = $('#em-note').value.trim();
    bm.categoryId = emCat.value || null;
    bm.profileId = selProf.value;
    bm.flags.favorite = $('#em-fav').checked;
    bm.flags.readLater = $('#em-rl').checked;
    await db.updateBookmark(bm);
    host.innerHTML = '';
    await afterWrite('Bookmark diperbarui');
  };
}

// broadcast di-import di sini (ESM hoisting — legal di top-level module)
import { broadcast } from '../lib/ui.js';
import { classify, categoryChoices, categoryPickerChoices } from '../lib/categorizer.js';

// ---------- View: Kategori ----------
// Baris kategori (anak grup di view Kategori) — profil sudah tercantum di parent,
// jadi baris cukup menampilkan nama + jumlah bookmark + status.
function catRowHtml(c, n) {
  const on = c.enabled !== false;
  return '<div class="mg-list-row" data-id="' + c.id + '">' +
    '<span class="mg-cat-dot" style="background:' + c.color + '"></span>' +
    '<div class="grow"><b>' + escapeHtml(c.name) + '</b>' +
    (c.builtin ? ' <span class="mg-muted">bawaan</span>' : '') +
    ' <span class="mg-muted">' + n + ' bookmark</span>' +
    (on ? '' : ' <span class="mg-tag-off">nonaktif</span>') + '</div>' +
    '<label class="mg-cat-enable" title="Nonaktif = disembunyikan dari semua pemilih kategori; bookmark yang memakainya tetap utuh"><input type="checkbox" class="cat-enabled" ' + (on ? 'checked' : '') + '> aktif</label>' +
    '<button class="qm-btn-ghost cat-edit">Edit</button>' +
    '<button class="qm-btn-danger cat-del">Hapus</button></div>';
}

function renderCategories() {
  const v = $('#view-categories');
  const profSel = '<select id="cat-profile">' +
    '<option value="shared">Shared (semua profil)</option>' +
    state.profiles.map((p) => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join('') +
    '</select>';
  v.innerHTML = '<h1>Kategori</h1>' +
    '<div class="mg-sub">Kategori manual + dataset bawaan. Bawaan dikelola on/off di Pengaturan. ' +
    'Checkbox aktif menyembunyikan kategori dari semua pemilih tanpa menghapusnya.</div>' +
    '<div class="mg-card glass"><h2>Tambah kategori</h2>' +
    '<div class="mg-row"><label>Nama</label><input id="cat-name" type="text" placeholder="mis. Resep"></div>' +
    '<div class="mg-row"><label>Warna</label><input id="cat-color" type="color" value="#5eead4" style="width:50px;height:32px;padding:2px">' +
    '<label style="min-width:0">Milik</label>' + profSel +
    '<button id="cat-add" class="qm-btn-primary">Tambah</button></div></div>' +
    '<div class="mg-card glass"><div class="mg-toolbar" style="margin-bottom:0">' +
    '<input id="cat-q" type="text" placeholder="Cari kategori…">' +
    '<select id="cat-prof"><option value="*">Semua profil</option>' +
    state.profiles.map((p) => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join('') +
    '</select>' +
    '<button id="cat-expand" class="qm-btn-ghost">Buka semua</button>' +
    '<button id="cat-collapse" class="qm-btn-ghost">Tutup semua</button></div></div>' +
    '<div id="cat-groups"></div>';
  $('#cat-add').onclick = async () => {
    const name = $('#cat-name').value.trim();
    if (!name) return;
    const id = 'cat_' + uid().slice(0, 8);
    await db.addCategory({
      id, profileId: $('#cat-profile').value, name,
      color: $('#cat-color').value, icon: 'tool', order: 100, builtin: false
    });
    await afterWrite('Kategori ditambahkan');
  };
  $('#cat-q').addEventListener('input', renderCatGroups);
  $('#cat-prof').onchange = renderCatGroups;
  $('#cat-expand').onclick = async () => {
    state.catOpen = new Set(['shared', ...state.profiles.map((p) => p.id)]);
    await saveTreeOpen('qmCatOpen', state.catOpen);
    renderCatGroups();
  };
  $('#cat-collapse').onclick = async () => {
    state.catOpen.clear();
    await saveTreeOpen('qmCatOpen', state.catOpen);
    renderCatGroups();
  };
  renderCatGroups();
}

// Persist status buka-tutup grup (view Kategori & hierarki Bookmark) — chrome.storage.local.
async function saveTreeOpen(storageKey, set) {
  try { await chrome.storage.local.set({ [storageKey]: [...set] }); } catch (e) {}
}
async function loadTreeOpen(storageKey, set) {
  try {
    const out = await chrome.storage.local.get(storageKey);
    const arr = out && out[storageKey];
    if (Array.isArray(arr)) { set.clear(); for (const k of arr) set.add(k); }
  } catch (e) {}
}
// Semua key grup hierarki Bookmark (p:profil + c:profil|kategori) — untuk "Buka semua".
function bmTreeAllKeys() {
  const keys = state.profiles.map((p) => 'p:' + p.id);
  for (const bm of state.bookmarks) keys.push('c:' + (bm.profileId || '') + '|' + (bm.categoryId || ''));
  return keys;
}

// Daftar kategori bergrup: parent = profil (klik buka/tutup), anak = kategori profil itu,
// plus grup Shared di atas. Filter cari nama & profil — filter aktif → grup hasil terbuka.
function renderCatGroups() {
  const host = $('#cat-groups');
  if (!host) return;
  const q = ($('#cat-q').value || '').trim().toLowerCase();
  const prof = $('#cat-prof').value;
  const counts = {};
  for (const b of state.bookmarks) counts[b.categoryId] = (counts[b.categoryId] || 0) + 1;
  const filtered = state.categories.filter((c) => !q || c.name.toLowerCase().indexOf(q) !== -1);
  // Urutan grup: Shared dulu (dipakai semua profil), lalu tiap profil sesuai daftar profil.
  const groups = [{ key: 'shared', name: 'Shared (semua profil)', cats: filtered.filter((c) => c.profileId === 'shared') }];
  for (const p of state.profiles) {
    if (prof === '*' || prof === p.id) {
      groups.push({ key: p.id, name: p.name, cats: filtered.filter((c) => c.profileId === p.id) });
    }
  }
  const forceOpen = q !== '' || prof !== '*';
  // Satu kartu, barisan DATAR: tiap parent profil = baris sendiri (div head ditutup),
  // anak-anaknya menjorok di bawah parentnya — grup tidak pernah tersarang di grup lain.
  host.innerHTML = '<div class="mg-card glass">' + groups.map((g) => {
    const open = forceOpen || state.catOpen.has(g.key);
    const rows = g.cats.map((c) => catRowHtml(c, counts[c.id] || 0)).join('');
    return '<div class="mg-cat-head" data-key="' + g.key + '">' +
      '<span class="mg-cat-chev' + (open ? ' open' : '') + '">▸</span>' +
      '<b>' + escapeHtml(g.name) + '</b>' +
      '<span class="mg-muted">' + g.cats.length + ' kategori</span></div>' +
      (open ? '<div class="mg-cat-body">' +
        (rows || '<div class="mg-muted mg-cat-empty">Tidak ada kategori yang cocok.</div>') + '</div>' : '');
  }).join('') + '</div>';
  host.querySelectorAll('.mg-cat-head').forEach((h) => {
    h.addEventListener('click', () => {
      const key = h.dataset.key;
      if (state.catOpen.has(key)) state.catOpen.delete(key); else state.catOpen.add(key);
      saveTreeOpen('qmCatOpen', state.catOpen); // persist — refresh tetap ingat
      renderCatGroups();
    });
  });
}

// Toggle aktif kategori (checkbox di view Kategori) — nonaktif = hilang dari semua pemilih
// (popup, panel, panel cepat web, dropdown manager), bookmark yang memakainya tetap utuh.
document.addEventListener('change', async (ev) => {
  const cb = ev.target.closest('.cat-enabled');
  if (!cb) return;
  const id = cb.closest('[data-id]').dataset.id;
  const c = state.categories.find((x) => x.id === id);
  if (!c) return;
  c.enabled = cb.checked;
  await db.updateCategory(c);
  afterWrite(cb.checked
    ? 'Kategori diaktifkan'
    : 'Kategori dinonaktifkan — tak muncul di pemilih, bookmark tetap utuh');
});

// Delegasi event tombol per baris (edit/hapus kategori & profil) — satu listener global.
document.addEventListener('click', async (ev) => {
  const editCat = ev.target.closest('.cat-edit');
  if (editCat) {
    const id = editCat.closest('[data-id]').dataset.id;
    const c = state.categories.find((x) => x.id === id);
    if (c) openCatModal(c);
    return;
  }
  const delCat = ev.target.closest('.cat-del');
  if (delCat) {
    const id = delCat.closest('[data-id]').dataset.id;
    confirm2(delCat, 'Yakin? Klik lagi', async () => {
      // Bookmark di kategori ini → tanpa kategori (tidak ikut terhapus).
      const inCat = state.bookmarks.filter((b) => b.categoryId === id);
      for (const b of inCat) { b.categoryId = null; await db.updateBookmark(b); }
      await db.deleteCategory(id);
      await afterWrite('Kategori dihapus (' + inCat.length + ' bookmark jadi tanpa kategori)');
    });
  }
});

// Modal edit kategori: nama + warna + milik (shared / profil) — pengganti prompt() rename.
// Pindah milik tidak mengubah bookmark yang memakainya; kategori hanya bisa jadi tak terlihat
// di profil baru bila dipindah ke profil lain.
function openCatModal(c) {
  const host = $('#modal-host');
  host.innerHTML = '<div class="mg-modal-backdrop"><div class="mg-modal glass">' +
    '<h2>Edit kategori</h2>' +
    '<div class="mg-row"><label>Nama</label><input id="cm-name" type="text" value="' + escapeHtml(c.name) + '"></div>' +
    '<div class="mg-row"><label>Warna</label><input id="cm-color" type="color" value="' + escapeHtml(c.color) + '" style="width:50px;height:32px;padding:2px"></div>' +
    '<div class="mg-row"><label>Milik</label><select id="cm-profile">' +
    '<option value="shared">Shared (semua profil)</option>' +
    state.profiles.map((p) => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join('') +
    '</select></div>' +
    '<div class="mg-row" style="justify-content:flex-end"><button id="cm-cancel" class="qm-btn-ghost">Batal</button>' +
    '<button id="cm-save" class="qm-btn-primary">Simpan</button></div></div></div>';
  $('#cm-profile').value = c.profileId;
  $('#cm-cancel').onclick = () => { host.innerHTML = ''; };
  $('#cm-save').onclick = async () => {
    const name = $('#cm-name').value.trim();
    if (!name) return;
    c.name = name;
    c.color = $('#cm-color').value;
    c.profileId = $('#cm-profile').value;
    await db.updateCategory(c);
    host.innerHTML = '';
    await afterWrite('Kategori diubah');
  };
}

// ---------- View: Profil ----------
async function renderProfiles() {
  const v = $('#view-profiles');
  const unlocked = await isUnlocked();
  const rows = state.profiles.map((p) => {
    const n = state.bookmarks.filter((b) => b.profileId === p.id).length;
    return '<div class="mg-list-row" data-id="' + p.id + '">' +
      '<span class="mg-cat-dot" style="background:' + p.color + '"></span>' +
      '<div class="grow"><b>' + escapeHtml(p.name) + '</b>' +
      (p.isDefault ? ' <span class="mg-muted">default</span>' : '') +
      (p.locked ? ' <span class="mg-muted">terkunci</span>' : '') +
      ' <span class="mg-muted">' + n + ' bookmark</span></div>' +
      (p.locked
        ? '<button class="qm-btn-ghost prof-unlockflag" title="Lepas status terkunci (sesi sedang terbuka)">Lepas kunci</button>'
        : '<button class="qm-btn-ghost prof-lock">Kunci</button>') +
      '<button class="qm-btn-ghost prof-rename">Rename</button>' +
      '<button class="qm-btn-danger prof-del">Hapus</button></div>';
  }).join('');
  // Profil terkunci yang sedang tersembunyi: baris tersamarkan (nama & jumlah tidak dibocorkan).
  const hidden = unlocked ? 0 : await hiddenLockedCount();
  const hiddenRows = hidden
    ? Array.from({ length: hidden }, () =>
      '<div class="mg-list-row"><span class="mg-cat-dot" style="background:#475569"></span>' +
      '<div class="grow"><b>Profil terkunci</b> <span class="mg-muted">nama &amp; jumlah disembunyikan</span></div>' +
      '<button class="qm-btn-ghost prof-unlock">Buka kunci</button></div>').join('')
    : '';
  v.innerHTML = '<h1>Profil</h1>' +
    '<div class="mg-sub">Konteks terpisah: bookmark, kategori non-shared, learning, dan statistik per profil. Profil aktif per jendela. Profil terkunci disembunyikan dari semua permukaan sampai dibuka dengan password (atur di Pengaturan > Privasi).</div>' +
    '<div class="mg-card glass"><h2>Tambah profil</h2>' +
    '<div class="mg-row"><label>Nama</label><input id="prof-name" type="text" placeholder="mis. Kantor"></div>' +
    '<div class="mg-row"><label>Warna aksen</label><input id="prof-color" type="color" value="#60a5fa" style="width:50px;height:32px;padding:2px">' +
    '<button id="prof-add" class="qm-btn-primary">Tambah</button></div></div>' +
    '<div class="mg-card glass">' + rows + hiddenRows + '</div>' +
    '<div class="mg-muted">Shortcut: Ctrl+Shift+K buka popup · Ctrl+Shift+S quick-save. Ubah di chrome://extensions/shortcuts.</div>';
  $('#prof-add').onclick = async () => {
    const name = $('#prof-name').value.trim();
    if (!name) return;
    await createProfile(name, $('#prof-color').value);
    await afterWrite('Profil ditambahkan');
  };
}

document.addEventListener('click', async (ev) => {
  const lk = ev.target.closest('.prof-lock');
  if (lk) {
    if (!(await hasPassword())) { toast($('#toast-host'), 'Atur password dulu di Pengaturan > Privasi'); return; }
    const id = lk.closest('[data-id]').dataset.id;
    try {
      await assertCanLock(id);
      const p = state.profiles.find((x) => x.id === id);
      await updateProfile({ ...p, locked: true });
      await afterWrite('Profil dikunci — tersembunyi sampai dibuka dengan password');
    } catch (e) {
      toast($('#toast-host'), e.message);
    }
    return;
  }
  const uf = ev.target.closest('.prof-unlockflag');
  if (uf) {
    // Sesi sedang terbuka (unlocked) — lepas status terkunci tanpa password lagi.
    const id = uf.closest('[data-id]').dataset.id;
    const p = state.profiles.find((x) => x.id === id);
    if (p) {
      await updateProfile({ ...p, locked: false });
      await afterWrite('Status terkunci dilepas');
    }
    return;
  }
  const un = ev.target.closest('.prof-unlock');
  if (un) {
    const pw = await askPassword({ title: 'Buka profil terkunci', confirmLabel: 'Buka' });
    if (pw == null) return;
    try {
      if (!(await verifyPassword(pw))) { toast($('#toast-host'), 'Password salah'); return; }
      await unlock(state.settings.lockAutoMin);
      // BroadcastChannel TIDAK mengirim ke context pengirim — reload manager sendiri
      // supaya profil terkunci langsung tampil tanpa refresh halaman.
      await refreshDerived();
    } catch (e) {
      toast($('#toast-host'), e.message);
    }
    return;
  }
  const rn = ev.target.closest('.prof-rename');
  if (rn) {
    const id = rn.closest('[data-id]').dataset.id;
    const p = state.profiles.find((x) => x.id === id);
    const name = prompt('Nama profil:', p.name);
    if (name && name.trim()) {
      p.name = name.trim();
      await updateProfile(p);
      await afterWrite('Profil diubah');
    }
    return;
  }
  const del = ev.target.closest('.prof-del');
  if (del) {
    const id = del.closest('[data-id]').dataset.id;
    confirm2(del, 'Yakin? Klik lagi', async () => {
      try {
        await deleteProfile(id);
        await afterWrite('Profil dihapus');
      } catch (e) {
        toast($('#toast-host'), e.message);
      }
    });
  }
});

// ---------- View: Statistik ----------
function renderStats() {
  const v = $('#view-stats');
  const total = state.bookmarks.length;
  const rl = state.bookmarks.filter((b) => b.flags && b.flags.readLater).length;
  const fav = state.bookmarks.filter((b) => b.flags && b.flags.favorite).length;
  const opened = state.bookmarks.reduce((s, b) => s + (b.openCount || 0), 0);
  // Per kategori
  const byCat = {};
  for (const b of state.bookmarks) {
    const k = b.categoryId || '(tanpa kategori)';
    byCat[k] = (byCat[k] || 0) + 1;
  }
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([id, n]) => {
    const c = state.catsById.get(id);
    const label = c ? c.name : (id === '(tanpa kategori)' ? id : id);
    const max = Math.max(...Object.values(byCat));
    const color = c ? c.color : 'var(--text-dim)';
    return '<div class="mg-bar-row"><div class="lb">' + escapeHtml(label) + '</div>' +
      '<div class="mg-bar-track"><div class="mg-bar-fill" style="width:' + (n / max * 100) + '%;background:' + color + '"></div></div>' +
      '<div class="n">' + n + '</div></div>';
  }).join('');
  // Terbaru & terbuka
  const recent = state.bookmarks.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  const top = state.bookmarks.filter((b) => b.openCount > 0).sort((a, b) => b.openCount - a.openCount).slice(0, 10);
  v.innerHTML = '<h1>Statistik</h1>' +
    '<div class="mg-sub">Dihitung on-demand saat view dibuka — tidak ada agregasi di background (PRD §3.8).</div>' +
    '<div class="mg-stats-grid">' +
    statCard(total, 'Total bookmark') + statCard(state.profiles.length, 'Profil') +
    statCard(state.categories.length, 'Kategori') + statCard(rl, 'Baca nanti') +
    statCard(fav, 'Favorit') + statCard(opened, 'Total dibuka') +
    '</div>' +
    '<div class="mg-card glass"><h2>Bookmark per kategori</h2>' + (catRows || '<span class="mg-muted">Belum ada data.</span>') + '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
    '<div class="mg-card glass"><h2>10 terbaru</h2>' + bmList(recent) + '</div>' +
    '<div class="mg-card glass"><h2>10 paling dibuka</h2>' + bmList(top) + '</div></div>';
}

function statCard(v, l) {
  return '<div class="mg-stat-card glass"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>';
}

function bmList(list) {
  if (!list.length) return '<span class="mg-muted">Belum ada data.</span>';
  return list.map((b) => '<div class="mg-list-row"><div class="grow">' + escapeHtml(b.title) +
    '<div class="mg-muted mono">' + escapeHtml(shortUrl(b.url)) + '</div></div>' +
    (b.openCount ? '<span class="mg-muted">' + b.openCount + 'x</span>' : '') +
    '</div>').join('');
}

function shortUrl(u) {
  try { const x = new URL(u); return x.host + (x.pathname === '/' ? '' : x.pathname); } catch (e) { return u; }
}

// ---------- View: Data & Backup ----------
function renderData() {
  const v = $('#view-data');
  const s = state.settings;
  v.innerHTML = '<h1>Data &amp; Backup</h1>' +
    '<div class="mg-sub">Semua data lokal di browser. Tidak ada yang dikirim keluar.</div>' +
    '<div class="mg-card glass"><h2>Import</h2>' +
    '<div class="mg-imp-sub">JSON QuickMark — pulihkan semua data</div>' +
    '<div class="mg-row"><label>File</label>' +
    '<input id="imp-qmfile" type="file" accept=".json" style="display:none">' +
    '<button id="imp-qmpick" class="qm-btn-ghost">Dari file JSON (semua profil)…</button>' +
    '<span class="mg-muted">Semua profil, kategori &amp; bookmark — menggantikan data saat ini.</span></div>' +
    '<div class="mg-imp-sub">HTML Netscape / bookmark native — per profil</div>' +
    '<div class="mg-row"><label>Profil tujuan</label><select id="imp-profile"></select></div>' +
    '<div class="mg-row"><label>Mode</label><select id="imp-mode"><option value="dedup">Lewatkan duplikat</option><option value="keep">Masukkan semua</option></select></div>' +
    '<div class="mg-row"><label>Sumber</label>' +
    '<input id="imp-file" type="file" accept=".html" style="display:none">' +
    '<button id="imp-native" class="qm-btn-ghost">Bookmark native browser</button>' +
    '<button id="imp-pick" class="qm-btn-ghost">Dari file HTML Netscape…</button><span id="imp-status" class="mg-muted"></span></div></div>' +
    '<div class="mg-card glass"><h2>Export</h2>' +
    '<div class="mg-row"><button id="exp-json" class="qm-btn-ghost">Export JSON (lengkap)</button>' +
    '<button id="exp-html" class="qm-btn-ghost">Export HTML Netscape</button></div></div>' +
    '<div class="mg-card glass"><h2>Dedup</h2>' +
    '<div class="mg-row"><button id="dedup-scan" class="qm-btn-ghost">Scan duplikat</button>' +
    '<button id="dedup-run" class="qm-btn-danger">Auto-dedup</button><span id="dedup-status" class="mg-muted"></span></div></div>' +
    '<div class="mg-card glass"><h2>Backup lokal</h2>' +
    '<div class="mg-row"><button id="bk-now" class="qm-btn-primary">Backup sekarang</button>' +
    '<button id="bk-clear" class="qm-btn-danger">Hapus semua</button><span id="bk-status" class="mg-muted"></span></div>' +
    '<div id="bk-list"></div>' +
    '<div class="mg-imp-sub">Data terkunci</div>' +
    '<div class="mg-row"><button id="bk-private" class="qm-btn-ghost">Export terenkripsi</button><span id="bk-priv-status" class="mg-muted"></span></div>' +
    '<div class="mg-row mg-muted">Profil terkunci TIDAK ikut backup lokal/export biasa — satu-satunya cadangannya file terenkripsi ini (terproteksi password, aman disimpan). Lupa password = isinya tidak bisa dibuka.</div>' +
    '<div class="mg-row mg-muted" style="margin-top:8px">Penamaan, mode, dan jumlah backup diatur di card <b>Pengaturan backup</b> di bawah.</div></div>' +
    '<div class="mg-card glass"><h2>Pengaturan backup</h2>' +
    '<div class="mg-sub">Satu sumber pengaturan untuk backup lokal dan cloud (bila aktif).</div>' +
    '<div class="mg-row"><label>Mode penyimpanan</label><select id="bk-mode">' +
    '<option value="multi"' + (s.backupMode !== 'single' ? ' selected' : '') + '>File baru (ber-timestamp, ada riwayat)</option>' +
    '<option value="single"' + (s.backupMode === 'single' ? ' selected' : '') + '>File tunggal (1 file, diganti tiap backup)</option></select></div>' +
    '<div class="mg-row"><label>Nama file</label><input id="bk-name" type="text" value="' + escapeHtml(sanitizeBackupName(s.backupName)) + '">' +
    '<span class="mg-muted">Contoh: <span class="mono" id="bk-prev"></span></span></div>' +
    '<div class="mg-row"><label>Sisakan file</label><input id="bk-keep" type="number" min="1" max="50" value="' + (s.backupKeep || 5) + '" ' + (s.backupMode === 'single' ? 'disabled' : '') + '>' +
    '<span class="mg-muted">Backup terbaru yang dipertahankan — hanya berlaku mode file baru</span></div></div>' +
    // Card Google Drive hanya dirender bila fitur diaktifkan. Saat DRIVE_ENABLED=false
    // tidak ada satu pun elemen Drive di DOM (bukan sekadar disabled).
    (DRIVE_ENABLED ?
      '<div class="mg-card glass"><h2>Google Drive</h2>' +
      '<div class="mg-imp-sub">Koneksi</div>' +
      '<div class="mg-row"><label>Akun</label>' +
      '<button id="dr-connect" class="qm-btn-primary">Hubungkan Google Drive</button>' +
      '<button id="dr-disconnect" class="qm-btn-ghost" hidden>Putuskan</button>' +
      '<button id="dr-upload" class="qm-btn-ghost">Backup ke Drive</button>' +
      '<span id="dr-status" class="mg-muted"></span></div>' +
      '<div class="mg-row"><label>Auto harian</label>' +
      '<input type="checkbox" id="dr-auto"' + (s.backupToDrive ? ' checked' : '') + '> ' +
      '<span class="mg-muted">Alarm backup harian ikut mengirim ke Drive (butuh koneksi aktif)</span></div>' +
      '<div class="mg-imp-sub">File di Drive</div>' +
      '<div class="mg-row"><label>Daftar</label><button id="dr-refresh" class="qm-btn-ghost">Muat daftar</button>' +
      '<button id="dr-clear" class="qm-btn-danger">Hapus semua</button><span class="mg-muted">Restore menimpa semua data — konfirmasi dulu</span></div>' +
      '<div id="dr-list"></div></div>' : '');
  fillImportSelects();
  bindDataEvents(v);
  refreshBackupList();
}

function fillImportSelects() {
  const sel = $('#imp-profile');
  for (const p of state.profiles) sel.insertAdjacentHTML('beforeend', '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>');
}

function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function bindDataEvents(v) { // async: blok Drive memuat modulnya via dynamic import
  $('#imp-native').onclick = async () => {
    $('#imp-status').textContent = 'Mengimport…';
    const r = await importNative($('#imp-profile').value, $('#imp-mode').value);
    $('#imp-status').textContent = r.added + ' ditambah, ' + r.skipped + ' dilewati, ' + r.invalid + ' invalid';
    await afterWrite(null);
  };
  // File JSON QuickMark = snapshot penuh (semua profil) — TANPA memilih profil; konfirmasi karena menggantikan data.
  $('#imp-qmpick').onclick = () => $('#imp-qmfile').click();
  $('#imp-qmfile').onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const text = await file.text();
    // File terenkripsi (jalur data terkunci): password, dekrip, GANTI data terkunci saja.
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}
    if (isEncryptedFile(parsed)) {
      const pw = await askPassword({ title: 'Password file terenkripsi', confirmLabel: 'Buka' });
      if (pw != null) {
        try {
          const data = await decryptExport(pw, parsed);
          confirm2($('#imp-qmpick'), 'Ganti data terkunci? Klik lagi', async () => {
            try {
              const r = await applyLockedImport(data);
              $('#imp-status').textContent = 'Data terkunci dipulihkan: ' + r.profiles + ' profil, ' + r.bookmarks + ' bookmark';
              await afterWrite(null);
            } catch (e) {
              $('#imp-status').textContent = 'Gagal: ' + e.message;
            }
          });
        } catch (e) {
          $('#imp-status').textContent = 'Gagal: ' + e.message;
        }
      }
      ev.target.value = '';
      return;
    }
    confirm2($('#imp-qmpick'), 'Ganti SEMUA data? Data terkunci ikut terhapus! Klik lagi', async () => {
      try {
        const data = parseQuickmarkJson(text);
        await applyImportData(data);
        $('#imp-status').textContent = 'Dipulihkan: ' + (data.profiles || []).length + ' profil, ' + data.bookmarks.length + ' bookmark';
        await afterWrite(null);
      } catch (e) {
        $('#imp-status').textContent = 'Gagal: ' + e.message;
      }
      ev.target.value = '';
    });
  };
  // HTML Netscape / native browser: item mentah per profil — di sini profil tujuan & mode relevan.
  $('#imp-pick').onclick = () => $('#imp-file').click();
  $('#imp-file').onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const items = parseNetscapeHtml(text);
      const r = await importItems(items, $('#imp-profile').value, $('#imp-mode').value);
      $('#imp-status').textContent = r.added + ' ditambah, ' + r.skipped + ' dilewati, ' + r.invalid + ' invalid';
      await afterWrite(null);
    } catch (e) {
      $('#imp-status').textContent = 'Gagal: ' + e.message;
    }
    ev.target.value = '';
  };
  $('#exp-json').onclick = async () => {
    download(backupFileName(state.settings.backupName), await exportJSON(), 'application/json');
  };
  $('#exp-html').onclick = async () => {
    const all = await filterVisibleBookmarks(await db.getAll('bookmarks'));
    download(backupFileName(state.settings.backupName, Date.now(), '.html'), bookmarksToNetscape(state.profiles, all, state.catsById), 'text/html');
  };
  $('#dedup-scan').onclick = async () => {
    const groups = await runDedup('report');
    $('#dedup-status').textContent = groups.length ? groups.length + ' grup duplikat ditemukan' : 'Tidak ada duplikat';
  };
  $('#dedup-run').onclick = (ev) => confirm2(ev.target, 'Yakin? Klik lagi', async () => {
    const r = await runDedup('auto');
    $('#dedup-status').textContent = r.removed + ' duplikat dihapus (' + r.groups + ' grup)';
    await afterWrite(null);
  });
  $('#bk-now').onclick = async () => {
    const key = await createBackup();
    $('#bk-status').textContent = 'Backup dibuat: ' + key.split(':')[1];
    refreshBackupList();
  };
  $('#bk-clear').onclick = (ev) => confirm2(ev.target, 'Hapus SEMUA backup lokal? Klik lagi', async () => {
    const n = await clearBackups();
    $('#bk-status').textContent = n + ' backup lokal dihapus';
    refreshBackupList();
  });
  $('#bk-private').onclick = async () => {
    let data;
    try { data = await exportLockedData(); } catch (e) { $('#bk-priv-status').textContent = 'Gagal: ' + e.message; return; }
    if (!data) { $('#bk-priv-status').textContent = 'Tidak ada profil terkunci.'; return; }
    const pw = await askPassword({ title: 'Password untuk mengenkripsi file', confirmLabel: 'Enkripsi' });
    if (pw == null) return;
    try {
      const file = await encryptExport(pw, data);
      download(backupFileName(state.settings.backupName + '-private'), JSON.stringify(file, null, 2), 'application/json');
      $('#bk-priv-status').textContent = 'File terenkripsi diunduh (' + data.profiles.length + ' profil terkunci)';
    } catch (e) {
      $('#bk-priv-status').textContent = 'Gagal: ' + e.message;
    }
  };
  // Pengaturan backup — satu sumber setting backupMode/backupName/backupKeep (lokal & cloud).
  const bkPrev = () => { $('#bk-prev').textContent = backupFileName($('#bk-name').value, Date.now()); };
  bkPrev();
  $('#bk-name').addEventListener('input', bkPrev);
  $('#bk-name').onchange = async (ev) => {
    const name = sanitizeBackupName(ev.target.value);
    ev.target.value = name;
    bkPrev();
    await saveSetting({ backupName: name }, 'Nama file backup');
  };
  $('#bk-mode').onchange = async (ev) => {
    await saveSetting({ backupMode: ev.target.value }, 'Mode penyimpanan backup');
    $('#bk-keep').disabled = ev.target.value === 'single';
  };
  $('#bk-keep').onchange = async (ev) => {
    const keep = Math.max(1, Math.min(50, parseInt(ev.target.value, 10) || 5));
    ev.target.value = keep;
    await saveSetting({ backupKeep: keep }, 'Jumlah backup disimpan');
  };
  // ---------- Google Drive: NONAKTIF ----------
  // Card Drive tidak dirender sama sekali dan seluruh handler di bawah tidak dipasang.
  // Modul lib/drive.js hanya dimuat via dynamic import bila fitur dihidupkan kembali.
  if (DRIVE_ENABLED) {
  const { isConfigured, getToken, disconnect: driveDisconnect, uploadBackup, listCloudBackups,
    deleteCloudBackup, deleteAllCloudBackups, restoreCloudBackup } = await import('../lib/drive.js');
  const setConnUi = (connected) => {
    $('#dr-connect').hidden = connected;
    $('#dr-disconnect').hidden = !connected;
    $('#dr-upload').hidden = !connected;
  };
  $('#dr-connect').onclick = async () => {
    if (!isConfigured()) { toast($('#toast-host'), 'Isi oauth2.client_id dulu — lihat docs/SETUP-DRIVE.md'); return; }
    $('#dr-status').textContent = 'Menghubungkan…';
    try {
      await getToken(true);
      $('#dr-status').textContent = 'Terhubung';
      setConnUi(true);
      refreshDriveList();
    } catch (e) {
      $('#dr-status').textContent = 'Gagal: ' + e.message;
    }
  };
  $('#dr-disconnect').onclick = async () => {
    await driveDisconnect();
    $('#dr-status').textContent = 'Terputus';
    setConnUi(false);
    $('#dr-list').innerHTML = '';
  };
  $('#dr-upload').onclick = async (ev) => {
    const btn = ev.target;
    btn.disabled = true;
    $('#dr-status').textContent = 'Mengunggah…';
    try {
      await getToken(true);
      const r = await uploadBackup();
      $('#dr-status').textContent = 'Terunggah: ' + r.name + (r.removed ? ' (' + r.removed + ' file lama dirotasi)' : '');
      refreshDriveList();
    } catch (e) {
      $('#dr-status').textContent = 'Gagal: ' + e.message;
    }
    btn.disabled = false;
  };
  $('#dr-auto').onchange = async (ev) => {
    await saveSetting({ backupToDrive: ev.target.checked }, 'Auto backup ke Drive');
  };
  $('#dr-refresh').onclick = () => refreshDriveList();
  $('#dr-clear').onclick = (ev) => confirm2(ev.target, 'Hapus SEMUA file di Drive? Klik lagi', async () => {
    $('#dr-status').textContent = 'Menghapus…';
    try {
      const n = await deleteAllCloudBackups();
      $('#dr-status').textContent = n + ' file dihapus dari Drive';
      refreshDriveList();
    } catch (e) {
      $('#dr-status').textContent = 'Gagal: ' + e.message;
    }
  });

  async function refreshDriveList() {
    const host = $('#dr-list');
    try {
      const files = await listCloudBackups();
      if (!files.length) { host.innerHTML = '<span class="mg-muted">Belum ada backup di Drive.</span>'; return; }
      host.innerHTML = files.map((f) => {
        const kb = f.size ? Math.round(Number(f.size) / 1024) + ' KB' : '';
        return '<div class="mg-list-row" data-id="' + f.id + '"><div class="grow">' + escapeHtml(f.name) +
          (kb ? ' <span class="mg-muted">' + kb + '</span>' : '') + '</div>' +
          '<button class="qm-btn-ghost dr-restore">Restore</button>' +
          '<button class="qm-btn-danger dr-del">Hapus</button></div>';
      }).join('');
      host.querySelectorAll('.mg-list-row').forEach((row) => {
        const id = row.dataset.id;
        row.querySelector('.dr-restore').onclick = (ev) => confirm2(ev.target, 'Timpa SEMUA data? Data terkunci ikut terhapus! Klik lagi', async () => {
          const r = await restoreCloudBackup(id);
          toast($('#toast-host'), 'Restored: ' + r.bookmarks + ' bookmark');
          await afterWrite(null);
        });
        row.querySelector('.dr-del').onclick = (ev) => confirm2(ev.target, 'Hapus file ini dari Drive? Klik lagi', async () => {
          await deleteCloudBackup(id);
          refreshDriveList();
        });
      });
    } catch (e) {
      host.innerHTML = '<span class="mg-muted">Gagal memuat: ' + escapeHtml(e.message) + '</span>';
    }
  }

  // Status koneksi awal (non-blocking): terhubung bila token bisa didapat tanpa prompt.
  (async () => {
    if (!isConfigured()) {
      $('#dr-status').textContent = 'OAuth client ID belum diisi — lihat docs/SETUP-DRIVE.md';
      return;
    }
    try {
      await getToken(false);
      $('#dr-status').textContent = 'Terhubung';
      setConnUi(true);
      refreshDriveList();
    } catch (e) {
      $('#dr-status').textContent = 'Belum terhubung — klik Hubungkan Google Drive';
    }
  })();
  }
}

async function refreshBackupList() {
  const keys = await listBackups();
  const host = $('#bk-list');
  if (!keys.length) { host.innerHTML = '<span class="mg-muted">Belum ada backup.</span>'; return; }
  host.innerHTML = keys.map((k) => {
    const label = k.replace('qmBackup:', '');
    return '<div class="mg-list-row" data-key="' + k + '"><div class="grow">' + escapeHtml(label) + '</div>' +
      '<button class="qm-btn-ghost bk-restore">Restore</button>' +
      '<button class="qm-btn-danger bk-del">Hapus</button></div>';
  }).join('');
  host.querySelectorAll('.bk-restore').forEach((btn) => {
    btn.onclick = (ev) => confirm2(ev.target, 'Timpa SEMUA data? Data terkunci ikut terhapus! Klik lagi', async () => {
      const key = btn.closest('[data-key]').dataset.key;
      const r = await restoreBackup(key);
      toast($('#toast-host'), 'Restored: ' + r.bookmarks + ' bookmark');
      await afterWrite(null);
    });
  });
  host.querySelectorAll('.bk-del').forEach((btn) => {
    btn.onclick = (ev) => confirm2(ev.target, 'Hapus backup ini? Klik lagi', async () => {
      await deleteBackup(btn.closest('[data-key]').dataset.key);
      refreshBackupList();
    });
  });
}

function applyImportData(data) {
  // Dipanggil dari import JSON file — sama dengan applyImportJson di io.js (di-import dinamis).
  return import('./io.js').then((io) => io.applyImportJson(data));
}

// ---------- View: Pengaturan ----------
async function renderSettings() {
  const v = $('#view-settings');
  const s = state.settings;
  const catRows = builtinCategoryRows(s);
  const hasPw = await hasPassword();
  v.innerHTML = '<h1>Pengaturan</h1>' +
    '<div class="mg-sub">Semua perubahan tersimpan otomatis (auto-save) — tanpa tombol Save.</div>' +
    '<div class="mg-card glass"><h2>Umum</h2>' +
    '<div class="mg-row"><label>Tema</label><select id="st-theme">' +
    themeOptions(s.theme) + '</select></div>' +
    '<div class="mg-row"><label>Profil default</label><select id="st-defprofile"></select></div>' +
    '<div class="mg-row"><label>Tampilan Bookmark</label><select id="st-bmview">' +
    '<option value="table"' + (s.bookmarkView !== 'tree' ? ' selected' : '') + '>Tabel (bawaan)</option>' +
    '<option value="tree"' + (s.bookmarkView === 'tree' ? ' selected' : '') + '>Hierarki (profil → bookmark)</option>' +
    '</select><span class="mg-muted">Tampilan awal menu Bookmark — toggle di toolbar juga tersimpan</span></div>' +
    '<div class="mg-row"><label>Favicon</label><select id="st-favicon">' +
    '<option value="cache">Cache lokal (offline-first)</option>' +
    '<option value="online">Online (Google s2)</option>' +
    '<option value="letter">Ikon huruf</option></select></div>' +
    '<div class="mg-row"><label>Panel cepat</label><select id="st-fabmode">' +
    '<option value="corner"' + (s.quickPanelMode !== 'free' ? ' selected' : '') + '>Diam di pojok kanan bawah</option>' +
    '<option value="free"' + (s.quickPanelMode === 'free' ? ' selected' : '') + '>Bebas digeser</option>' +
    '</select><span class="mg-muted">FAB + panel tambah cepat di manager</span></div>' +
    '<div class="mg-row"><label>Di halaman web</label>' +
    '<input type="checkbox" id="st-qpsites" ' + (s.quickPanelSites !== false ? 'checked' : '') + '> ' +
    '<span class="mg-muted">Tampilkan panel cepat (FAB) di semua halaman web — refresh halaman untuk terlihat</span></div>' +
    '<div class="mg-row"><label>Mirror ke bookmark native</label>' +
    '<input type="checkbox" id="st-mirror" ' + (s.mirrorNative ? 'checked' : '') + '> ' +
    '<span class="mg-muted">Tiap save juga ditulis ke folder "QuickMark Pro" di bookmark browser</span></div></div>' +
    '<div class="mg-card glass"><h2>Privasi — profil terkunci</h2>' +
    '<div class="mg-row"><label>Password</label>' +
    '<input id="st-pw-old" type="password" placeholder="Password lama" ' + (hasPw ? '' : 'disabled title="Belum ada password"') + '>' +
    '<input id="st-pw-new" type="password" placeholder="Password baru (min 4)">' +
    '<input id="st-pw-new2" type="password" placeholder="Ulangi baru">' +
    '<button id="st-pw-save" class="qm-btn-primary">' + (hasPw ? 'Ganti' : 'Set') + '</button>' +
    '<span id="st-pw-status" class="mg-muted"></span></div>' +
    '<div class="mg-row"><label>Durasi tampil</label><select id="st-lockmin">' + lockMinOptions(s.lockAutoMin) + '</select>' +
    '<span class="mg-muted">Berapa lama profil terkunci tampil setelah dibuka kuncinya</span></div>' +
    '<div class="mg-row"><label>Sesi</label><button id="st-locknow" class="qm-btn-ghost">Kunci sekarang</button>' +
    '<button id="st-pw-remove" class="qm-btn-danger">Hapus password</button>' +
    '<span class="mg-muted">Hapus password juga melepas semua status terkunci</span></div>' +
    '<div class="mg-row mg-muted">Peringatan: lupa password = profil terkunci tidak bisa dibuka (tanpa reset). ' +
    'Data terkunci TIDAK ikut backup lokal/export biasa — cadangannya hanya "Export terenkripsi" di Data &amp; Backup.</div></div>' +
    '<div class="mg-card glass"><h2>Dataset kategori bawaan</h2><div class="mg-dataset-grid">' + catRows + '</div></div>' +
    '<div class="mg-card glass"><h2>Shortcut keyboard</h2>' +
    '<div class="mg-row mg-muted">Ctrl+Shift+K — buka popup · Ctrl+Shift+S — quick-save · omnibox: ketik <b>qm &lt;query&gt;</b> di address bar.<br>' +
    'Ubah di <span class="mono">chrome://extensions/shortcuts</span> (Edge: <span class="mono">edge://extensions/shortcuts</span>).</div></div>' +
    '<div class="mg-card glass"><h2>Zona bahaya</h2>' +
    '<div class="mg-row"><button id="st-wipe" class="qm-btn-danger">Hapus SEMUA data</button>' +
    '<span class="mg-muted">Bookmark, kategori, profil, learning — permanen. Backup dulu!</span></div></div>';
  fillSettingsSelects(s);
  bindSettingsEvents(v);
}

function themeOptions(t) {
  return [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']]
    .map(([v, l]) => '<option value="' + v + '"' + (t === v ? ' selected' : '') + '>' + l + '</option>').join('');
}

function lockMinOptions(v) {
  const opts = [
    [15, '15 menit (default)'], [1, '1 menit'], [5, '5 menit'], [30, '30 menit'], [60, '60 menit'],
    ['browser', 'Sampai browser ditutup'], ['manual', 'Tampil terus sampai dikunci manual']
  ];
  return opts.map(([val, l]) =>
    '<option value="' + val + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + l + '</option>').join('');
}

function builtinCategoryRows(s) {
  const DATASET_IDS = ['dev', 'design', 'social', 'shop', 'news', 'entertainment', 'learning', 'productivity', 'finance', 'travel', 'game', 'gov', 'tools'];
  const names = { dev: 'Dev', design: 'Desain', social: 'Sosial Media', shop: 'Belanja', news: 'Berita', entertainment: 'Hiburan', learning: 'Belajar', productivity: 'Produktivitas', finance: 'Keuangan', travel: 'Travel', game: 'Game', gov: 'Pemerintahan', tools: 'Tools Web' };
  return DATASET_IDS.map((id) => {
    const on = s.datasetEnabled[id] !== false;
    return '<div class="ds-item"><span>' + escapeHtml(names[id] || id) + '</span>' +
      '<input type="checkbox" class="st-dataset" data-id="' + id + '" ' + (on ? 'checked' : '') + '></div>';
  }).join('');
}

async function fillSettingsSelects(s) {
  const sel = $('#st-defprofile');
  sel.innerHTML = '<option value="">(profil isDefault)</option>';
  for (const p of state.profiles) {
    sel.insertAdjacentHTML('beforeend', '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>');
  }
  sel.value = s.defaultProfileId || '';
}

function bindSettingsEvents(v) {
  $('#st-theme').onchange = async (ev) => {
    const st = await saveSetting({ theme: ev.target.value }, 'Tema');
    if (st) applyTheme(st.theme);
  };
  $('#st-defprofile').onchange = (ev) => saveSetting({ defaultProfileId: ev.target.value || null }, 'Profil default');
  $('#st-bmview').onchange = (ev) => saveSetting({ bookmarkView: ev.target.value }, 'Tampilan bookmark');
  $('#st-favicon').onchange = async (ev) => { await saveSetting({ faviconMode: ev.target.value }, 'Mode favicon'); renderAll(); };
  $('#st-fabmode').onchange = async (ev) => {
    await saveSetting({ quickPanelMode: ev.target.value }, 'Mode panel cepat');
    initQuickPanelPosFromSettings();
  };
  $('#st-qpsites').onchange = (ev) => saveSetting({ quickPanelSites: ev.target.checked }, 'Panel cepat di halaman web');
  $('#st-mirror').onchange = (ev) => saveSetting({ mirrorNative: ev.target.checked }, 'Mirror ke bookmark native');
  v.querySelectorAll('.st-dataset').forEach((cb) => {
    cb.onchange = async () => {
      const de = { ...state.settings.datasetEnabled, [cb.dataset.id]: cb.checked };
      await saveSetting({ datasetEnabled: de }, 'Dataset kategori bawaan');
      await refreshDerived(); // grup dropdown & chips kategori langsung ikut
    };
  });
  // Privasi — profil terkunci.
  $('#st-pw-save').onclick = async () => {
    const nw = $('#st-pw-new').value;
    const nw2 = $('#st-pw-new2').value;
    if (nw !== nw2) { $('#st-pw-status').textContent = 'Konfirmasi password tidak sama'; return; }
    try {
      await setPassword(nw, $('#st-pw-old').value || undefined);
      await refreshDerived();
      toast($('#toast-host'), 'Password tersimpan');
    } catch (e) {
      $('#st-pw-status').textContent = e.message;
    }
  };
  $('#st-lockmin').onchange = async (ev) => {
    const v = ev.target.value;
    await saveSetting({ lockAutoMin: /^\d+$/.test(v) ? Number(v) : v }, 'Durasi tampil profil terkunci');
  };
  $('#st-locknow').onclick = async () => {
    await lockNow();
    await afterWrite(null); // broadcast memicu reload — profil terkunci disembunyikan lagi
  };
  $('#st-pw-remove').onclick = (ev) => confirm2(ev.target, 'Hapus password? Klik lagi', async () => {
    const pw = await askPassword({ title: 'Konfirmasi password untuk menghapus', confirmLabel: 'Hapus' });
    if (pw == null) return;
    try {
      await removePassword(pw);
      await afterWrite('Password dihapus — semua profil tidak lagi terkunci');
    } catch (e) {
      toast($('#toast-host'), e.message);
    }
  });
  $('#st-wipe').onclick = (ev) => confirm2(ev.target, 'HAPUS SEMUA? Klik lagi', async () => {
    await db.clearStore('bookmarks');
    await db.clearStore('categories');
    await db.clearStore('learning');
    // Profil: sisakan default — ambil dari db langsung supaya profil TERKUNCI (tidak ada di
    // state.profiles yang tersaring) ikut terhapus; wipe harus benar-benar menyeluruh.
    const allProfiles = await db.getAll('profiles');
    const keep = allProfiles.find((p) => p.isDefault);
    for (const p of allProfiles) {
      if (!keep || p.id !== keep.id) await db.remove('profiles', p.id);
    }
    await afterWrite('Semua data dihapus');
  });
}

// ---------- Panel cepat (FAB mengambang, PRD §3.10) ----------
// Mode 'corner': diam di pojok kanan bawah. Mode 'free': bebas digeser,
// posisi tersimpan di chrome.storage.local. Klik = buka panel; drag > 6px = pindah.
const FAB_POS_KEY = 'quickPanelPos';
let fabDragging = false;

async function initQuickPanel() {
  const fab = $('#fab');
  const mode = state.settings.quickPanelMode || 'corner';
  if (mode === 'free') await applySavedFabPos(fab);
  bindFabDrag(fab);
  fab.addEventListener('click', () => {
    if (fabDragging) return; // drag berakhir dengan click event — jangan buka panel
    toggleFabPanel();
  });
}

async function applySavedFabPos(fab) {
  const out = await chrome.storage.local.get(FAB_POS_KEY);
  const pos = out[FAB_POS_KEY];
  if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
    fab.style.left = Math.max(0, Math.min(window.innerWidth - fab.offsetWidth, pos.x)) + 'px';
    fab.style.top = Math.max(0, Math.min(window.innerHeight - fab.offsetHeight, pos.y)) + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  }
}

async function saveFabPos(fab) {
  const x = parseInt(fab.style.left, 10);
  const y = parseInt(fab.style.top, 10);
  if (!Number.isNaN(x) && !Number.isNaN(y)) {
    await chrome.storage.local.set({ [FAB_POS_KEY]: { x, y } });
  }
}

function bindFabDrag(fab) {
  let startX = 0, startY = 0, startL = 0, startT = 0, moved = false;
  fab.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    moved = false;
    startX = ev.clientX; startY = ev.clientY;
    const rect = fab.getBoundingClientRect();
    startL = rect.left; startT = rect.top;
    fab.setPointerCapture(ev.pointerId);
    fab.addEventListener('pointermove', onMove);
    fab.addEventListener('pointerup', onUp, { once: true });
  });

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true;
    fabDragging = true;
    fab.classList.add('dragging');
    const w = fab.offsetWidth, h = fab.offsetHeight;
    const maxX = window.innerWidth - w, maxY = window.innerHeight - h;
    const x = Math.max(0, Math.min(maxX, startL + dx));
    const y = Math.max(0, Math.min(maxY, startT + dy));
    fab.style.left = x + 'px';
    fab.style.top = y + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
    // Panel ikut di dekat FAB saat sedang dibuka & digeser.
    if (!$('#fab-panel').classList.contains('hidden')) placeFabPanel(fab);
  }

  function onUp() {
    fab.removeEventListener('pointermove', onMove);
    fab.classList.remove('dragging');
    if (moved) saveFabPos(fab);
    setTimeout(() => { fabDragging = false; }, 50);
  }
}

// ---------- Panel cepat: buka/tutup + form ----------
function toggleFabPanel(force) {
  const panel = $('#fab-panel');
  const show = force !== undefined ? force : panel.classList.contains('hidden');
  if (show) {
    renderFabPanel();
    panel.classList.remove('hidden');
    placeFabPanel($('#fab'));
  } else {
    panel.classList.add('hidden');
  }
}

function placeFabPanel(fab) {
  const panel = $('#fab-panel');
  const r = fab.getBoundingClientRect();
  const pw = panel.offsetWidth || 320;
  const ph = panel.offsetHeight || 300;
  // Buka ke kiri-atas FAB, clamp viewport.
  let x = r.left - pw + r.width;
  let y = r.top - ph - 10;
  if (x < 8) x = 8;
  if (y < 8) y = 8;
  if (x + pw > window.innerWidth - 8) x = window.innerWidth - pw - 8;
  panel.style.left = x + 'px';
  panel.style.top = y + 'px';
}

function renderFabPanel() {
  const panel = $('#fab-panel');
  panel.innerHTML = '<h2>Panel cepat <button id="fab-close" class="qm-btn-ghost">×</button></h2>' +
    '<div class="mg-row"><label>URL</label><input id="qp-url" type="text" class="mono" placeholder="https://…"></div>' +
    '<div class="mg-row"><label>Judul</label><input id="qp-title" type="text" placeholder="Judul bookmark"></div>' +
    '<div class="mg-row"><label>Kategori</label><div id="qp-cat-dd"></div></div>' +
    '<div class="mg-row"><label>Profil</label><select id="qp-profile"></select></div>' +
    '<div class="mg-row"><label>Flag</label>' +
    '<label style="min-width:0"><input type="checkbox" id="qp-rl"> Baca nanti</label>' +
    '<label style="min-width:0"><input type="checkbox" id="qp-fav"> Favorit</label></div>' +
    '<div class="mg-row"><label>Posisi</label>' +
    '<select id="qp-mode"><option value="corner">Diam di pojok</option><option value="free">Bebas digeser</option></select></div>' +
    '<div class="mg-row" style="justify-content:flex-end"><button id="qp-save" class="qm-btn-primary">Simpan</button></div>' +
    '<div class="mg-fab-hint">Tarik lingkaran untuk memindahkan panel cepat. Posisi tersimpan saat mode Bebas.</div>';

  // Isi pilihan kategori & profil + mode aktif. Kategori difilter profil terpilih
  // (milik profil itu + shared) dan ikut berganti saat profil di-select.
  const selProf = $('#qp-profile');
  const qpCat = createCatPicker({ emptyLabel: '(auto / tanpa)' });
  $('#qp-cat-dd').appendChild(qpCat.root);
  for (const p of state.profiles) {
    selProf.insertAdjacentHTML('beforeend', '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>');
  }
  const defProf = state.profiles.find((p) => p.isDefault) || state.profiles[0];
  if (defProf) selProf.value = defProf.id;
  // Daftar kategori mengikuti profil terpilih (milik profil itu + shared) — sinkron dengan panel web.
  const refreshFabCats = () => qpCat.setGroups(catGroupsFor(selProf.value), '(auto / tanpa)');
  refreshFabCats();
  selProf.onchange = refreshFabCats;
  $('#qp-mode').value = state.settings.quickPanelMode || 'corner';

  $('#fab-close').onclick = () => toggleFabPanel(false);
  // Sinkron dengan panel web: Esc tutup, Ctrl+Enter simpan.
  panel.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') toggleFabPanel(false);
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) $('#qp-save').click();
  });
  $('#qp-mode').onchange = async (ev) => {
    const mode = ev.target.value;
    await saveSetting({ quickPanelMode: mode }, 'Mode panel cepat');
    const fab = $('#fab');
    if (mode === 'corner') {
      fab.style.left = ''; fab.style.top = '';
      fab.style.right = ''; fab.style.bottom = '';
      await chrome.storage.local.remove(FAB_POS_KEY);
    } else {
      await applySavedFabPos(fab);
    }
  };
  $('#qp-save').onclick = async () => {
    const rawUrl = $('#qp-url').value.trim();
    const url = normalizeUrl(rawUrl);
    if (!url) { toast($('#toast-host'), 'URL tidak valid (harus http/https)'); return; }
    const title = $('#qp-title').value.trim() || hostOfUrl(rawUrl);
    const profileId = $('#qp-profile').value;
    const catChoice = qpCat.value;
    const learning = await db.listLearning(profileId);
    const lm = new Map(learning.map((e) => [e.domain, e.categoryId]));
    const saran = classify(url, title, lm);
    const dup = await db.findDuplicateOf(url);
    if (dup) { toast($('#toast-host'), 'Sudah ada di bookmark'); return; }
    await db.addBookmark({
      id: crypto.randomUUID(),
      profileId,
      url,
      urlRaw: rawUrl,
      title,
      note: '',
      categoryId: catChoice || saran.categoryId,
      flags: { favorite: $('#qp-fav').checked, readLater: $('#qp-rl').checked },
      openCount: 0, lastOpened: null,
      createdAt: Date.now(), shared: false
    });
    if (catChoice) await recordLearning(profileId, url, catChoice);
    toggleFabPanel(false);
    await afterWrite('Bookmark ditambahkan via panel cepat');
  };
}

function hostOfUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

function recordLearning(profileId, url, categoryId) {
  const host = hostOfUrl(url);
  if (!host) return Promise.resolve();
  return db.getLearning(profileId, host).then((existing) =>
    db.putLearning({ profileId, domain: host, categoryId, count: (existing && existing.categoryId === categoryId ? existing.count + 1 : 1) })
  );
}

// Terapkan mode panel cepat saat setting berubah dari view Pengaturan.
async function initQuickPanelPosFromSettings() {
  const fab = $('#fab');
  if (state.settings.quickPanelMode === 'free') {
    await applySavedFabPos(fab);
  } else {
    fab.style.left = ''; fab.style.top = '';
    fab.style.right = ''; fab.style.bottom = '';
    await chrome.storage.local.remove(FAB_POS_KEY);
  }
}
