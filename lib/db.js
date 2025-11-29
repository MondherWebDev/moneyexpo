const DB_NAME = "meq-badges";
const DB_VERSION = 1;
const STORES = {
  visitors: "visitors",
  offline: "offline",
  checkins: "checkins",
};

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not supported"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.visitors)) {
        db.createObjectStore(STORES.visitors, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.offline)) {
        db.createObjectStore(STORES.offline, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.checkins)) {
        db.createObjectStore(STORES.checkins, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveVisitorsCache(list) {
  try {
    await withStore(STORES.visitors, "readwrite", (store) => {
      store.clear();
      list.forEach((item) => store.put(item));
    });
  } catch (_) {
    /* ignore */
  }
}

export async function getVisitorsCache() {
  try {
    return await withStore(STORES.visitors, "readonly", (store) => {
      return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    });
  } catch (_) {
    return [];
  }
}

export async function saveOfflineCache(list) {
  try {
    await withStore(STORES.offline, "readwrite", (store) => {
      store.clear();
      list.forEach((item) => store.put(item));
    });
  } catch (_) {
    /* ignore */
  }
}

export async function getOfflineCache() {
  try {
    return await withStore(STORES.offline, "readonly", (store) => {
      return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    });
  } catch (_) {
    return [];
  }
}

export async function saveCheckinsCache(map) {
  try {
    const entries = Object.entries(map || {}).map(([id, value]) => ({ id, ...value }));
    await withStore(STORES.checkins, "readwrite", (store) => {
      store.clear();
      entries.forEach((item) => store.put(item));
    });
  } catch (_) {
    /* ignore */
  }
}

export async function getCheckinsCache() {
  try {
    const rows = await withStore(STORES.checkins, "readonly", (store) => {
      return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    });
    return rows.reduce((acc, row) => {
      if (row && row.id) acc[row.id] = { status: row.status, time: row.time };
      return acc;
    }, {});
  } catch (_) {
    return {};
  }
}
