import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Unit tests for the in-book full-text extractor/indexer. The EPUB/PDF parsers,
// filesystem, db and config are mocked so the extraction + upsert logic is
// exercised without real files or a database.
// ---------------------------------------------------------------------------

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../utils/config', () => ({ config: { fulltextMaxChars: 20 } }));

vi.mock('../db', () => ({
  default: { none: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('fs/promises', () => ({
  default: { readFile: vi.fn(async () => Buffer.from('pdf-bytes')) },
}));

vi.mock('pdf-parse', () => ({
  default: vi.fn(async () => ({ text: 'Hello   PDF   world' })),
}));

// Minimal stand-in for the epub2 EPub class (event-emitter + chapter callbacks).
// Defined inside the factory because vi.mock is hoisted above other statements.
vi.mock('epub2', () => {
  class MockEpub {
    private handlers: Record<string, (...args: unknown[]) => void> = {};
    flow = [{ id: 'c1' }, { id: 'c2' }];
    constructor(public path: string) {}
    on(event: string, cb: (...args: unknown[]) => void) {
      this.handlers[event] = cb;
    }
    parse() {
      setTimeout(() => this.handlers['end']?.(), 0);
    }
    getChapter(id: string, cb: (err: Error | null, text?: string) => void) {
      cb(null, `<p>Chapter ${id}</p>`);
    }
  }
  return { default: MockEpub };
});

import { extractFullText, indexBookFullText } from '../services/fulltext';
import db from '../db';
import pdfParse from 'pdf-parse';

const dbMock = db as unknown as { none: ReturnType<typeof vi.fn> };

describe('fulltext extraction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('extracts and normalizes PDF text', async () => {
    const text = await extractFullText('/books/x.pdf', 'PDF');
    expect(text).toBe('Hello PDF world');
  });

  it('extracts EPUB chapters as plain text without markup', async () => {
    const text = await extractFullText('/books/x.epub', 'EPUB');
    expect(text).toContain('Chapter c1');
    expect(text).toContain('Chapter c2');
    expect(text).not.toContain('<p>');
  });

  it('returns empty for unsupported formats', async () => {
    expect(await extractFullText('/books/x.cbz', 'CBZ')).toBe('');
    expect(dbMock.none).not.toHaveBeenCalled();
  });

  it('upserts content and reports it was indexed', async () => {
    const ok = await indexBookFullText('book-1', '/books/x.pdf', 'PDF');
    expect(ok).toBe(true);
    const [sql, params] = dbMock.none.mock.calls[0];
    expect(sql).toContain('INSERT INTO book_fulltext');
    expect(sql).toContain('ON CONFLICT (book_id)');
    expect(params[0]).toBe('book-1');
    expect(params[1]).toBe('Hello PDF world');
  });

  it('caps stored content at fulltextMaxChars', async () => {
    (pdfParse as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: 'x'.repeat(500),
    });
    await indexBookFullText('book-1', '/books/big.pdf', 'PDF');
    const [, params] = dbMock.none.mock.calls[0];
    expect(params[1].length).toBe(20);
  });

  it('skips indexing when there is no extractable text', async () => {
    (pdfParse as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ text: '' });
    const ok = await indexBookFullText('book-2', '/books/empty.pdf', 'PDF');
    expect(ok).toBe(false);
    expect(dbMock.none).not.toHaveBeenCalled();
  });
});
