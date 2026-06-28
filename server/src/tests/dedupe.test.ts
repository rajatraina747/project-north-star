import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// The /admin/duplicates report does its near-duplicate grouping in JS (title+
// author normalization, ISBN-10/13 grouping with per-book de-duplication). We
// drive the two DB queries with fixtures and assert the grouping. Auth
// middleware is stubbed to pass through.
// ---------------------------------------------------------------------------

vi.mock('../utils/config', () => ({ config: {} }));
vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../services/series', () => ({ refreshSeriesCatalog: vi.fn() }));

vi.mock('../middleware/auth', () => ({
  authenticateToken: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../db', () => {
  const mock = { manyOrNone: vi.fn(), one: vi.fn(), none: vi.fn(), oneOrNone: vi.fn() };
  return { default: mock };
});

import db from '../db';
const dbMock = db as unknown as { manyOrNone: ReturnType<typeof vi.fn> };

let app: express.Express;

beforeAll(async () => {
  const { default: adminRoutes } = await import('../routes/admin');
  app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
});

beforeEach(() => {
  vi.clearAllMocks();
});

/** A row shaped like the per-book summary query result. */
function bookRow(over: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    title: 'Some Book',
    isbn_10: null,
    isbn_13: null,
    primary_author: null,
    total_size: '100',
    formats: ['EPUB'],
    paths: ['some.epub'],
    ...over,
  };
}

/** Stub the two queries the route runs, in order: exactHash, then books. */
function stubQueries(exactHash: unknown[], books: unknown[]) {
  dbMock.manyOrNone.mockResolvedValueOnce(exactHash).mockResolvedValueOnce(books);
}

describe('GET /api/admin/duplicates', () => {
  it('groups distinct books that share a normalized title + author', async () => {
    stubQueries(
      [],
      [
        bookRow({ id: 'b1', title: 'The Hobbit', primary_author: 'J.R.R. Tolkien' }),
        bookRow({ id: 'b2', title: '  the   hobbit ', primary_author: 'j.r.r. tolkien' }),
        bookRow({ id: 'b3', title: 'Dune', primary_author: 'Herbert' }),
      ]
    );

    const res = await request(app).get('/api/admin/duplicates');

    expect(res.status).toBe(200);
    expect(res.body.byTitleAuthor).toHaveLength(1);
    expect(res.body.byTitleAuthor[0].books.map((b: { id: string }) => b.id).sort()).toEqual(['b1', 'b2']);
    expect(res.body.counts.titleAuthor).toBe(1);
  });

  it('does not group books whose title is empty', async () => {
    stubQueries(
      [],
      [
        bookRow({ id: 'b1', title: '', primary_author: 'X' }),
        bookRow({ id: 'b2', title: '   ', primary_author: 'X' }),
      ]
    );

    const res = await request(app).get('/api/admin/duplicates');

    expect(res.body.byTitleAuthor).toHaveLength(0);
  });

  it('groups by ISBN across isbn_10/isbn_13 and ignores formatting', async () => {
    stubQueries(
      [],
      [
        bookRow({ id: 'b1', title: 'A', isbn_13: '978-0-13-468599-1' }),
        bookRow({ id: 'b2', title: 'A copy', isbn_13: '9780134685991' }),
        bookRow({ id: 'b3', title: 'B', isbn_13: '0000000000000' }),
      ]
    );

    const res = await request(app).get('/api/admin/duplicates');

    expect(res.body.byIsbn).toHaveLength(1);
    expect(res.body.byIsbn[0].isbn).toBe('9780134685991');
    expect(res.body.byIsbn[0].books.map((b: { id: string }) => b.id).sort()).toEqual(['b1', 'b2']);
  });

  it('does not list the same book twice when its isbn_10 and isbn_13 collide on another book', async () => {
    // b1 has both ISBNs; b2 shares only the 13. b1 must appear once in the group.
    stubQueries(
      [],
      [
        bookRow({ id: 'b1', title: 'A', isbn_10: '0134685997', isbn_13: '9780134685991' }),
        bookRow({ id: 'b2', title: 'A copy', isbn_13: '9780134685991' }),
      ]
    );

    const res = await request(app).get('/api/admin/duplicates');

    const group = res.body.byIsbn.find((g: { isbn: string }) => g.isbn === '9780134685991');
    expect(group.books.filter((b: { id: string }) => b.id === 'b1')).toHaveLength(1);
  });

  it('passes through exact-hash duplicates and reports counts', async () => {
    const exact = [{ file_hash: 'h1', files: [{ book_id: 'b1' }, { book_id: 'b2' }] }];
    stubQueries(exact, [bookRow()]);

    const res = await request(app).get('/api/admin/duplicates');

    expect(res.body.exactHash).toEqual(exact);
    expect(res.body.counts).toEqual({ exactHash: 1, titleAuthor: 0, isbn: 0 });
  });

  it('returns 500 when the query fails', async () => {
    dbMock.manyOrNone.mockRejectedValueOnce(new Error('db error'));

    const res = await request(app).get('/api/admin/duplicates');

    expect(res.status).toBe(500);
  });
});
