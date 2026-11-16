// dedup.js — normalisasi URL & deteksi duplikat (pure module, tanpa chrome.*).
// Satu definisi normalisasi dipakai save/import/dedup/search — tidak ada dua definisi (PRD §4.5).

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'msclkid', 'dclid', 'twclid', 'igshid',
  'ref', 'ref_src', 'spm', 'scm', 'share_medium', 'share_source'
]);

// Normalisasi URL untuk dedup & unique key:
// - lowercase protocol + host
// - buang fragment & parameter tracking umum
// - buang trailing '/' pada akhir URL
// - buang port default (80/443) — URL API yang sudah melakukannya otomatis
export function normalizeUrl(input) {
  if (typeof input !== 'string' || !input.trim()) return '';
  let u;
  try {
    u = new URL(input.trim());
  } catch (e) {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';
  const keep = [];
  for (const [k, v] of u.searchParams) {
    if (!TRACKING_PARAMS.has(k.toLowerCase())) keep.push([k, v]);
  }
  u.search = '';
  keep.forEach(([k, v]) => u.searchParams.append(k, v));
  // Trailing slash pada path (bukan root) juga dibuang.
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }
  if (u.pathname === '/' && !u.search) return u.origin;
  let s = u.toString();
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

// Host dari URL ternormalisasi ('' bila URL tidak valid).
export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

// Cari duplikat dalam daftar bookmark: kelompokkan berdasar URL ternormalisasi.
// Input: array bookmark (url sudah ternormalisasi). Output: array grup duplikat.
export function findDuplicateGroups(bookmarks) {
  const map = new Map();
  for (const bm of bookmarks) {
    const key = bm.url;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(bm);
  }
  const groups = [];
  for (const [, items] of map) {
    if (items.length > 1) groups.push(items);
  }
  return groups;
}

// Pilih "penyimpan" (survivor) dari grup duplikat: openCount terbanyak, lalu createdAt terbaru.
export function pickSurvivor(group) {
  return group.slice().sort((a, b) =>
    (b.openCount || 0) - (a.openCount || 0) ||
    (b.createdAt || 0) - (a.createdAt || 0)
  )[0];
}
