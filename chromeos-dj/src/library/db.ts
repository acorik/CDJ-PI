// IndexedDB mínimo con promesas. Stores:
//  tracks (id) · waves (id -> Uint8Array) · roots (id -> handle) · crates · history · kv
const DB_NAME = "cdjpi-dj";
const VERSION = 2;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ["tracks", "waves", "roots", "crates", "history", "kv", "samples"]) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export type StoreName = "tracks" | "waves" | "roots" | "crates" | "history" | "kv" | "samples";

export async function dbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function dbPut(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, "readwrite").objectStore(store).put(value, key));
}

export async function dbDelete(store: StoreName, key: string): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, "readwrite").objectStore(store).delete(key));
}

export async function dbAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

export async function dbPutMany(store: StoreName, items: [string, unknown][]): Promise<void> {
  if (!items.length) return;
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const [k, v] of items) os.put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function dbClear(store: StoreName): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, "readwrite").objectStore(store).clear());
}
