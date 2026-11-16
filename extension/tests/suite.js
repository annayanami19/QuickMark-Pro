// tests/suite.js — unit test modul pure (dedup, search, categorizer).
// Jalan di Node: node tests/run.mjs — dan di browser: tests/run-tests.html.
import assert from 'node:assert/strict';
import { normalizeUrl, hostOf, findDuplicateGroups, pickSurvivor } from '../lib/dedup.js';
import { buildIndex, fuzzyScore, search as fuzzySearch, highlightRanges } from '../lib/search.js';
import { classify, confidenceOf, learningMap, categoryChoices, categoryPickerChoices } from '../lib/categorizer.js';
import { sanitizeBackupName, backupFileName } from '../lib/io.js';

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

// ---------- dedup ----------
test('normalizeUrl: lowercase host, buang fragment & utm', () => {
  const r = normalizeUrl('HTTPS://WWW.Example.com/Page/?utm_source=x&id=3#frag');
  assert.equal(r, 'https://www.example.com/Page?id=3');
});

test('normalizeUrl: root path tanpa trailing slash', () => {
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com');
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com');
});

test('normalizeUrl: URL non-http ditolak', () => {
  assert.equal(normalizeUrl('javascript:alert(1)'), '');
  assert.equal(normalizeUrl('chrome://settings'), '');
  assert.equal(normalizeUrl('bukan-url'), '');
});

test('hostOf: buang www.', () => {
  assert.equal(hostOf('https://www.github.com/a'), 'github.com');
  assert.equal(hostOf('bukan url'), '');
});

test('findDuplicateGroups & pickSurvivor', () => {
  const bms = [
    { id: 'a', url: 'https://x.com', openCount: 1, createdAt: 1 },
    { id: 'b', url: 'https://x.com', openCount: 5, createdAt: 1 },
    { id: 'c', url: 'https://y.com', openCount: 9, createdAt: 1 }
  ];
  const g = findDuplicateGroups(bms);
  assert.equal(g.length, 1);
  assert.equal(pickSurvivor(g[0]).id, 'b');
});

// ---------- search ----------
test('fuzzyScore: exact substring jauh lebih tinggi dari subsequence', () => {
  const exact = fuzzyScore('git', 'github profile');
  const sub = fuzzyScore('gtp', 'github profile');
  assert.ok(exact > sub);
});

test('fuzzyScore: subsequence cocok', () => {
  assert.ok(fuzzyScore('ghprf', 'github profile') > 0);
  assert.equal(fuzzyScore('zzz', 'github profile'), -Infinity);
});

test('buildIndex + search: skor & urutan', () => {
  const idx = buildIndex([
    { id: '1', title: 'GitHub Profile', url: 'https://github.com/me', note: '' },
    { id: '2', title: 'Tokopedia', url: 'https://tokopedia.com', note: 'belanja' },
    { id: '3', title: 'GitHub Docs', url: 'https://docs.github.com', note: '' }
  ]);
  const res = fuzzySearch('github', idx, { limit: 10 });
  assert.equal(res.length, 2);
  // docs.github.com mengandung github lebih awal di url — pastikan keduanya ada & terurut desc skor
  assert.ok(res[0].score >= res[1].score);
});

test('search: tanpa query urut createdAt desc', () => {
  const idx = buildIndex([
    { id: '1', title: 'A', url: 'https://a.com', createdAt: 10 },
    { id: '2', title: 'B', url: 'https://b.com', createdAt: 20 }
  ]);
  const res = fuzzySearch('', idx, { limit: 10 });
  assert.equal(res[0].entry.bm.id, '2');
});

test('search: filter kategori & flag', () => {
  const idx = buildIndex([
    { id: '1', title: 'A', url: 'https://a.com', categoryId: 'dev', flags: { favorite: true } },
    { id: '2', title: 'B', url: 'https://b.com', categoryId: 'shop', flags: { favorite: false } }
  ]);
  assert.equal(fuzzySearch('', idx, { filters: { categoryId: 'dev' } }).length, 1);
  assert.equal(fuzzySearch('', idx, { filters: { flag: 'favorite' } }).length, 1);
});

test('highlightRanges: posisi benar', () => {
  const r = highlightRanges('Git', 'My GitHub');
  assert.deepEqual(r, [[3, 6]]);
  assert.equal(highlightRanges('zzz', 'abc'), null);
});

