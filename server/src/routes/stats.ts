import { Router } from 'express';
import db from '../db';
import { logger } from '../utils/logger';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { computeStreaks } from '../utils/streaks';

const router = Router();

router.use(authenticateToken);

/**
 * Reading heartbeat. The readers call this on a throttled cadence (~30s of
 * active reading, and on tab hide/unload) with the active seconds and pages
 * advanced since the last beat. We accumulate into one row per (user, file,
 * calendar day) so writes stay cheap and per-day aggregation is trivial.
 */
router.post('/heartbeat', async (req: AuthRequest, res) => {
  try {
    const { book_id, file_id, seconds, pages } = req.body as {
      book_id?: string;
      file_id?: string;
      seconds?: number;
      pages?: number;
    };

    if (!book_id || !file_id) {
      res.status(400).json({ error: 'book_id and file_id are required' });
      return;
    }

    // Clamp to sane bounds so a buggy/hostile client can't inflate stats.
    const secs = Math.max(0, Math.min(3600, Math.round(Number(seconds) || 0)));
    const pgs = Math.max(0, Math.min(10000, Math.round(Number(pages) || 0)));

    if (secs === 0 && pgs === 0) {
      res.json({ ok: true });
      return;
    }

    // Verify the file belongs to the book (and exists) before recording.
    const file = await db.oneOrNone(
      'SELECT id FROM book_files WHERE id = $1 AND book_id = $2',
      [file_id, book_id]
    );
    if (!file) {
      res.status(404).json({ error: 'Book file not found' });
      return;
    }

    await db.none(
      `INSERT INTO reading_sessions (user_id, book_id, book_file_id, day, seconds, pages_read)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, $5)
       ON CONFLICT (user_id, book_file_id, day)
       DO UPDATE SET
         seconds = reading_sessions.seconds + $4,
         pages_read = reading_sessions.pages_read + $5,
         updated_at = CURRENT_TIMESTAMP`,
      [req.user!.id, book_id, file_id, secs, pgs]
    );

    res.json({ ok: true });
  } catch (error) {
    logger.error('Heartbeat error:', error);
    res.status(500).json({ error: 'Failed to record session' });
  }
});

/**
 * Aggregate reading stats for the current user: total time, books finished,
 * current streak, per-day series (last 30 days) and top books by time.
 */
router.get('/summary', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const totals = await db.one<{ total_seconds: string | null; total_pages: string | null }>(
      `SELECT COALESCE(SUM(seconds), 0) AS total_seconds,
              COALESCE(SUM(pages_read), 0) AS total_pages
       FROM reading_sessions WHERE user_id = $1`,
      [userId]
    );

    const finished = await db.one<{ count: string }>(
      `SELECT COUNT(*) AS count FROM reading_progress
       WHERE user_id = $1 AND finished = true`,
      [userId]
    );

    // Distinct active days, most recent first — used for streak calculation.
    // Cast to text so Postgres returns ISO 'YYYY-MM-DD' strings directly; reading
    // the raw DATE back through node-pg yields a JS Date at local midnight, whose
    // string form ("Thu Jun 18 2026 …") would break the ISO key matching in
    // computeStreaks (and shift days across the UTC boundary).
    const days = await db.manyOrNone<{ day: string }>(
      `SELECT DISTINCT day::text AS day FROM reading_sessions
       WHERE user_id = $1 ORDER BY day DESC`,
      [userId]
    );

    // Current + longest streaks from the set of active days.
    const { current: streak, longest: longestStreak } = computeStreaks(
      days.map((d) => d.day)
    );

    const perDay = await db.manyOrNone<{ day: string; seconds: string; pages_read: string }>(
      `SELECT day::text AS day, SUM(seconds) AS seconds, SUM(pages_read) AS pages_read
       FROM reading_sessions
       WHERE user_id = $1 AND day >= CURRENT_DATE - INTERVAL '29 days'
       GROUP BY day ORDER BY day ASC`,
      [userId]
    );

    const perBook = await db.manyOrNone<{
      book_id: string;
      title: string;
      thumbnail_path: string | null;
      seconds: string;
      pages_read: string;
    }>(
      `SELECT rs.book_id, b.title, b.thumbnail_path,
              SUM(rs.seconds) AS seconds, SUM(rs.pages_read) AS pages_read
       FROM reading_sessions rs
       INNER JOIN books b ON b.id = rs.book_id
       WHERE rs.user_id = $1
       GROUP BY rs.book_id, b.title, b.thumbnail_path
       ORDER BY SUM(rs.seconds) DESC
       LIMIT 10`,
      [userId]
    );

    const activeDays = days.length;
    const totalSeconds = parseInt(totals.total_seconds || '0', 10);
    const totalPages = parseInt(totals.total_pages || '0', 10);
    // Reading pace: pages per hour of active reading time.
    const pagesPerHour = totalSeconds > 0 ? Math.round((totalPages / totalSeconds) * 3600) : 0;

    res.json({
      total_seconds: totalSeconds,
      total_pages: totalPages,
      books_finished: parseInt(finished.count, 10),
      current_streak: streak,
      longest_streak: longestStreak,
      active_days: activeDays,
      avg_pages_per_day: activeDays > 0 ? Math.round(totalPages / activeDays) : 0,
      pages_per_hour: pagesPerHour,
      per_day: perDay.map((d) => ({
        day: d.day,
        seconds: parseInt(d.seconds, 10),
        pages_read: parseInt(d.pages_read, 10),
      })),
      per_book: perBook.map((b) => ({
        book_id: b.book_id,
        title: b.title,
        thumbnail_path: b.thumbnail_path,
        seconds: parseInt(b.seconds, 10),
        pages_read: parseInt(b.pages_read, 10),
      })),
    });
  } catch (error) {
    logger.error('Stats summary error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

export default router;
