import { Router } from 'express';
import db from '../db';
import { logger } from '../utils/logger';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { Book, ShelfStatus } from '../types';
import { attachListDetails } from './books';

const router = Router();

router.use(authenticateToken);

const VALID_STATUSES: ShelfStatus[] = ['WANT_TO_READ', 'READING', 'FINISHED'];

/**
 * Keep the Wave 2 reading_progress.finished flag in sync with the shelf so there
 * is a single coherent "finished" state across the app (stats, the Finished
 * badge, continue-reading). Finishing stamps the book's primary file as
 * finished; moving the book off FINISHED clears that flag (progress % is left
 * untouched). "Primary file" matches how BookDetail picks files[0].
 */
async function syncFinishedForBook(userId: string, bookId: string, finished: boolean): Promise<void> {
  const file = await db.oneOrNone<{ id: string }>(
    'SELECT id FROM book_files WHERE book_id = $1 ORDER BY created_at ASC LIMIT 1',
    [bookId]
  );
  if (!file) return;

  if (finished) {
    await db.none(
      `INSERT INTO reading_progress
         (user_id, book_id, book_file_id, progress_percent, finished, finished_at, last_read_at)
       VALUES ($1, $2, $3, 100, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, book_file_id)
       DO UPDATE SET finished = true, finished_at = CURRENT_TIMESTAMP,
                     progress_percent = 100, updated_at = CURRENT_TIMESTAMP`,
      [userId, bookId, file.id]
    );
  } else {
    await db.none(
      `UPDATE reading_progress
       SET finished = false, finished_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND book_id = $2 AND finished = true`,
      [userId, bookId]
    );
  }
}

// List the current user's shelved books, optionally filtered by status. Books
// are returned with authors + files attached so list views can render directly.
router.get('/', async (req: AuthRequest, res) => {
  try {
    const status = req.query.status as string | undefined;
    if (status && !VALID_STATUSES.includes(status as ShelfStatus)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    const rows = await db.manyOrNone<Book & { shelf_status: ShelfStatus; shelved_at: Date }>(
      `SELECT b.*, ubs.status AS shelf_status, ubs.updated_at AS shelved_at
       FROM user_book_status ubs
       INNER JOIN books b ON b.id = ubs.book_id
       WHERE ubs.user_id = $1 ${status ? 'AND ubs.status = $2' : ''}
       ORDER BY ubs.updated_at DESC`,
      status ? [req.user!.id, status] : [req.user!.id]
    );

    const withDetails = await attachListDetails(rows);
    // attachListDetails spreads the row, so shelf_status/shelved_at are preserved.
    res.json(withDetails);
  } catch (error) {
    logger.error('List shelf error:', error);
    res.status(500).json({ error: 'Failed to list shelf' });
  }
});

// Get the shelf status for a single book (null if not shelved).
router.get('/:bookId', async (req: AuthRequest, res) => {
  try {
    const { bookId } = req.params;
    const row = await db.oneOrNone<{ status: ShelfStatus }>(
      'SELECT status FROM user_book_status WHERE user_id = $1 AND book_id = $2',
      [req.user!.id, bookId]
    );
    res.json({ status: row?.status ?? null });
  } catch (error) {
    logger.error('Get shelf status error:', error);
    res.status(500).json({ error: 'Failed to get shelf status' });
  }
});

// Set the shelf status for a book.
router.put('/:bookId', async (req: AuthRequest, res) => {
  try {
    const { bookId } = req.params;
    const { status } = req.body || {};

    if (!VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` });
      return;
    }

    const book = await db.oneOrNone('SELECT id FROM books WHERE id = $1', [bookId]);
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    const row = await db.one(
      `INSERT INTO user_book_status (user_id, book_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, book_id)
       DO UPDATE SET status = $3, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [req.user!.id, bookId, status]
    );

    // Keep the finished flag coherent with the shelf.
    await syncFinishedForBook(req.user!.id, bookId, status === 'FINISHED');

    res.json(row);
  } catch (error) {
    logger.error('Set shelf status error:', error);
    res.status(500).json({ error: 'Failed to set shelf status' });
  }
});

// Remove a book from the shelf (does not touch reading progress).
router.delete('/:bookId', async (req: AuthRequest, res) => {
  try {
    const { bookId } = req.params;
    await db.none(
      'DELETE FROM user_book_status WHERE user_id = $1 AND book_id = $2',
      [req.user!.id, bookId]
    );
    res.json({ message: 'Removed from shelf' });
  } catch (error) {
    logger.error('Delete shelf status error:', error);
    res.status(500).json({ error: 'Failed to remove from shelf' });
  }
});

export default router;
