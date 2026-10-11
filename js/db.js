const DB_NAME = 'annamaya';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('kv');
        db.createObjectStore('menus', { keyPath: 'key' });
        db.createObjectStore('photos');
        db.createObjectStore('days', { keyPath: 'date' });
        const logs = db.createObjectStore('logs', { keyPath: 'id' });
        logs.createIndex('date', 'date');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const done = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function store(name, mode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const kv = {
  get: async (key, fallback = null) => (await done((await store('kv')).get(key))) ?? fallback,
  set: async (key, value) => done((await store('kv', 'readwrite')).put(value, key)),
};

export const menus = {
  get: async (key) => done((await store('menus')).get(key)),
  all: async () => done((await store('menus')).getAll()),
  put: async (menu) => done((await store('menus', 'readwrite')).put(menu)),
  remove: async (key) => done((await store('menus', 'readwrite')).delete(key)),
};

export const logs = {
  all: async () => done((await store('logs')).getAll()),
  forDate: async (date) => done((await store('logs')).index('date').getAll(date)),
  range: async (from, to) => done((await store('logs')).index('date').getAll(IDBKeyRange.bound(from, to))),
  put: async (log) => done((await store('logs', 'readwrite')).put(log)),
  remove: async (id) => done((await store('logs', 'readwrite')).delete(id)),
};

export const photos = {
  get: async (id) => done((await store('photos')).get(id)),
  put: async (id, blob) => done((await store('photos', 'readwrite')).put(blob, id)),
  remove: async (id) => done((await store('photos', 'readwrite')).delete(id)),
};

export const days = {
  get: async (date) => (await done((await store('days')).get(date))) || { date, water: 0 },
  all: async () => done((await store('days')).getAll()),
  put: async (day) => done((await store('days', 'readwrite')).put(day)),
};

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export async function exportAll({ includePhotos = true } = {}) {
  const db = await open();
  const out = { app: 'annamaya', version: DB_VERSION, exportedAt: new Date().toISOString() };
  out.logs = await logs.all();
  out.days = await days.all();
  out.menus = await menus.all();
  out.kv = {};
  for (const key of ['profile', 'targets', 'times', 'prefs']) out.kv[key] = await kv.get(key);
  out.photos = {};
  if (includePhotos) {
    const tx = db.transaction('photos').objectStore('photos');
    const keys = await done(tx.getAllKeys());
    for (const k of keys) {
      const blob = await photos.get(k);
      if (blob) out.photos[k] = await blobToDataUrl(blob);
    }
  }
  return out;
}

export async function importAll(data) {
  if (!data || data.app !== 'annamaya') throw new Error('This is not an Annamaya backup file.');
  for (const log of data.logs || []) await logs.put(log);
  for (const day of data.days || []) await days.put(day);
  for (const menu of data.menus || []) await menus.put(menu);
  for (const [key, value] of Object.entries(data.kv || {})) if (value != null) await kv.set(key, value);
  for (const [id, url] of Object.entries(data.photos || {})) {
    await photos.put(id, await (await fetch(url)).blob());
  }
  return { logs: (data.logs || []).length };
}

export async function wipeAll() {
  const db = await open();
  for (const name of ['logs', 'photos', 'days']) await done(db.transaction(name, 'readwrite').objectStore(name).clear());
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
  }
  return false;
}
