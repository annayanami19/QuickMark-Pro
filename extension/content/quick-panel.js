// quick-panel.js — panel cepat (FAB) di halaman web, QuickMark Pro.
// Content script ISOLATED world: DOM halaman tidak bisa mengakses state ini.
// Data disimpan lewat chrome.runtime.sendMessage -> service worker (IndexedDB extension).
(function () {
  'use strict';
  if (window.__qmpInjected) return; // cegah injeksi ganda
  window.__qmpInjected = true;

  let meta = null;        // { profiles, categories, allCategories, builtin, activeProfileId }
  let lastSettings = {};  // snapshot chrome.storage.sync('settings') — mode posisi dsb.
  let fab = null, panel = null, toastEl = null;
  let fabDragging = false;
  let catVal = ''; // kategori terpilih panel web ('' = otomatis) — dibaca saveFromPanel

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          void chrome.runtime.lastError; // SW belum siap / context invalid -> resolve null
          resolve(res || null);
        });
      } catch (e) { resolve(null); }
    });
  }

  // ---------- Muat meta (profil + kategori) SETIAP panel dibuka ----------
  // Selalu fresh: perubahan dataset/kategori di Pengaturan langsung terlihat
  // tanpa reload halaman web (payload kecil, satu ping ke SW).
  async function ensureMeta() {
    meta = await sendMessage({ type: 'qm-meta' });
    return meta;
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ---------- FAB: drag (threshold 6px) + klik buka panel ----------
  function bindFabDrag() {
    let sx = 0, sy = 0, sl = 0, st = 0, moved = false;
    fab.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      moved = false; sx = ev.clientX; sy = ev.clientY;
      const r = fab.getBoundingClientRect();
      sl = r.left; st = r.top;
      fab.setPointerCapture(ev.pointerId);
      fab.addEventListener('pointermove', onMove);
      fab.addEventListener('pointerup', onUp, { once: true });
    });
    function onMove(ev) {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true; fabDragging = true;
      fab.classList.add('qmp-dragging');
      fab.style.left = clamp(sl + dx, 0, window.innerWidth - fab.offsetWidth) + 'px';
      fab.style.top = clamp(st + dy, 0, window.innerHeight - fab.offsetHeight) + 'px';
      fab.style.right = 'auto'; fab.style.bottom = 'auto';
      if (panel && !panel.hidden) placePanel();
    }
    function onUp() {
      fab.removeEventListener('pointermove', onMove);
      fab.classList.remove('qmp-dragging');
      // Posisi global di chrome.storage.local — key 'quickPanelPos' yang sama dengan FAB manager.
      if (moved) {
        const x = parseInt(fab.style.left, 10), y = parseInt(fab.style.top, 10);
        if (!Number.isNaN(x) && !Number.isNaN(y)) {
          try { chrome.storage.local.set({ quickPanelPos: { x, y } }); } catch (e) {}
        }
      }
      setTimeout(() => { fabDragging = false; }, 50);
    }
  }

  // ---------- Panel form ----------
  function placePanel() {
    const r = fab.getBoundingClientRect();
    const pw = panel.offsetWidth || 300;
    const ph = panel.offsetHeight || 300;
    let x = r.left - pw + r.width;
    let y = r.top - ph - 10;
    x = clamp(x, 8, window.innerWidth - pw - 8);
    y = clamp(y, 8, window.innerHeight - ph - 8);
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  }

  function renderPanel() {
    catVal = ''; // panel dibangun ulang tiap dibuka — pilihan mulai dari (otomatis)
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'qmp-panel';
      panel.hidden = true;
      document.documentElement.appendChild(panel);
    }
    const allCats = (meta && meta.allCategories) || []; // semua kategori aktif, lintas profil
    const builtin = (meta && meta.builtin) || [];      // kategori bawaan (dataset aktif)
    const profs = (meta && meta.profiles) || [];
    const activeId = (meta && meta.activeProfileId) || (profs[0] && profs[0].id) || '';
    // Dropdown kategori ber-cari (scroll di dalam) — pengganti <select> yang memanjang
    // saat kategori banyak. Mengikuti profil terpilih (milik profil itu + shared) —
    // sinkron dengan panel cepat manager.
    function catGroups() {
      const prof = $('qmp-prof').value;
      const picked = allCats.filter((c) => c.profileId === prof || c.profileId === 'shared');
      const g = [{ label: 'Bawaan', items: builtin }, { label: 'Kategori saya', items: picked }];
      return g.filter((x) => x.items.length);
    }
    function setCatLabel() {
      if (catVal === '') { $('qmp-dd-lab').textContent = '(otomatis)'; return; }
      for (const g of catGroups()) {
        const c = g.items.find((x) => x.id === catVal);
        if (c) { $('qmp-dd-lab').textContent = c.name; return; }
      }
      $('qmp-dd-lab').textContent = '(otomatis)';
    }
    function renderCatList(q) {
      const ddList = $('qmp-dd-list');
      const needle = (q || '').trim().toLowerCase();
      const hit = catGroups()
        .map((g) => ({ label: g.label, items: g.items.filter((c) => !needle ||
          c.name.toLowerCase().indexOf(needle) !== -1) }))
        .filter((g) => g.items.length);
      let html = '<div class="qmp-dd-item' + (catVal === '' ? ' sel' : '') + '" data-id="">(otomatis)</div>';
      if (needle && !hit.length) {
        html += '<div class="qmp-dd-empty">Tidak ada kategori yang cocok</div>';
      } else {
        html += hit.map((g) => '<div class="qmp-dd-group">' + esc(g.label) + '</div>' +
          g.items.map((c) => '<div class="qmp-dd-item' + (c.id === catVal ? ' sel' : '') +
            '" data-id="' + esc(c.id) + '">' + esc(c.name) + '</div>').join('')).join('');
      }
      ddList.innerHTML = html;
      ddList.querySelectorAll('.qmp-dd-item').forEach((b) => {
        b.addEventListener('click', () => { catVal = b.dataset.id; setCatLabel(); closeCatPop(); });
      });
    }
    function closeCatPop() {
      const ddPop = $('qmp-dd-pop');
      if (!ddPop.classList.contains('qmp-open')) return false;
      ddPop.classList.remove('qmp-open');
      return true;
    }
    panel.innerHTML =
      '<div class="qmp-head"><span>Panel cepat</span><span class="qmp-close" id="qmp-close" title="Tutup">x</span></div>' +
      '<div class="qmp-row"><label>URL</label><input type="text" id="qmp-url" class="qmp-mono"></div>' +
      '<div class="qmp-row"><label>Judul</label><input type="text" id="qmp-title"></div>' +
      '<div class="qmp-row"><label>Kategori</label><div class="qmp-dd" id="qmp-dd">' +
      '<div class="qmp-dd-btn" id="qmp-dd-btn"><span class="qmp-dd-lab" id="qmp-dd-lab">(otomatis)</span>' +
      '<span class="qmp-dd-car">▾</span></div>' +
      '<div class="qmp-dd-pop" id="qmp-dd-pop">' +
      '<input type="text" class="qmp-dd-search" id="qmp-dd-search" placeholder="Cari kategori…">' +
      '<div class="qmp-dd-list" id="qmp-dd-list"></div></div></div></div>' +
      '<div class="qmp-row"><label>Profil</label><select id="qmp-prof">' +
      profs.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === activeId ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
      '</select></div>' +
      '<div class="qmp-row"><label>Flag</label><div class="qmp-flags">' +
      '<label><input type="checkbox" id="qmp-rl"> Baca nanti</label>' +
      '<label><input type="checkbox" id="qmp-fav"> Favorit</label></div></div>' +
      '<div class="qmp-row"><label>Posisi</label><select id="qmp-mode">' +
      '<option value="corner">Diam di pojok</option><option value="free">Bebas digeser</option></select></div>' +
      '<div class="qmp-actions"><span class="qmp-save" id="qmp-save">Simpan</span></div>';

    $('qmp-url').value = location.href;
    $('qmp-title').value = document.title || '';
    // Event dropdown kategori — markup baru saja dirender.
    const ddBtn = $('qmp-dd-btn'), ddPop = $('qmp-dd-pop'), ddSearch = $('qmp-dd-search');
    ddBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (ddPop.classList.contains('qmp-open')) { closeCatPop(); return; }
      ddSearch.value = '';
      renderCatList('');
      ddPop.classList.add('qmp-open');
      ddSearch.focus();
    });
    ddSearch.addEventListener('input', () => renderCatList(ddSearch.value));
    ddSearch.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.ctrlKey && !ev.metaKey) {
        ev.preventDefault(); ev.stopPropagation();
        const first = $('qmp-dd-list').querySelector('.qmp-dd-item');
        if (first) first.click();
      }
    });
    setCatLabel(); // reset bila kategori terpilih tak ada di profil baru
    $('qmp-prof').addEventListener('change', setCatLabel);
    // Klik di luar dropdown (di dalam maupun di luar panel) menutup daftar kategori.
    document.addEventListener('click', (ev) => {
      if (ddPop.classList.contains('qmp-open') && !$('qmp-dd').contains(ev.target)) closeCatPop();
    });
    // Mode posisi sama dengan Pengaturan & manager — disimpan lewat SW (broadcast ikut).
    $('qmp-mode').value = lastSettings.quickPanelMode || 'corner';
    $('qmp-mode').addEventListener('change', async (ev) => {
      const mode = ev.target.value;
      const res = await sendMessage({ type: 'qm-mode', mode });
      if (res && res.ok) lastSettings.quickPanelMode = mode;
      await applyFabMode(mode);
      showToast(mode === 'corner' ? 'Panel cepat: diam di pojok kanan bawah' : 'Panel cepat: bebas digeser');
    });
    $('qmp-close').addEventListener('click', () => togglePanel(false));
    $('qmp-save').addEventListener('click', saveFromPanel);
    panel.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { if (closeCatPop()) return; togglePanel(false); }
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) saveFromPanel();
    });
  }

  async function togglePanel(force) {
    const show = force !== undefined ? force : (panel ? panel.hidden : true);
    if (show) {
      lastSettings = await readSettings();
      ensureMeta().then((m) => {
        if (!m) { showToast('Extension tidak merespons — reload halaman'); return; }
        renderPanel();
        panel.hidden = false;
        placePanel();
        $('qmp-url').focus();
      });
    } else if (panel) {
      panel.hidden = true;
    }
  }

  async function saveFromPanel() {
    const btn = $('qmp-save');
    const payload = {
      url: $('qmp-url').value.trim(),
      title: $('qmp-title').value.trim(),
      categoryId: catVal || null,
      profileId: $('qmp-prof').value,
      flags: { readLater: $('qmp-rl').checked, favorite: $('qmp-fav').checked }
    };
    if (!/^https?:\/\//i.test(payload.url)) { showToast('URL harus http/https'); return; }
    btn.textContent = 'Menyimpan...';
    const res = await sendMessage({ type: 'qm-save', payload });
    btn.textContent = 'Simpan';
    if (!res) { showToast('Gagal menyimpan — extension tidak merespons'); return; }
    if (res.ok) {
      showToast('Bookmark tersimpan' + (res.suggestion && res.suggestion.categoryId ? ' (' + categoryName(res.suggestion.categoryId) + ')' : ''));
      togglePanel(false);
    } else if (res.reason === 'duplicate') {
      showToast('Sudah ada di bookmark');
    } else if (res.reason === 'invalid-url') {
      showToast('URL tidak valid');
    } else {
      showToast('Gagal menyimpan');
    }
  }

  function categoryName(id) {
    if (!meta) return id;
    const c = (meta.categories || []).find((x) => x.id === id);
    return c ? c.name : id;
  }

  // ---------- Toast ringan ----------
  function showToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'qmp-toast';
      document.documentElement.appendChild(toastEl);
    }
    const fabR = fab.getBoundingClientRect();
    toastEl.textContent = msg;
    toastEl.style.left = clamp(fabR.left - 100, 8, window.innerWidth - 220) + 'px';
    toastEl.style.top = clamp(fabR.top - 44, 8, window.innerHeight - 40) + 'px';
    toastEl.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { if (toastEl) toastEl.hidden = true; }, 2600);
  }

  // ---------- Mode posisi (sinkron dengan Pengaturan & manager) ----------
  // corner: diam di pojok kanan bawah (CSS default). free: pakai posisi tersimpan global.
  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(key, (out) => { void chrome.runtime.lastError; resolve(out && out[key]); });
      } catch (e) { resolve(null); }
    });
  }

  async function applyFabMode(mode) {
    if (!fab) return;
    if (mode === 'free') {
      const pos = await storageGet('quickPanelPos');
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        fab.style.left = clamp(pos.x, 0, Math.max(0, window.innerWidth - fab.offsetWidth)) + 'px';
        fab.style.top = clamp(pos.y, 0, Math.max(0, window.innerHeight - fab.offsetHeight)) + 'px';
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
      }
    } else {
      fab.style.left = ''; fab.style.top = '';
      fab.style.right = ''; fab.style.bottom = '';
    }
  }

  // ---------- Init: hormati setting quickPanelSites (on/off dari Pengaturan) ----------
  function readSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get('settings', (out) => {
          void chrome.runtime.lastError;
          resolve((out && out.settings) || {});
        });
      } catch (e) { resolve({}); }
    });
  }

  async function mount() {
    const s = await readSettings();
    if (s.quickPanelSites === false) return; // dimatikan di Pengaturan
    fab = document.createElement('div');
    fab.id = 'qmp-fab';
    fab.title = 'QuickMark Pro — panel cepat';
    fab.textContent = '+';
    document.documentElement.appendChild(fab);
    await applyFabMode(lastSettings.quickPanelMode || 'corner');
    bindFabDrag();
    fab.addEventListener('click', () => {
      if (fabDragging) return;
      togglePanel();
    });
    // Settings berubah (Pengaturan / manager / panel web lain) — on/off + mode posisi live.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes.settings) return;
      lastSettings = changes.settings.newValue || {};
      const show = lastSettings.quickPanelSites !== false;
      if (fab) fab.style.display = show ? '' : 'none';
      if (!show && panel) panel.hidden = true;
      if (fab && show) applyFabMode(lastSettings.quickPanelMode || 'corner');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
