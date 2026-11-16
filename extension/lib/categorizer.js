// categorizer.js — classifier rule-based offline (pure logic + helper chrome-agnostic).
// Urutan prioritas (PRD §3.3): learning user → TLD → domain mapping → keyword.
// Fungsi classify murni (dapat dites tanpa chrome); fungsi recordDecision menyentuh db.

import { BUILTIN_CATEGORIES, TLD_RULES } from '../data/categories.js';

// Host tanpa 'www.' — dipakai untuk pencocokan domain & learning.
function cleanHost(hostname) {
  return (hostname || '').toLowerCase().replace(/^www\./, '');
}

// Registrasi rules ke struktur cepat: Map domain→cat + array keyword.
function buildRules(dataset) {
  const domainMap = new Map();
  const kwRules = [];
  for (const cat of dataset) {
    for (const d of cat.domains || []) {
      // Exact host match atau subdomain (akhir .github.com) — bila rule diawali '.', cocok akhiran.
      domainMap.set(d, cat.id);
    }
    kwRules.push({ id: cat.id, kw: (cat.keywords || []).map((k) => k.toLowerCase()) });
  }
  return { domainMap, kwRules };
}

const rules = buildRules(BUILTIN_CATEGORIES);

// Klasifikasi murni (tanpa db/chrome):
//   learning — Map domain → categoryId dari keputusan user profil ini (atau null)
// Return: { categoryId: string|null, source: 'learning'|'tld'|'domain'|'keyword'|null }

// Cocokkan keyword dengan batas karakter non-alphanumeric di kedua sisi.
function kwMatch(hay, k) {
  let i = hay.indexOf(k);
  while (i !== -1) {
    const before = i === 0 ? ' ' : hay[i - 1];
    const afterIdx = i + k.length;
    const after = afterIdx >= hay.length ? ' ' : hay[afterIdx];
    if (!isAlnum(before) && !isAlnum(after)) return true;
    i = hay.indexOf(k, i + 1);
  }
  return false;
}
function isAlnum(c) {
  return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
}

export function classify(url, title, learning) {
  const host = cleanHost(hostOfUrl(url));
  if (!host) return { categoryId: null, source: null };
  // 1. Learning user (paling kuat).
  if (learning && learning.has(host)) {
    return { categoryId: learning.get(host), source: 'learning' };
  }
  // 2. TLD rules (akhiran host).
  for (const suffix of Object.keys(TLD_RULES)) {
    if (host === suffix.slice(1) || host.endsWith(suffix)) {
      return { categoryId: TLD_RULES[suffix], source: 'tld' };
    }
  }
  // 3. Domain mapping: exact, atau subdomain berakhir pada rule ('.github.com').
  let domainHit = null;
  for (const [d, catId] of rules.domainMap) {
    if (host === d || host.endsWith('.' + d)) {
      domainHit = catId;
      break;
    }
  }
  if (domainHit) return { categoryId: domainHit, source: 'domain' };
  // 4. Keyword pada URL path + judul — word boundary agar 'exam' tidak kena di 'example'.
  const hay = (url + ' ' + (title || '')).toLowerCase();
  for (const { id, kw } of rules.kwRules) {
    for (const k of kw) {
      if (kwMatch(hay, k)) return { categoryId: id, source: 'keyword' };
    }
  }
  return { categoryId: null, source: null };
}

// Host dari URL (tanpa www.) — helper lokal agar pure.
function hostOfUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

// Confidence untuk UI: learning=tinggi, tld/domain=tinggi, keyword=sedang.
export function confidenceOf(source) {
  if (source === 'learning') return 0.9;
  if (source === 'tld' || source === 'domain') return 0.8;
  if (source === 'keyword') return 0.5;
  return 0;
}

// Learning helper: catat keputusan user (domain → kategori) untuk profil.
// Di-import db di sini (bukan top-level side-effect) — aman untuk node test pure.
import * as db from './db.js';

export async function recordDecision(profileId, url, categoryId) {
  const host = cleanHost(hostOfUrl(url));
  if (!host || !categoryId) return;
  const existing = await db.getLearning(profileId, host);
  const same = existing && existing.categoryId === categoryId;
  await db.putLearning({
    profileId,
    domain: host,
    categoryId,
    count: (existing && same ? existing.count + 1 : 1)
  });
}

// Bangun Map learning untuk classify() dari daftar entri learning.
export function learningMap(entries) {
  const m = new Map();
  for (const e of entries || []) m.set(e.domain, e.categoryId);
  return m;
}

// Daftar kategori bawaan aktif (hormati setting on/off per kategori).
// Gabungan pilihan kategori untuk dropdown/chips: bawaan (dataset aktif) + buatan user.
// Return { builtin: [{id,name,color,icon}], custom: [row db] } — tanpa duplikat id.
export function categoryChoices(dbCats, datasetEnabled) {
  const builtin = builtinCategories(datasetEnabled);
  const ids = new Set(builtin.map((c) => c.id));
  const custom = (dbCats || []).filter((c) => !ids.has(c.id));
  return { builtin, custom };
}

// Pemilih kategori (dropdown/chips/meta): bawaan aktif + kategori buatan user yang AKTIF saja.
// Kategori nonaktif (enabled === false) disembunyikan dari pemilih, tapi TETAP dikenali di
// catsById/tabel — bookmark yang memakainya tidak kehilangan label (jaring pengaman).
export function categoryPickerChoices(dbCats, datasetEnabled) {
  const { builtin, custom } = categoryChoices(dbCats, datasetEnabled);
  return { builtin, custom: custom.filter((c) => c.enabled !== false) };
}

export function builtinCategories(enabledIds) {
  if (!enabledIds) return BUILTIN_CATEGORIES;
  return BUILTIN_CATEGORIES.filter((c) => enabledIds[c.id] !== false);
}
