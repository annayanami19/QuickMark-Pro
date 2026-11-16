// search.js — engine fuzzy search QuickMark Pro (pure module).
// Skor subsequence ala Sublime/VSCode: bonus kemacetan (consecutive), bonus awal kata,
// penalti gap. Exact & prefix mendapat boost besar. Dipakai popup/panel/omnibox/manager.

// Bangun indeks dari daftar bookmark (dipanggil sekali per load permukaan).
// Setiap entri: { id, t (titleLower), u (urlLower), n (noteLower), cat (categoryId), bm (ref bookmark) }
export function buildIndex(bookmarks) {
  return bookmarks.map((bm) => ({
    id: bm.id,
    t: (bm.title || '').toLowerCase(),
    u: (bm.url || '').toLowerCase(),
    n: (bm.note || '').toLowerCase(),
    cat: bm.categoryId || '',
    bm
  }));
}

// Skor fuzzy satu-pass (O(len)) — tanpa regex per token.
export function fuzzyScore(query, text) {
  if (!query) return 0;
  if (!text) return -Infinity;
  const q = query.toLowerCase();
  if (text.includes(q)) {
    return 1000 - text.indexOf(q);
  }
  // Subsequence scoring
  let score = 0;
  let ti = 0;
  let consecutive = 0;
  let wordStartBonus = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const pos = text.indexOf(ch, ti);
    if (pos === -1) return -Infinity;
    if (pos === ti && qi > 0) {
      consecutive++;
      score += 8;
    }
    if (pos === 0 || text[pos - 1] === ' ' || text[pos - 1] === '/' || text[pos - 1] === '.' || text[pos - 1] === '-') {
      wordStartBonus += 12;
    }
    score += Math.max(0, 4 - (pos - ti));
    ti = pos + 1;
  }
  return score + consecutive * 8 + wordStartBonus - (text.length - q.length) * 0.01;
}


// Best-field scoring: max dari title/url/note (title 1.0, url 0.8, note 0.6).
function bestScore(q, entry) {
  const t = fuzzyScore(q, entry.t);
  const u = fuzzyScore(q, entry.u);
  const n = fuzzyScore(q, entry.n);
  return Math.max(t, u * 0.8, n * 0.6);
}

// Filter: kategori & flag (profil difilter sebelum indeks dibangun).
export function matchFilters(entry, filters) {
  if (!filters) return true;
  if (filters.categoryId && entry.cat !== filters.categoryId) return false;
  if (filters.flag && !(entry.bm.flags && entry.bm.flags[filters.flag])) return false;
  return true;
}

// Search utama: skor semua entri, top-N parsial (tanpa full sort — PRD §6).
// Tanpa query: kembalikan urut createdAt desc (terbaru dulu), skor 0.
export function search(query, entries, opts) {
  const o = opts || {};
  const limit = o.limit || 30;
  const filters = o.filters || null;
  const scored = [];
  for (const entry of entries) {
    if (!matchFilters(entry, filters)) continue;
    if (!query) {
      scored.push({ entry, score: 0 });
      continue;
    }
    const s = bestScore(query, entry);
    if (s > -Infinity) scored.push({ entry, score: s });
  }
  // Top-N parsial: sort hanya sekali di akhir — indeks <= ~10k, sort O(n log n) masih < beberapa ms.
  scored.sort((a, b) => {
    if (!query) {
      return (b.entry.bm.createdAt || 0) - (a.entry.bm.createdAt || 0);
    }
    return b.score - a.score;
  });
  return scored.slice(0, limit);
}

// Rentang highlight pada teks asli (case-insensitive exact substring).
// Return array [start, end) atau null bila tak cocok (subsequence tak di-highlight).
export function highlightRanges(query, text) {
  if (!query || !text) return null;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  return [[idx, idx + query.length]];
}
