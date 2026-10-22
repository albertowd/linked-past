// Tiny IndexedDB key/value store. The ROM, harvested atlas and local SRAM backups live here
// and never leave the device (only SRAM is synced to the player's account).
// Named after the project's old name; renaming it would orphan every saved ROM and SRAM.
const DB = 'hylure';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function get<T>(key: string): Promise<T | undefined> {
  try {
    return await run<T>('readonly', (s) => s.get(key));
  } catch {
    return undefined;
  }
}

export async function set(key: string, value: unknown): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(value, key));
  } catch (err) {
    console.warn('storage unavailable', err);
  }
}

export async function del(key: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(key));
  } catch {
    /* storage unavailable */
  }
}
