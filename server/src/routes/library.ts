import { Router } from 'express';
import db from '../db';
import { logger } from '../utils/logger';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth';
import { Author, Series, Tag } from '../types';
import { attachListDetails } from './books';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Get library statistics
router.get('/stats', async (req: AuthRequest, res) => {
  try {
    const bookCount = await db.one<{ count: number }>('SELECT COUNT(*) as count FROM books');
    const authorCount = await db.one<{ count: number }>('SELECT COUNT(*) as count FROM authors');
    const seriesCount = await db.one<{ count: number }>('SELECT COUNT(*) as count FROM series');
    const fileCount = await db.one<{ count: number }>('SELECT COUNT(*) as count FROM book_files');

    const totalSize = await db.one<{ total: number | null }>(
      'SELECT SUM(file_size) as total FROM book_files'
    );

    const formatCounts = await db.manyOrNone<{ format: string; count: number }>(
      'SELECT format, COUNT(*) as count FROM book_files GROUP BY format'
    );

    res.json({
      books: parseInt(bookCount.count.toString()),
      authors: parseInt(authorCount.count.toString()),
      series: parseInt(seriesCount.count.toString()),
      files: parseInt(fileCount.count.toString()),
      totalSize: totalSize.total ? parseInt(totalSize.total.toString()) : 0,
      formatCounts: formatCounts || [],
    });
  } catch (error) {
    logger.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// Get all authors
router.get('/authors', async (req: AuthRequest, res) => {
  try {
    const authors = await db.manyOrNone<Author & { book_count: number }>(
      `SELECT a.*, COUNT(DISTINCT ba.book_id) as book_count
       FROM authors a
       LEFT JOIN book_authors ba ON a.id = ba.author_id
       GROUP BY a.id
       ORDER BY a.sort_name ASC`
    );

    res.json(authors || []);
  } catch (error) {
    logger.error('Get authors error:', error);
    res.status(500).json({ error: 'Failed to get authors' });
  }
});

// Get single author with books
router.get('/authors/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const author = await db.oneOrNone<Author>(
      'SELECT * FROM authors WHERE id = $1',
      [id]
    );

    if (!author) {
      res.status(404).json({ error: 'Author not found' });
      return;
    }

    const books = await db.manyOrNone(
      `SELECT b.* FROM books b
       INNER JOIN book_authors ba ON b.id = ba.book_id
       WHERE ba.author_id = $1
       ORDER BY b.sort_title ASC`,
      [id]
    );

    res.json({
      ...author,
      books: await attachListDetails(books || []),
    });
  } catch (error) {
    logger.error('Get author error:', error);
    res.status(500).json({ error: 'Failed to get author' });
  }
});

// Get all series
router.get('/series', async (req: AuthRequest, res) => {
  try {
    const series = await db.manyOrNone<Series & { book_count: number }>(
      `SELECT s.*, COUNT(DISTINCT b.id) as book_count
       FROM series s
       LEFT JOIN books b ON s.id = b.series_id
       GROUP BY s.id
       ORDER BY s.name ASC`
    );

    res.json(series || []);
  } catch (error) {
    logger.error('Get series error:', error);
    res.status(500).json({ error: 'Failed to get series' });
  }
});

// Get single series with books
router.get('/series/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const series = await db.oneOrNone<Series>(
      'SELECT * FROM series WHERE id = $1',
      [id]
    );

    if (!series) {
      res.status(404).json({ error: 'Series not found' });
      return;
    }

    const books = await db.manyOrNone(
      `SELECT * FROM books
       WHERE series_id = $1
       ORDER BY series_index ASC, sort_title ASC`,
      [id]
    );

    res.json({
      ...series,
      books: await attachListDetails(books || []),
    });
  } catch (error) {
    logger.error('Get series error:', error);
    res.status(500).json({ error: 'Failed to get series' });
  }
});

// Get all tags
router.get('/tags', async (req: AuthRequest, res) => {
  try {
    const tags = await db.manyOrNone<Tag & { book_count: number }>(
      `SELECT t.*, COUNT(DISTINCT bt.book_id) as book_count
       FROM tags t
       LEFT JOIN book_tags bt ON t.id = bt.tag_id
       GROUP BY t.id
       ORDER BY t.name ASC`
    );

    res.json(tags || []);
  } catch (error) {
    logger.error('Get tags error:', error);
    res.status(500).json({ error: 'Failed to get tags' });
  }
});

// Get books by tag
router.get('/tags/:id/books', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const books = await db.manyOrNone(
      `SELECT b.* FROM books b
       INNER JOIN book_tags bt ON b.id = bt.book_id
       WHERE bt.tag_id = $1
       ORDER BY b.sort_title ASC`,
      [id]
    );

    res.json(books || []);
  } catch (error) {
    logger.error('Get books by tag error:', error);
    res.status(500).json({ error: 'Failed to get books' });
  }
});

// Create a tag (admin only — tags are shared library metadata)
router.post('/tags', requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const trimmed = name.trim();
    if (trimmed.length > 255) {
      res.status(400).json({ error: 'name must be at most 255 characters' });
      return;
    }

    const tag = await db.one<Tag>(
      `INSERT INTO tags (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [trimmed]
    );
    res.status(201).json(tag);
  } catch (error) {
    logger.error('Create tag error:', error);
    res.status(500).json({ error: 'Failed to create tag' });
  }
});

// Assign tag to book (admin only)
router.post('/tags/:tagId/books/:bookId', requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { tagId, bookId } = req.params;

    const tag = await db.oneOrNone('SELECT id FROM tags WHERE id = $1', [tagId]);
    if (!tag) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }
    const book = await db.oneOrNone('SELECT id FROM books WHERE id = $1', [bookId]);
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    await db.none(
      `INSERT INTO book_tags (book_id, tag_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [bookId, tagId]
    );
    res.json({ message: 'Tag assigned' });
  } catch (error) {
    logger.error('Assign tag error:', error);
    res.status(500).json({ error: 'Failed to assign tag' });
  }
});

// Remove tag from book (admin only)
router.delete('/tags/:tagId/books/:bookId', requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { tagId, bookId } = req.params;

    await db.none(
      'DELETE FROM book_tags WHERE book_id = $1 AND tag_id = $2',
      [bookId, tagId]
    );
    res.json({ message: 'Tag removed' });
  } catch (error) {
    logger.error('Remove tag error:', error);
    res.status(500).json({ error: 'Failed to remove tag' });
  }
});

export default router;
