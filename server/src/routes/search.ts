import { Router } from 'express';
import db from '../db';
import { logger } from '../utils/logger';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { SearchRequest, SearchResponse, Book } from '../types';
import { attachListDetails } from './books';
import {
  resolveSort,
  orderByClause,
  cursorKeySelect,
  keysetClause,
  decodeCursor,
  paginate,
  WithCursorKey,
} from '../utils/cursor';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Search books
router.post('/', async (req: AuthRequest, res) => {
  try {
    const searchReq = req.body as SearchRequest;
    const { query, filters, sort = 'title', limit = 50, offset = 0 } = searchReq;
    const cursor = decodeCursor(searchReq.cursor);
    const spec = resolveSort(sort, 'title');

    const whereConditions: string[] = [];
    const params: (string | number | string[])[] = [];
    let paramIndex = 1;

    // Full-text search on title, author, description
    if (query && query.trim()) {
      whereConditions.push(`(
        to_tsvector('english', b.title) @@ plainto_tsquery('english', $${paramIndex})
        OR to_tsvector('english', COALESCE(b.description, '')) @@ plainto_tsquery('english', $${paramIndex})
        OR EXISTS (
          SELECT 1 FROM authors a
          INNER JOIN book_authors ba ON a.id = ba.author_id
          WHERE ba.book_id = b.id
          AND to_tsvector('english', a.name) @@ plainto_tsquery('english', $${paramIndex})
        )
      )`);
      params.push(query.trim());
      paramIndex++;
    }

    // Filter by format
    if (filters?.formats && filters.formats.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM book_files bf
        WHERE bf.book_id = b.id
        AND bf.format = ANY($${paramIndex})
      )`);
      params.push(filters.formats);
      paramIndex++;
    }

    // Filter by language
    if (filters?.language) {
      whereConditions.push(`b.language = $${paramIndex}`);
      params.push(filters.language);
      paramIndex++;
    }

    // Filter by series
    if (filters?.series && filters.series.length > 0) {
      whereConditions.push(`b.series_id = ANY($${paramIndex})`);
      params.push(filters.series);
      paramIndex++;
    }

    // Filter by tags
    if (filters?.tags && filters.tags.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM book_tags bt
        WHERE bt.book_id = b.id
        AND bt.tag_id = ANY($${paramIndex})
      )`);
      params.push(filters.tags);
      paramIndex++;
    }

    // Filter by authors
    if (filters?.authors && filters.authors.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM book_authors ba
        WHERE ba.book_id = b.id
        AND ba.author_id = ANY($${paramIndex})
      )`);
      params.push(filters.authors);
      paramIndex++;
    }

    // Count reflects the full filtered set (no keyset/limit), so compute it from
    // the filter-only WHERE before appending any pagination predicate.
    const countWhere = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';
    const totalResult = await db.one<{ count: number }>(
      `SELECT COUNT(DISTINCT b.id) as count FROM books b
       ${countWhere}`,
      params
    );

    // Page query: when a cursor is supplied, seek past it with keyset semantics;
    // otherwise fall back to OFFSET so existing offset-based callers still work.
    const pageParams: (string | number | string[])[] = [...params];
    if (cursor) {
      const { clause, values } = keysetClause(spec, cursor, paramIndex);
      whereConditions.push(clause);
      pageParams.push(...values);
      paramIndex += 2;
    }
    const pageWhere = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // Fetch limit + 1 to detect whether another page exists.
    const limitParam = paramIndex;
    pageParams.push(limit + 1);
    let tail = `LIMIT $${limitParam}`;
    if (!cursor && offset > 0) {
      pageParams.push(offset);
      tail += ` OFFSET $${limitParam + 1}`;
    }

    const rows = await db.manyOrNone<WithCursorKey<Book>>(
      `SELECT DISTINCT b.*, ${cursorKeySelect(spec)} FROM books b
       ${pageWhere}
       ORDER BY ${orderByClause(spec)}
       ${tail}`,
      pageParams
    );

    const { page, nextCursor } = paginate(rows || [], limit);

    const response: SearchResponse = {
      books: (await attachListDetails(page)) as unknown as SearchResponse['books'],
      total: parseInt(totalResult.count.toString()),
      limit,
      offset,
      nextCursor,
    };

    res.json(response);
  } catch (error) {
    logger.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Quick search (autocomplete)
router.get('/quick', async (req: AuthRequest, res) => {
  try {
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!query || query.trim().length < 2) {
      res.json([]);
      return;
    }

    const books = await db.manyOrNone<Book>(
      `SELECT b.id, b.title, b.cover_path, b.thumbnail_path
       FROM books b
       WHERE b.title ILIKE $1
       ORDER BY b.sort_title ASC
       LIMIT $2`,
      [`%${query.trim()}%`, limit]
    );

    res.json(books || []);
  } catch (error) {
    logger.error('Quick search error:', error);
    res.status(500).json({ error: 'Quick search failed' });
  }
});

export default router;
