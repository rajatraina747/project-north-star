import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// POST /api/admin/reindex-fulltext backfills the in-book index. We mock auth,
// the fulltext service and the db so the route's selection + counting logic is
// tested in isolation.

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../utils/config', () => ({ config: { booksPath: '/books' } }));
vi.mock('../middleware/auth', () => ({
  authenticateToken: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/series', () => ({ refreshSeriesCatalog: vi.fn() }));
vi.mock('../services/fulltext', () => ({ indexBookFullText: vi.fn(async () => true) }));
vi.mock('../db', () => ({
  default: { manyOrNone: vi.fn(), one: vi.fn(), oneOrNone: vi.fn(), none: vi.fn() },
}));

let app: express.Express;

beforeAll(async () => {
  const { default: adminRoutes } = await import('../routes/admin');
  app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
});

beforeEach(() => vi.clearAllMocks());

describe('POST /api/admin/reindex-fulltext', () => {
  it('indexes books missing full text and reports counts', async () => {
    const db = (await import('../db')).default as any;
    db.manyOrNone.mockResolvedValueOnce([
      { book_id: 'b1', file_path: 'a.epub', format: 'EPUB' },
      { book_id: 'b2', file_path: 'b.pdf', format: 'PDF' },
    ]);
    const { indexBookFullText } = (await import('../services/fulltext')) as any;
    indexBookFullText.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const res = await request(app).post('/api/admin/reindex-fulltext').send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ indexed: 1, skipped: 1, total: 2 });
    expect(indexBookFullText).toHaveBeenCalledWith('b1', '/books/a.epub', 'EPUB');
    // Default run only targets un-indexed books.
    expect(db.manyOrNone.mock.calls[0][0]).toContain('NOT EXISTS');
  });

  it('reindexes everything when force=true', async () => {
    const db = (await import('../db')).default as any;
    db.manyOrNone.mockResolvedValueOnce([]);

    const res = await request(app).post('/api/admin/reindex-fulltext').send({ force: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ indexed: 0, total: 0 });
    expect(db.manyOrNone.mock.calls[0][0]).not.toContain('NOT EXISTS');
  });

  it('counts a thrown indexer as skipped rather than failing the request', async () => {
    const db = (await import('../db')).default as any;
    db.manyOrNone.mockResolvedValueOnce([{ book_id: 'b1', file_path: 'a.epub', format: 'EPUB' }]);
    const { indexBookFullText } = (await import('../services/fulltext')) as any;
    indexBookFullText.mockRejectedValueOnce(new Error('parse boom'));

    const res = await request(app).post('/api/admin/reindex-fulltext').send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ indexed: 0, skipped: 1, total: 1 });
  });
});
