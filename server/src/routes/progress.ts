import { Router } from 'express';
import db from '../db';
import { logger } from '../utils/logger';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { ReadingProgress, UpdateProgressRequest } from '../types';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Get reading progress for a book
router.get('/:bookId/:fileId', async (req: AuthRequest, res) => {
  try {
    const { bookId, fileId } = req.params;

    const progress = await db.oneOrNone<ReadingProgress>(
      `SELECT * FROM reading_progress
       WHERE user_id = $1 AND book_id = $2 AND book_file_id = $3`,
      [req.user!.id, bookId, fileId]
    );

    if (!progress) {
      res.json({
        progress_percent: 0,
        epub_cfi: null,
        pdf_page: null,
        pdf_scroll_position: null,
      });
      return;
    }

    res.json({
      ...progress,
      progress_percent: parseFloat(progress.progress_percent as any) || 0,
    });
  } catch (error) {
    logger.error('Get progress error:', error);
    res.status(500).json({ error: 'Failed to get progress' });
  }
});

// Update reading progress
router.put('/:bookId/:fileId', async (req: AuthRequest, res) => {
  try {
    const { bookId, fileId } = req.params;
    const data = req.body as UpdateProgressRequest;

    if (data.device_info !== undefined && data.device_info !== null) {
      if (typeof data.device_info !== 'string' || data.device_info.length > 500) {
        res.status(400).json({ error: 'device_info must be a string of at most 500 characters' });
        return;
      }
    }

    const progress = await db.one<ReadingProgress>(
      `INSERT INTO reading_progress
       (user_id, book_id, book_file_id, progress_percent, epub_cfi, pdf_page, pdf_scroll_position, device_info, last_read_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, book_file_id)
       DO UPDATE SET
         progress_percent = $4,
         epub_cfi = $5,
         pdf_page = $6,
         pdf_scroll_position = $7,
         device_info = $8,
         last_read_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        req.user!.id,
        bookId,
        fileId,
        data.progress_percent,
        data.epub_cfi || null,
        data.pdf_page || null,
        data.pdf_scroll_position || null,
        data.device_info || null,
      ]
    );

    res.json({
      ...progress,
      progress_percent: parseFloat(progress.progress_percent as any) || 0,
    });
  } catch (error) {
    logger.error('Update progress error:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// Get all reading progress for user
router.get('/', async (req: AuthRequest, res) => {
  try {
    const progress = await db.manyOrNone<ReadingProgress>(
      `SELECT rp.*, b.title, b.cover_path, b.thumbnail_path
       FROM reading_progress rp
       INNER JOIN books b ON rp.book_id = b.id
       WHERE rp.user_id = $1
       ORDER BY rp.last_read_at DESC`,
      [req.user!.id]
    );

    const formattedProgress = (progress || []).map(p => ({
      ...p,
      progress_percent: parseFloat(p.progress_percent as any) || 0,
    }));

    res.json(formattedProgress);
  } catch (error) {
    logger.error('Get all progress error:', error);
    res.status(500).json({ error: 'Failed to get progress' });
  }
});

export default router;
