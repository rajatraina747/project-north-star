// Offline storage for the PWA. A tiny IndexedDB wrapper (no dependency) with two
// stores: cached book file blobs (so an already-opened book can be re-read with
// no network) and a queue of reading-progress updates that failed to reach the
// server (replayed when back online — see progressSync.ts).

const DB_NAME = 'northstar-offline';
const DB_VERSION = 1;
const BOOKS_STORE = 'books';
const QUEUE_STORE = 'progress-queue';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BOOKS_STORE)) db.createObjectStore(BOOKS_STORE);
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function runRequest<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = fn(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      })
  );
}

const bookKey = (bookId: string, fileId: string) => `${bookId}:${fileId}`;

// Book bytes are stored as ArrayBuffer rather than Blob: ArrayBuffer survives
// IndexedDB's structured clone intact, whereas a Blob can lose its methods.

/** Cache a book file's bytes for offline reading (best-effort). */
export function putBookData(bookId: string, fileId: string, data: ArrayBuffer): Promise<void> {
  return runRequest<IDBValidKey>(BOOKS_STORE, 'readwrite', (s) =>
    s.put(data, bookKey(bookId, fileId))
  ).then(() => undefined);
}

/** Read a previously cached book file's bytes, or null if not cached. */
export function getBookData(bookId: string, fileId: string): Promise<ArrayBuffer | null> {
  return runRequest<ArrayBuffer | undefined>(BOOKS_STORE, 'readonly', (s) =>
    s.get(bookKey(bookId, fileId))
  ).then((b) => b ?? null);
}

/**
 * Load a book file as an ArrayBuffer, transparently caching it for offline use.
 * Tries the network first (and stores the bytes); if that fails (offline/server
 * unreachable) it falls back to the cached copy, throwing only if neither works.
 */
export async function loadBookArrayBuffer(
  bookId: string,
  fileId: string,
  fileUrl: string,
  token: string | null
): Promise<ArrayBuffer> {
  try {
    const res = await fetch(fileUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Failed to load book: ${res.status} ${res.statusText}`);
    const buffer = await res.arrayBuffer();
    putBookData(bookId, fileId, buffer).catch(() => undefined);
    return buffer;
  } catch (err) {
    const cached = await getBookData(bookId, fileId).catch(() => null);
    if (cached) return cached;
    throw err;
  }
}

export interface QueuedProgress {
  // Keyed by book+file so a newer update overwrites an older queued one.
  id: string;
  bookId: string;
  fileId: string;
  payload: Record<string, unknown>;
  queuedAt: number;
}

export function enqueueProgress(entry: QueuedProgress): Promise<void> {
  return runRequest<IDBValidKey>(QUEUE_STORE, 'readwrite', (s) => s.put(entry)).then(() => undefined);
}

export function getQueuedProgress(): Promise<QueuedProgress[]> {
  return runRequest<QueuedProgress[]>(QUEUE_STORE, 'readonly', (s) => s.getAll()).then(
    (rows) => rows ?? []
  );
}

export function removeQueuedProgress(id: string): Promise<void> {
  return runRequest<undefined>(QUEUE_STORE, 'readwrite', (s) => s.delete(id)).then(() => undefined);
}

/** Test-only: empty both object stores between cases (keeps one connection). */
export async function _clearForTests(): Promise<void> {
  await runRequest<undefined>(BOOKS_STORE, 'readwrite', (s) => s.clear());
  await runRequest<undefined>(QUEUE_STORE, 'readwrite', (s) => s.clear());
}
