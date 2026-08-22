// ============================================================================
//  IndexedDB cache for downloaded audio samples.
//
//  Devices download each sample from Supabase Storage ONCE and keep the bytes
//  locally, so a live performance keeps working if the venue's internet drops
//  after the first sync. Keyed by the sample's database id.
//
//  v2 adds a `meta` store (last-used time + size) so the cache can be capped
//  and evicted least-recently-used, and surfaces quota errors instead of
//  swallowing them — a full disk used to make caching silently stop, which
//  looked exactly like working until the venue wifi went down.
// ============================================================================

const DB_NAME = 'wingbeat-samples';
const DB_VERSION = 2;
const STORE = 'buffers';
const META = 'meta';

/** Keep the cache under this many bytes (LRU eviction on put). */
export const CACHE_CAP_BYTES = 250 * 1024 * 1024;

interface Meta { at: number; size: number }

let lastError = '';
/** The most recent cache failure, for an operator surface. */
export function cacheLastError(): string {
  return lastError;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('cache blocked by another tab'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheGet(id: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    const buf = await reqResult(db.transaction(STORE, 'readonly').objectStore(STORE).get(id));
    if (!(buf instanceof ArrayBuffer)) return null;
    // touch for LRU (best-effort, separate tx so a failure can't lose the read)
    try {
      const tx = db.transaction(META, 'readwrite');
      tx.objectStore(META).put({ at: Date.now(), size: buf.byteLength } satisfies Meta, id);
      await txDone(tx);
    } catch { /* fine */ }
    return buf;
  } catch {
    return null; // private mode / no IndexedDB — cache is best-effort
  }
}

/** Store a sample. Returns false (and records why) when it couldn't. */
export async function cachePut(id: string, buf: ArrayBuffer): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORE, META], 'readwrite');
    tx.objectStore(STORE).put(buf, id);
    tx.objectStore(META).put({ at: Date.now(), size: buf.byteLength } satisfies Meta, id);
    await txDone(tx);
    lastError = '';
    void evict(db).catch(() => {});
    return true;
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    lastError = name === 'QuotaExceededError'
      ? 'sample cache is full (storage quota) — clear site data or free disk space'
      : `sample cache write failed: ${(err as Error)?.message ?? err}`;
    console.warn('[wingbeat]', lastError);
    return false;
  }
}

export async function cacheDelete(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORE, META], 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.objectStore(META).delete(id);
    await txDone(tx);
  } catch {
    /* best-effort */
  }
}

/** Total bytes + count, for the operator's storage line. */
export async function cacheStats(): Promise<{ bytes: number; count: number }> {
  try {
    const db = await openDb();
    const metas = await reqResult(db.transaction(META, 'readonly').objectStore(META).getAll()) as Meta[];
    return { bytes: metas.reduce((a, m) => a + (m?.size ?? 0), 0), count: metas.length };
  } catch {
    return { bytes: 0, count: 0 };
  }
}

/** Drop least-recently-used samples until under CACHE_CAP_BYTES. */
async function evict(db: IDBDatabase): Promise<void> {
  const meta = db.transaction(META, 'readonly').objectStore(META);
  const keys = (await reqResult(meta.getAllKeys())) as string[];
  const metas = (await reqResult(meta.getAll())) as Meta[];
  const rows = keys.map((k, i) => ({ id: k, ...(metas[i] ?? { at: 0, size: 0 }) }));
  let total = rows.reduce((a, r) => a + r.size, 0);
  if (total <= CACHE_CAP_BYTES) return;
  rows.sort((a, b) => a.at - b.at);
  const tx = db.transaction([STORE, META], 'readwrite');
  for (const r of rows) {
    if (total <= CACHE_CAP_BYTES) break;
    tx.objectStore(STORE).delete(r.id);
    tx.objectStore(META).delete(r.id);
    total -= r.size;
  }
  await txDone(tx);
}
