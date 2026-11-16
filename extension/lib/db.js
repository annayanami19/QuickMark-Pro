// db.js — wrapper IndexedDB QuickMark Pro.
// Prinsip MV3: halaman extension (popup/panel/manager) membaca IndexedDB langsung —
// service worker tidak dilibatkan untuk operasi data agar SW tetap dorman.

const DB_NAME = 'quickmark';
const DB_VERSION = 1;

let _dbPromise = null;

function openDB() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('indexedDB tidak tersedia di context ini.'));
  }
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('profiles', { keyPath: 'id' });
      const cats = db.createObjectStore('categories', { keyPath: 'id' });
      cats.createIndex('by_profile', 'profileId');
      const bms = db.createObjectStore('bookmarks', { keyPath: 'id' });
      bms.createIndex('by_profile', 'profileId');
      bms.createIndex('by_profile_url', ['profileId', 'url'], { unique: true });
      bms.createIndex('by_category', 'categoryId');
      bms.createIndex('by_created', 'createdAt');
      bms.createIndex('by_open', 'openCount');
      db.createObjectStore('learning', { keyPath: ['profileId', 'domain'] });
      db.createObjectStore('favicons', { keyPath: 'host' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Gagal membuka IndexedDB.'));
  });
  return _dbPromise;
}

// ---------- Helper transaction ----------
function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction di-abort.'));
  });
}

async function txStores(storeNames, mode) {
  const db = await openDB();
  return db.transaction(storeNames, mode);
}

function store(storeNames, mode) {
  return txStores(storeNames, mode).then((tx) => tx.objectStore(Array.isArray(storeNames) ? storeNames[0] : storeNames));
}

function index(storeName, name) {
  return txStores([storeName], 'readonly').then((tx) => tx.objectStore(storeName).index(name));
}

// ---------- CRUD generik ----------
export async function getAll(storeName) {
  const s = await store(storeName, 'readonly');
  return reqToPromise(s.getAll());
}

export async function get(storeName, key) {
  const s = await store(storeName, 'readonly');
  return reqToPromise(s.get(key));
}

export async function put(storeName, value) {
  const s = await store(storeName, 'readwrite');
  const p = reqToPromise(s.put(value));
  await txDone(s.transaction);
  return p;
}

export async function bulkPut(storeName, values) {
  if (!values.length) return;
  const tx = await txStores([storeName], 'readwrite');
  const s = tx.objectStore(storeName);
  for (const v of values) s.put(v);
  await txDone(tx);
}

export async function bulkDelete(storeName, keys) {
  if (!keys.length) return;
  const tx = await txStores([storeName], 'readwrite');
  const s = tx.objectStore(storeName);
  for (const k of keys) s.delete(k);
  await txDone(tx);
}

export async function remove(storeName, key) {
  const s = await store(storeName, 'readwrite');
  const p = reqToPromise(s.delete(key));
  await txDone(s.transaction);
  return p;
}

export async function clearStore(storeName) {
  const s = await store(storeName, 'readwrite');
  const p = reqToPromise(s.clear());
  await txDone(s.transaction);
  return p;
}

export function dbClose() {
  if (_dbPromise) {
    _dbPromise.then((db) => db.close()).catch(() => {});
    _dbPromise = null;
  }
}

// ---------- Bookmarks ----------
// Skema: { id, profileId, url (ternormalisasi), urlRaw, title, note, categoryId,
//          flags:{favorite,readLater}, openCount, lastOpened, createdAt, shared }

export async function addBookmark(bm) {
  // url WAJIB sudah ternormalisasi (dedup.js) — pelanggaran unique index → ConstraintError.
  try {
    await put('bookmarks', bm);
    return { ok: true };
  } catch (e) {
    if (e && e.name === 'ConstraintError') return { ok: false, reason: 'duplicate' };
    throw e;
  }
}

export async function updateBookmark(bm) {
  return put('bookmarks', bm);
}

export async function deleteBookmark(id) {
  return remove('bookmarks', id);
}

export async function deleteBookmarks(ids) {
  return bulkDelete('bookmarks', ids);
}

export async function listBookmarks(profileId) {
  if (profileId === '*') return getAll('bookmarks');
  const idx = await index('bookmarks', 'by_profile');
  return reqToPromise(idx.getAll(profileId));
}

export async function findByUrl(profileId, url) {
  const idx = await index('bookmarks', 'by_profile_url');
  return reqToPromise(idx.get([profileId, url]));
}

// Scan ringan untuk deteksi duplikat lintas profil (dipakai popup saat save).
export async function findDuplicateOf(url) {
  const all = await getAll('bookmarks');
  return all.find((b) => b.url === url) || null;
}

// Statistik pasif: dipanggil hanya saat bookmark dibuka lewat QuickMark Pro.
export async function incrementOpen(id) {
  const tx = await txStores(['bookmarks'], 'readwrite');
  const s = tx.objectStore('bookmarks');
  const getReq = s.get(id);
  getReq.onsuccess = () => {
    const bm = getReq.result;
    if (bm) {
      bm.openCount = (bm.openCount || 0) + 1;
      bm.lastOpened = Date.now();
      s.put(bm);
    }
  };
  await txDone(tx);
}

export async function countBookmarks(profileId) {
  const idx = await index('bookmarks', 'by_profile');
  return reqToPromise(idx.count(profileId));
}

// ---------- Categories ----------
// Skema: { id, profileId ('shared' atau id profil), name, color, icon, order, builtin, enabled }
// enabled === false → kategori nonaktif: disembunyikan dari semua pemilih kategori,
// bookmark yang memakainya tetap utuh (row lama tanpa field dianggap aktif).

export async function addCategory(cat) {
  return put('categories', cat);
}

export async function updateCategory(cat) {
  return put('categories', cat);
}

export async function deleteCategory(id) {
  return remove('categories', id);
}

// Kategori satu profil + semua kategori 'shared', terurut order lalu nama.
export async function listCategories(profileId) {
  const idx = await index('categories', 'by_profile');
  const own = await reqToPromise(idx.getAll(profileId));
  const shared = profileId !== 'shared' ? await reqToPromise(idx.getAll('shared')) : [];
  return own.concat(shared).sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
}

export async function listAllCategories() {
  return getAll('categories');
}

// ---------- Learning (keputusan kategori user per domain, per profil) ----------
// Skema: { profileId, domain, categoryId, count } — keyPath ['profileId','domain']
export async function getLearning(profileId, domain) {
  return get('learning', [profileId, domain]);
}

export async function putLearning(entry) {
  return put('learning', entry);
}

export async function listLearning(profileId) {
  const s = await store('learning', 'readonly');
  const range = IDBKeyRange.bound([profileId, ''], [profileId, '\uffff']);
  return reqToPromise(s.getAll(range));
}

export async function deleteLearningForProfile(profileId) {
  const s = await store('learning', 'readwrite');
  const range = IDBKeyRange.bound([profileId, ''], [profileId, '\uffff']);
  const p = reqToPromise(s.delete(range));
  await txDone(s.transaction);
  return p;
}

// ---------- Favicons ----------
// Skema: { host, blob (Blob|null), fetchedAt }
export async function getFavicon(host) {
  return get('favicons', host);
}

export async function putFavicon(host, blob, fetchedAt) {
  return put('favicons', { host, blob, fetchedAt });
}

export async function allHosts() {
  const s = await store('favicons', 'readonly');
  return reqToPromise(s.getAllKeys());
}
