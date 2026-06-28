import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — the scanner touches the filesystem, the hash util, and the database.
// We replace all three so the tests exercise the branching logic in scan()
// (new file / sibling attach / move-by-hash / in-place change / removal /
// orphan cleanup) without any real I/O.
// ---------------------------------------------------------------------------

vi.mock('../utils/config', () => ({
  config: { booksPath: '/books' },
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// fs/promises — only readdir + stat are used by the scanner.
vi.mock('fs/promises', () => ({
  default: {
    readdir: vi.fn(),
    stat: vi.fn(),
  },
}));

// hashFile is mocked per-path via the diskHashes map below.
vi.mock('../utils/hash', () => ({
  hashFile: vi.fn(),
}));

// Database mock. Each method is a spy; tests assert on the calls the scanner
// makes (relocate update, attach insert, delete, orphan cleanup, etc.).
vi.mock('../db', () => {
  const txInner = { one: vi.fn(), none: vi.fn() };
  const mock = {
    none: vi.fn().mockResolvedValue(undefined),
    manyOrNone: vi.fn().mockResolvedValue([]),
    oneOrNone: vi.fn().mockResolvedValue(null),
    one: vi.fn().mockResolvedValue({ id: 'new-book' }),
    result: vi.fn().mockResolvedValue({ rowCount: 0 }),
    tx: vi.fn(async (cb: (t: typeof txInner) => unknown) => {
      txInner.one.mockResolvedValue({ id: 'new-book' });
      return cb(txInner);
    }),
    _tx: txInner,
  };
  return { default: mock };
});

import fs from 'fs/promises';
import { hashFile } from '../utils/hash';
import db from '../db';
import { LibraryScanner } from '../services/scanner';

// Typed handles to the mocks.
const fsMock = fs as unknown as { readdir: ReturnType<typeof vi.fn>; stat: ReturnType<typeof vi.fn> };
const hashMock = hashFile as unknown as ReturnType<typeof vi.fn>;
const dbMock = db as unknown as {
  none: ReturnType<typeof vi.fn>;
  manyOrNone: ReturnType<typeof vi.fn>;
  oneOrNone: ReturnType<typeof vi.fn>;
  one: ReturnType<typeof vi.fn>;
  result: ReturnType<typeof vi.fn>;
  tx: ReturnType<typeof vi.fn>;
  _tx: { one: ReturnType<typeof vi.fn>; none: ReturnType<typeof vi.fn> };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileEntry(name: string) {
  return { name, isDirectory: () => false, isFile: () => true };
}

/**
 * Configure the simulated disk. `files` maps a path relative to /books to its
 * content hash. All files are placed flat in the /books root directory.
 */
function setDisk(files: Record<string, string>) {
  const names = Object.keys(files);
  fsMock.readdir.mockImplementation(async (dir: string) => {
    if (dir === '/books') return names.map(fileEntry);
    return [];
  });
  fsMock.stat.mockResolvedValue({ size: 1234, mtime: new Date('2026-01-01T00:00:00Z') });
  hashMock.mockImplementation(async (fullPath: string) => {
    const rel = fullPath.replace(/^\/books\//, '');
    return files[rel];
  });
}

/** Build a BookFile-shaped DB row. */
function dbRow(over: Partial<{ id: string; book_id: string; file_path: string; file_hash: string; format: string }>) {
  return {
    id: 'file-1',
    book_id: 'book-1',
    file_path: 'a.epub',
    file_hash: 'hash-a',
    format: 'EPUB',
    file_size: 1234,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.none.mockResolvedValue(undefined);
  dbMock.manyOrNone.mockResolvedValue([]);
  dbMock.oneOrNone.mockResolvedValue(null);
  dbMock.one.mockResolvedValue({ id: 'new-book' });
  dbMock.result.mockResolvedValue({ rowCount: 0 });
  dbMock.tx.mockImplementation(async (cb: (t: typeof dbMock._tx) => unknown) => {
    dbMock._tx.one.mockResolvedValue({ id: 'new-book' });
    return cb(dbMock._tx);
  });
});

// Pull out db.none calls whose SQL matches a fragment.
function noneCallsMatching(fragment: string) {
  return dbMock.none.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes(fragment));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LibraryScanner.scan', () => {
  it('adds a genuinely new file as a new book (transaction)', async () => {
    setDisk({ 'new.epub': 'hash-new' });
    dbMock.manyOrNone.mockResolvedValueOnce([]); // no existing files
    dbMock.oneOrNone.mockResolvedValueOnce(null); // no sibling

    const result = await new LibraryScanner('/books').scan('scan-1');

    expect(result).toEqual({ added: 1, updated: 0, removed: 0 });
    expect(dbMock.tx).toHaveBeenCalledTimes(1); // book+file created atomically
  });

  it('attaches a new format to an existing book via sibling match (no new book)', async () => {
    setDisk({ 'book.pdf': 'hash-pdf' });
    dbMock.manyOrNone.mockResolvedValueOnce([]); // no rows by path/hash
    // sibling lookup finds the existing EPUB's book
    dbMock.oneOrNone.mockResolvedValueOnce({ book_id: 'book-7' });

    const result = await new LibraryScanner('/books').scan('scan-1');

    expect(result).toEqual({ added: 1, updated: 0, removed: 0 });
    // Attached, not created: no transaction, and an INSERT into book_files
    expect(dbMock.tx).not.toHaveBeenCalled();
    const attach = noneCallsMatching('INSERT INTO book_files');
    expect(attach.length).toBe(1);
    expect(attach[0][1]).toContain('book-7'); // attached to the sibling's book
  });

  it('relocates a moved/renamed file by hash instead of duplicating it', async () => {
    setDisk({ 'moved/new-name.epub': 'hash-a' });
    // DB knows this exact content at a different path
    dbMock.manyOrNone.mockResolvedValueOnce([dbRow({ id: 'file-9', file_path: 'old.epub', file_hash: 'hash-a' })]);

    const result = await new LibraryScanner('/books').scan('scan-1');

    expect(result).toEqual({ added: 0, updated: 1, removed: 0 });
    const relocate = noneCallsMatching('SET file_path');
    expect(relocate.length).toBe(1);
    expect(relocate[0][1]).toEqual(['moved/new-name.epub', 1234, expect.any(Date), 'file-9']);
    // The old row must NOT be deleted as "missing"
    expect(noneCallsMatching('DELETE FROM book_files').length).toBe(0);
  });

  it('updates a file changed in place (same path, new hash)', async () => {
    setDisk({ 'a.epub': 'hash-a-v2' });
    dbMock.manyOrNone.mockResolvedValueOnce([dbRow({ id: 'file-1', file_path: 'a.epub', file_hash: 'hash-a' })]);

    const result = await new LibraryScanner('/books').scan('scan-1');

    expect(result).toEqual({ added: 0, updated: 1, removed: 0 });
    const update = noneCallsMatching('SET file_hash');
    expect(update.length).toBe(1);
    expect(update[0][1]).toEqual(['hash-a-v2', 1234, expect.any(Date), 'file-1']);
  });

  it('leaves an unchanged file untouched', async () => {
    setDisk({ 'a.epub': 'hash-a' });
    dbMock.manyOrNone.mockResolvedValueOnce([dbRow({ id: 'file-1', file_path: 'a.epub', file_hash: 'hash-a' })]);

    const result = await new LibraryScanner('/books').scan('scan-1');

    expect(result).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(noneCallsMatching('SET file_hash').length).toBe(0);
    expect(noneCallsMatching('DELETE FROM book_files').length).toBe(0);
  });

  it('removes files that no longer exist on disk', async () => {
    setDisk({}); // empty disk
    dbMock.manyOrNone.mockResolvedValueOnce([dbRow({ id: 'file-gone', file_path: 'gone.epub', file_hash: 'hash-x' })]);

    const result = await new LibraryScanner('/books').scan('scan-1');

    expect(result).toEqual({ added: 0, updated: 0, removed: 1 });
    const del = noneCallsMatching('DELETE FROM book_files');
    expect(del.length).toBe(1);
    expect(del[0][1]).toEqual(['file-gone']);
  });

  it('cleans up orphaned book rows after removals', async () => {
    setDisk({});
    dbMock.manyOrNone.mockResolvedValueOnce([dbRow({ id: 'file-gone', file_path: 'gone.epub', file_hash: 'hash-x' })]);
    dbMock.result.mockResolvedValueOnce({ rowCount: 1 });

    await new LibraryScanner('/books').scan('scan-1');

    const orphanCalls = dbMock.result.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('DELETE FROM books')
    );
    expect(orphanCalls.length).toBe(1);
  });

  it('marks the scan FAILED and rethrows when the disk read throws', async () => {
    // manyOrNone rejects after the initial file listing — forces the catch path
    setDisk({ 'a.epub': 'hash-a' });
    dbMock.manyOrNone.mockRejectedValueOnce(new Error('db down'));

    await expect(new LibraryScanner('/books').scan('scan-1')).rejects.toThrow('db down');
    const failed = dbMock.none.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes("status = 'FAILED'")
    );
    expect(failed.length).toBe(1);
  });
});
