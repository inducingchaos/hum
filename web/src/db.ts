// Tiny IndexedDB key-value store: one database, one object store. Holds the
// refresh token, the library, player state and the spike log (plan-web §9).
const DB = "hum";
const STORE = "kv";

let opening: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const kv = {
  get: <T>(key: string) => run<T | undefined>("readonly", (s) => s.get(key)),
  set: (key: string, value: unknown) => run<void>("readwrite", (s) => s.put(value, key)),
  del: (key: string) => run<void>("readwrite", (s) => s.delete(key)),
  clear: () => run<void>("readwrite", (s) => s.clear()),
};
