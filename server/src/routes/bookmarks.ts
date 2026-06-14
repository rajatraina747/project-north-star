import { Router } from 'express';
import db from '../db';
import { logger } from '../utils/logger';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { Bookmark, CreateBookmarkRequest } from '../types';

const router = Router();

router.use(authenticateToken);

// List bookmarks for a book file
router.get('/:bookId/:fileId', async (req: AuthRequest, res) => {
  try {
    const { bookId, fileId } = req.params;

    const bms = await db.manyOrNone<Bookmark>(
      `SELECT * FROM bookmarks
       WHERE user_id = $1 AND book_id = $2 AND book_file_id = $3
       ORDER BY created_at DESC`,
      [req.user!.id, bookId, fileId]
    );

    res.json(bms || []);
  } catch (error) {
    logger.error('List bookmarks error:', error);
    res.status(500).json({ error: 'Failed to list bookmarks' });
  }
});

// Create a bookmark
router.post('/:bookId/:fileId', async (req: AuthRequest, res) => {
  try {
    const { bookId, fileId } = req.params;
    const { epub_cfi, pdf_page, label } = req.body as CreateBookmarkRequest;

    if (!epub_cfi && !pdf_page) {
      res.status(400).json({ error: 'Either epub_cfi or pdf_page is required' });
      return;
    }

    if (label !== undefined && typeof label === 'string' && label.length > 500) {
      res.status(400).json({ error: 'label must be at most 500 characters' });
      return;
    }

    // Verify book file exists
    const file = await db.oneOrNone(
      'SELECT id FROM book_files WHERE id = $1 AND book_id = $2',
      [fileId, bookId]
    );
    if (!file) {
      res.status(404).json({ error: 'Book file not found' });
      return;
    }

    const bm = await db.one<Bookmark>(
      `INSERT INTO bookmarks (user_id, book_id, book_file_id, epub_cfi, pdf_page, label)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user!.id, bookId, fileId, epub_cfi || null, pdf_page || null, label || null]
    );

    res.status(201).json(bm);
  } catch (error) {
    logger.error('Create bookmark error:', error);
    res.status(500).json({ error: 'Failed to create bookmark' });
  }
});

// Delete a bookmark
router.delete('/:bookId/:fileId/:bookmarkId', async (req: AuthRequest, res) => {
  try {
    const { bookId, fileId, bookmarkId } = req.params;

    const result = await db.result(
      `DELETE FROM bookmarks
       WHERE id = $1 AND user_id = $2 AND book_id = $3 AND book_file_id = $4`,
      [bookmarkId, req.user!.id, bookId, fileId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Bookmark not found' });
      return;
    }

    res.json({ message: 'Bookmark deleted' });
  } catch (error) {
    logger.error('Delete bookmark error:', error);
    res.status(500).json({ error: 'Failed to delete bookmark' });
  }
});

export default router;