// ---------- categorizer ----------
test('classify: domain mapping', () => {
  assert.equal(classify('https://github.com/user/repo', '', null).categoryId, 'dev');
  assert.equal(classify('https://tokopedia.com/promo', '', null).categoryId, 'shop');
});

test('classify: subdomain ikut rule domain', () => {
  assert.equal(classify('https://docs.github.com/en', '', null).categoryId, 'dev');
  assert.equal(classify('https://www.youtube.com/watch?v=x', '', null).categoryId, 'entertainment');
});

test('classify: TLD rule (go.id)', () => {
  assert.equal(classify('https://kemdikbud.go.id/', '', null).categoryId, 'gov');
});

test('classify: learning user menang atas semua', () => {
  const learning = learningMap([{ domain: 'github.com', categoryId: 'learning' }]);
  const r = classify('https://github.com/x', '', learning);
  assert.equal(r.categoryId, 'learning');
  assert.equal(r.source, 'learning');
});

test('classify: keyword URL/judul', () => {
  assert.equal(classify('https://randomsite.com/tutorial-react', '', null).categoryId, 'dev');
  const r2 = classify('https://randomsite.com/artikel', 'Berita hari ini', null);
  assert.ok(r2.categoryId !== null);
});

test('classify: tanpa kecocokan → null', () => {
  const r = classify('https://contoh-domain-tak-dikenal.example/xyz', 'Halaman misterius', null);
  assert.equal(r.categoryId, null);
});

test('confidenceOf: learning > domain > keyword', () => {
  assert.ok(confidenceOf('learning') > confidenceOf('domain'));
  assert.ok(confidenceOf('domain') > confidenceOf('keyword'));
  assert.equal(confidenceOf(null), 0);
});

// ---------- picker kategori: enabled/disabled ----------
test('categoryPickerChoices: kategori nonaktif disaring dari pemilih', () => {
  const dbCats = [
    { id: 'cat_a', name: 'Aktif', color: '#fff', enabled: true },
    { id: 'cat_b', name: 'Nonaktif', color: '#fff', enabled: false },
    { id: 'cat_c', name: 'Tanpa field (lama)', color: '#fff' }
  ];
  const { custom } = categoryPickerChoices(dbCats, {});
  assert.deepEqual(custom.map((c) => c.id), ['cat_a', 'cat_c']);
});

test('categoryChoices: tetap lengkap untuk label/catsById', () => {
  // Kategori nonaktif tetap dikenali di tabel — bookmark yang memakainya tak kehilangan nama.
  const dbCats = [
    { id: 'cat_a', name: 'Aktif', color: '#fff', enabled: false },
    { id: 'dev', name: 'Dev duplikat', color: '#fff' }
  ];
  const { builtin, custom } = categoryChoices(dbCats, {});
  assert.ok(builtin.some((c) => c.id === 'dev'));
  assert.equal(custom.length, 1);
  assert.equal(custom[0].id, 'cat_a');
});

test('categoryPickerChoices: dataset bawaan off tetap ikut saringan bawaan', () => {
  const { builtin, custom } = categoryPickerChoices([{ id: 'cat_x', name: 'X', color: '#fff' }], { dev: false, social: false });
  assert.ok(!builtin.some((c) => c.id === 'dev'));
  assert.ok(!builtin.some((c) => c.id === 'social'));
  assert.ok(builtin.length > 0);
  assert.equal(custom.length, 1);
});

// ---------- nama file backup Drive ----------
test('backupFileName: format YYYYMMDD-HHmmss-nama.json (zero-padded, urutan alfabetik = urutan waktu)', () => {
  const name = backupFileName('quickmark-backup', new Date(2026, 10, 17, 9, 5, 3));
  assert.equal(name, '20261117-090503-quickmark-backup.json');
});

test('backupFileName: ekstensi kustom (.html untuk export Netscape)', () => {
  const name = backupFileName('quickmark-backup', new Date(2026, 10, 17, 9, 5, 3), '.html');
  assert.equal(name, '20261117-090503-quickmark-backup.html');
});

test('sanitizeBackupName: buang karakter ilegal, spasi jadi dash, kosong -> default', () => {
  assert.equal(sanitizeBackupName('kerja/2026'), 'kerja2026');
  assert.equal(sanitizeBackupName('  nama  aneh '), 'nama-aneh');
  assert.equal(sanitizeBackupName('///'), 'quickmark-backup');
});

export { tests };
