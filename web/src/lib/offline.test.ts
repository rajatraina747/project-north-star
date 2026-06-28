import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  putBookData,
  getBookData,
  loadBookArrayBuffer,
  enqueueProgress,
  getQueuedProgress,
  removeQueuedProgress,
  _clearForTests,
} from './offline';

const bytes = (s: string) => new TextEncoder().encode(s).buffer;
const text = (b: ArrayBuffer) => new TextDecoder().decode(b);

// A plain fetch stub returning the given bytes — avoids jsdom's Response/Blob
// quirks where Response(blob).arrayBuffer() doesn't round-trip.
const okFetch = (data: string) =>
  vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes(data) })) as never;

beforeEach(async () => {
  await _clearForTests();
});

describe('offline book cache', () => {
  it('round-trips cached book bytes', async () => {
    await putBookData('b1', 'f1', bytes('hello'));
    const got = await getBookData('b1', 'f1');
    expect(got).toBeTruthy();
    expect(text(got!)).toBe('hello');
  });

  it('returns null when a book is not cached', async () => {
    expect(await getBookData('nope', 'nope')).toBeNull();
  });

  it('loadBookArrayBuffer fetches, caches, and returns the bytes', async () => {
    globalThis.fetch = okFetch('DATA');
    const buf = await loadBookArrayBuffer('b1', 'f1', '/api/books/b1/file/f1', 'tok');
    expect(text(buf)).toBe('DATA');
    // It was cached for offline use.
    expect(await getBookData('b1', 'f1')).toBeTruthy();
  });

  it('falls back to the cached bytes when the fetch fails (offline)', async () => {
    await putBookData('b1', 'f1', bytes('CACHED'));
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as never;
    const buf = await loadBookArrayBuffer('b1', 'f1', '/api/books/b1/file/f1', 'tok');
    expect(text(buf)).toBe('CACHED');
  });

  it('throws when the fetch fails and nothing is cached', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as never;
    await expect(loadBookArrayBuffer('z', 'z', '/api/x', null)).rejects.toThrow();
  });
});

describe('offline progress queue', () => {
  it('enqueues, lists, and removes entries', async () => {
    await enqueueProgress({ id: 'b1:f1', bookId: 'b1', fileId: 'f1', payload: { progress_percent: 10 }, queuedAt: 1 });
    expect(await getQueuedProgress()).toHaveLength(1);
    await removeQueuedProgress('b1:f1');
    expect(await getQueuedProgress()).toHaveLength(0);
  });

  it('overwrites an older queued update for the same book/file', async () => {
    await enqueueProgress({ id: 'b1:f1', bookId: 'b1', fileId: 'f1', payload: { progress_percent: 10 }, queuedAt: 1 });
    await enqueueProgress({ id: 'b1:f1', bookId: 'b1', fileId: 'f1', payload: { progress_percent: 90 }, queuedAt: 2 });
    const items = await getQueuedProgress();
    expect(items).toHaveLength(1);
    expect(items[0].payload.progress_percent).toBe(90);
  });
});
