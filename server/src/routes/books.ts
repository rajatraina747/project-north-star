import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import db from '../db';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { Book, BookWithDetails, Author, Series, Tag, BookFile, UpdateBookRequest } from '../types';
import { buildSeriesContext } from '../services/series';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Get all books with pagination
router.get('/', async (req: AuthRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const sort = req.query.sort as string || 'title';

    let orderBy = 'b.sort_title ASC';
    if (sort === 'recent') {
      orderBy = 'b.created_at DESC';
    } else if (sort === 'updated') {
      orderBy = 'b.updated_at DESC';
    }

    const books = await db.manyOrNone<Book>(
      `SELECT b.* FROM books b
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const total = await db.one<{ count: number }>(
      'SELECT COUNT(*) as count FROM books'
    );

    res.json({
      books,
      total: parseInt(total.count.toString()),
      limit,
      offset,
    });
  } catch (error) {
    logger.error('Get books error:', error);
    res.status(500).json({ error: 'Failed to get books' });
  }
});

// Get recently added books
router.get('/recent', async (req: AuthRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;

    const books = await db.manyOrNone<Book>(
      `SELECT b.* FROM books b
       ORDER BY b.created_at DESC
       LIMIT $1`,
      [limit]
    );

    res.json(books);
  } catch (error) {
    logger.error('Get recent books error:', error);
    res.status(500).json({ error: 'Failed to get recent books' });
  }
});

// Get continue reading (books with progress)
router.get('/continue', async (req: AuthRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;

    const results = await db.manyOrNone(
      `SELECT
        b.*,
        rp.progress_percent,
        rp.last_read_at,
        rp.id as progress_id,
        rp.book_file_id,
        rp.epub_cfi,
        rp.pdf_page,
        rp.pdf_scroll_position
       FROM books b
       INNER JOIN reading_progress rp ON b.id = rp.book_id
       WHERE rp.user_id = $1 AND rp.progress_percent < 100
       ORDER BY rp.last_read_at DESC
       LIMIT $2`,
      [req.user!.id, limit]
    );

    // Transform to include progress data with each book
    const booksWithProgress = results.map((row: any) => ({
      book: {
        id: row.id,
        title: row.title,
        sort_title: row.sort_title,
        subtitle: row.subtitle,
        description: row.description,
        publisher: row.publisher,
        published_date: row.published_date,
        language: row.language,
        isbn_10: row.isbn_10,
        isbn_13: row.isbn_13,
        series_id: row.series_id,
        series_index: row.series_index,
        page_count: row.page_count,
        cover_path: row.cover_path,
        thumbnail_path: row.thumbnail_path,
        metadata_locked: row.metadata_locked,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      progress: {
        id: row.progress_id,
        user_id: req.user!.id,
        book_id: row.id,
        book_file_id: row.book_file_id,
        progress_percent: parseFloat(row.progress_percent) || 0,
        epub_cfi: row.epub_cfi,
        pdf_page: row.pdf_page,
        pdf_scroll_position: row.pdf_scroll_position,
        last_read_at: row.last_read_at,
      }
    }));

    res.json(booksWithProgress);
  } catch (error) {
    logger.error('Get continue reading error:', error);
    res.status(500).json({ error: 'Failed to get continue reading' });
  }
});

// Get single book with full details
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const book = await db.oneOrNone<Book>(
      'SELECT * FROM books WHERE id = $1',
      [id]
    );

    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    // Get authors
    const authors = await db.manyOrNone<Author>(
      `SELECT a.* FROM authors a
       INNER JOIN book_authors ba ON a.id = ba.author_id
       WHERE ba.book_id = $1
       ORDER BY ba.author_index`,
      [id]
    );

    // Get series
    let series = null;
    if (book.series_id) {
      series = await db.oneOrNone<Series>(
        'SELECT * FROM series WHERE id = $1',
        [book.series_id]
      );
    }

    const seriesContext = await buildSeriesContext(book, series);

    // Get tags
    const tags = await db.manyOrNone<Tag>(
      `SELECT t.* FROM tags t
       INNER JOIN book_tags bt ON t.id = bt.tag_id
       WHERE bt.book_id = $1`,
      [id]
    );

    // Get files
    const files = await db.manyOrNone<BookFile>(
      'SELECT * FROM book_files WHERE book_id = $1',
      [id]
    );

    const bookWithDetails: BookWithDetails = {
      ...book,
      authors: authors || [],
      series,
      series_total: seriesContext?.total ?? null,
      series_context: seriesContext,
      tags: tags || [],
      files: files || [],
    };

    res.json(bookWithDetails);
  } catch (error) {
    logger.error('Get book error:', error);
    res.status(500).json({ error: 'Failed to get book' });
  }
});

// Update book metadata
router.patch('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const updates = req.body as UpdateBookRequest;

    const book = await db.oneOrNone('SELECT id FROM books WHERE id = $1', [id]);
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = $${paramIndex++}`);
        values.push(value);
      }
    });

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    values.push(id);

    const updatedBook = await db.one<Book>(
      `UPDATE books SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    res.json(updatedBook);
  } catch (error) {
    logger.error('Update book error:', error);
    res.status(500).json({ error: 'Failed to update book' });
  }
});

// Get book cover image
router.get('/:id/cover', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const book = await db.oneOrNone<{ cover_path: string | null; thumbnail_path: string | null }>(
      'SELECT cover_path, thumbnail_path FROM books WHERE id = $1',
      [id]
    );

    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    const thumbnail = req.query.thumbnail === 'true';
    const imagePath = thumbnail ? book.thumbnail_path : book.cover_path;

    if (!imagePath) {
      res.status(404).json({ error: 'Cover not found' });
      return;
    }

    const fullPath = path.join(thumbnail ? config.thumbnailsPath : config.coversPath, imagePath);

    try {
      await fs.access(fullPath);
      res.sendFile(fullPath);
    } catch {
      res.status(404).json({ error: 'Cover file not found' });
    }
  } catch (error) {
    logger.error('Get cover error:', error);
    res.status(500).json({ error: 'Failed to get cover' });
  }
});

// Serve book file for reading
router.get('/:id/file/:fileId', async (req: AuthRequest, res) => {
  try {
    const { id, fileId } = req.params;

    const file = await db.oneOrNone<BookFile>(
      'SELECT * FROM book_files WHERE id = $1 AND book_id = $2',
      [fileId, id]
    );

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const fullPath = path.join(config.booksPath, file.file_path);

    try {
      await fs.access(fullPath);
      const mimeType = file.format === 'EPUB' ? 'application/epub+zip' : 'application/pdf';

      // Set proper headers for epub.js and PDF.js
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

      res.sendFile(fullPath);
    } catch {
      res.status(404).json({ error: 'Book file not found on disk' });
    }
  } catch (error) {
    logger.error('Get file error:', error);
    res.status(500).json({ error: 'Failed to get file' });
  }
});

// Delete book
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await db.result('DELETE FROM books WHERE id = $1', [id]);

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    res.json({ message: 'Book deleted successfully' });
  } catch (error) {
    logger.error('Delete book error:', error);
    res.status(500).json({ error: 'Failed to delete book' });
  }
});

export default router;
