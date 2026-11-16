// ui.js — komponen kecil bersama: escape, toast, confirm 2-klik, broadcast, ikon SVG.
// Dipakai popup/panel/manager; tanpa framework.

// Escape HTML — semua string user/URL dirender via ini.
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Broadcast lintas permukaan (popup/panel/manager) — BroadcastChannel.
// SW tidak dilibatkan; guard untuk environment tanpa BroadcastChannel (node test).
const _bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('quickmark') : null;

export function broadcast(type, payload) {
  if (_bc) _bc.postMessage({ type, payload, t: Date.now() });
}

export function onBroadcast(handler) {
  if (!_bc) return () => {};
  const fn = (ev) => handler(ev.data);
  _bc.addEventListener('message', fn);
  return () => _bc.removeEventListener('message', fn);
}

export function debounce(fn, ms) {
  let h = null;
  return function (...args) {
    clearTimeout(h);
    h = setTimeout(() => fn.apply(this, args), ms);
  };
}

export function uid() {
  return (crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

// ---------- Toast ----------
// Toast glass bawah-tengah, 3.2s, opsi aksi (Undo). Stack maksimal 1 antrian sederhana.
let _toastEl = null;
let _toastTimer = null;

export function toast(container, message, opts) {
  const o = opts || {};
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.className = 'qm-toast';
    container.appendChild(_toastEl);
  }
  _toastEl.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = message;
  _toastEl.appendChild(span);
  if (o.actionLabel) {
    const btn = document.createElement('button');
    btn.className = 'qm-toast-action';
    btn.textContent = o.actionLabel;
    btn.onclick = () => {
      hideToast();
      if (o.onAction) o.onAction();
    };
    _toastEl.appendChild(btn);
  }
  _toastEl.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(hideToast, o.duration || 3200);
}

function hideToast() {
  if (_toastEl) _toastEl.classList.remove('show');
}

// ---------- Confirm 2-klik (pola "klik LAGI", bukan dialog OS) ----------
// Tombol berubah jadi "Yakin? Klik lagi" selama 3 detik; klik kedua baru eksekusi.
export function confirm2(btn, label, fn) {
  if (btn.dataset.armed === '1') {
    btn.dataset.armed = '';
    btn.textContent = btn.dataset.origLabel;
    fn();
    return;
  }
  btn.dataset.armed = '1';
  btn.dataset.origLabel = btn.textContent;
  btn.textContent = label;
  setTimeout(() => {
    if (btn.dataset.armed === '1') {
      btn.dataset.armed = '';
      btn.textContent = btn.dataset.origLabel;
    }
  }, 3000);
}

// ---------- Ikon SVG bawaan (stroke 1.5, konsisten) ----------
export const ICONS = {
  code: '<path d="M8 6 2 12l6 6M16 6l6 6-6 6"/>',
  palette: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.4" fill="currentColor" stroke="none"/><circle cx="9.5" cy="14.5" r="1.4" fill="currentColor" stroke="none"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
  cart: '<circle cx="9" cy="21" r="1.6"/><circle cx="19" cy="21" r="1.6"/><path d="M1 1h4l2.6 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
  news: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9h4"/><path d="M12 8h6M12 12h6M12 16h4"/>',
  play: '<circle cx="12" cy="12" r="9"/><polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  wallet: '<path d="M20 7H4a2 2 0 0 1-2-2 2 2 0 0 1 2-2h12v4"/><path d="M22 7v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5"/><circle cx="17" cy="13" r="1.6" fill="currentColor" stroke="none"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  gamepad: '<path d="M6 12h4M8 10v4"/><path d="M15 13h.01M18 11h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.6C2 12 2.5 14.5 3 16a2 2 0 0 0 1.92 2h14.16A2 2 0 0 0 21 16c.5-1.5 1-4 1.34-7.4A4 4 0 0 0 17.32 5z"/>',
  building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M16 8h2a2 2 0 0 1 2 2v11"/><path d="M1 21h22"/><path d="M8 7h2M8 11h2M8 15h2"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'
};

// Render ikon SVG inline (stroke 1.5).
export function icon(name, size, cls) {
  const s = size || 16;
  const path = ICONS[name] || ICONS.tool;
  return '<svg class="' + (cls || '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
}

// ---------- Favicon ----------
// Mode default: endpoint resmi _favicon/ via runtime.getURL (permission "favicon") —
// bekerja di Chrome & Edge. chrome://favicon2 DITOLAK browser ("Not allowed to load
// local resource") dan bukan API yang didokumentasikan. Di-cache IndexedDB saat save.
// Fallback ikon huruf warna kategori. Return { src } untuk <img> atau { letter, color } fallback.
export function faviconSrc(url, mode) {
  if (mode === 'letter') return null;
  return chrome.runtime.getURL('/_favicon/') +
    '?pageUrl=' + encodeURIComponent(url) + '&size=32';
}

// Ikon huruf: huruf pertama host, warna dari hash host (deterministik).
export function letterIcon(url, color) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { host = '?'; }
  const letter = (host || '?').charAt(0).toUpperCase();
  return { letter, color: color || '#60a5fa' };
}

// ---------- Virtual list sederhana (windowing ~30 baris terlihat) ----------
// opts: { rowHeight, render(item) -> html string, onActivate(item) }
export function virtualList(container, items, opts) {
  const o = opts || {};
  const rowH = o.rowHeight || 48;
  const render = o.render;
  const onActivate = o.onActivate;
  container.innerHTML = '';
  container.classList.add('qm-vlist');
  container.style.position = 'relative';
  const total = items.length;
  container.style.height = total * rowH + 'px';
  const state = { items, rowH, render, onActivate, window: null };
  function visible() {
    const st = container.scrollTop;
    const h = container.clientHeight;
    const start = Math.max(0, Math.floor(st / rowH) - 5);
    const end = Math.min(total, Math.ceil((st + h) / rowH) + 5);
    return [start, end];
  }
  function paint() {
    const [start, end] = visible();
    if (state.window && state.window[0] === start && state.window[1] === end) return;
    state.window = [start, end];
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const el = document.createElement('div');
      el.className = 'qm-vrow';
      el.style.position = 'absolute';
      el.style.top = i * rowH + 'px';
      el.style.height = rowH + 'px';
      el.style.left = '0';
      el.style.right = '0';
      el.dataset.index = i;
      el.innerHTML = render(items[i], i);
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('button, input, select')) return;
        if (onActivate) onActivate(items[i], ev);
      });
      frag.appendChild(el);
    }
    container.replaceChildren(frag);
  }
  container.addEventListener('scroll', () => requestAnimationFrame(paint));
  paint();
  return {
    repaint: paint,
    update: (newItems) => {
      state.items = newItems;
      container.style.height = newItems.length * rowH + 'px';
      state.window = null;
      paint();
    }
  };
}
