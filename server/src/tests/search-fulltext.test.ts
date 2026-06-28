import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Verify the search route folds the in-book full-text index (book_fulltext)
// into its full-text query when a query string is supplied. The db and helpers
// are mocked so we can inspect the generated SQL.

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../middleware/auth', () => ({
  authenticateToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../routes/books', () => ({ attachListDetails: vi.fn(async (rows: unknown) => rows) }));
vi.mock('../db', () => ({
  default: { one: vi.fn(), manyOrNone: vi.fn() },
}));

let app: express.Express;

beforeAll(async () => {
  const { default: searchRoutes } = await import('../routes/search');
  app = express();
  app.use(express.json());
  app.use('/api/search', searchRoutes);
});

beforeEach(() => vi.clearAllMocks());

describe('POST /api/search full-text wiring', () => {
  it('matches book_fulltext when a query is present', async () => {
    const db = (await import('../db')).default as any;
    db.one.mockResolvedValueOnce({ count: 0 });
    db.manyOrNone.mockResolvedValueOnce([]);

    const res = await request(app).post('/api/search').send({ query: 'dragons' });

    expect(res.status).toBe(200);
    expect(db.one.mock.calls[0][0]).toContain('book_fulltext');
    expect(db.manyOrNone.mock.calls[0][0]).toContain('book_fulltext');
  });

  it('omits the full-text condition entirely when no query is given', async () => {
    const db = (await import('../db')).default as any;
    db.one.mockResolvedValueOnce({ count: 0 });
    db.manyOrNone.mockResolvedValueOnce([]);

    const res = await request(app).post('/api/search').send({});

    expect(res.status).toBe(200);
    expect(db.one.mock.calls[0][0]).not.toContain('book_fulltext');
  });
});
