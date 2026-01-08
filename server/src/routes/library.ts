import { Router } from 'express';
import db from '../db';
import { logger } from '../utils/logger';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { Author, Series, Tag } from '../types';

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
      books: books || [],
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
      books: books || [],
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

export default router;
