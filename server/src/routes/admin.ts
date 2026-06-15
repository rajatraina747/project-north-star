import { Router } from 'express';
import db from '../db';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth';
import { Setting, ScanHistory } from '../types';
import { refreshSeriesCatalog } from '../services/series';

const router = Router();

// All routes require authentication and admin access
router.use(authenticateToken);
router.use(requireAdmin);

// Get all settings
router.get('/settings', async (req: AuthRequest, res) => {
  try {
    const settings = await db.manyOrNone<Setting>('SELECT * FROM settings ORDER BY key');
    res.json(settings || []);
  } catch (error) {
    logger.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Update setting
router.put('/settings/:key', async (req: AuthRequest, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const setting = await db.one<Setting>(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key)
       DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [key, JSON.stringify(value)]
    );

    res.json(setting);
  } catch (error) {
    logger.error('Update setting error:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// Trigger library scan
router.post('/scan', async (req: AuthRequest, res) => {
  try {
    const { force = false } = req.body;

    // Check if scan is already running
    const runningScans = await db.oneOrNone<ScanHistory>(
      `SELECT * FROM scan_history
       WHERE status = 'RUNNING'
       ORDER BY started_at DESC
       LIMIT 1`
    );

    if (runningScans && !force) {
      res.status(409).json({
        error: 'Scan already running',
        scan_id: runningScans.id,
      });
      return;
    }

    // Create new scan record
    const scan = await db.one<ScanHistory>(
      `INSERT INTO scan_history (status, started_at)
       VALUES ('RUNNING', CURRENT_TIMESTAMP)
       RETURNING *`
    );

    // Note: Actual scanning will be done by the worker service
    // Here we just trigger it by creating a scan record

    logger.info(`Library scan initiated: ${scan.id}`);

    res.json({
      message: 'Scan initiated',
      scan_id: scan.id,
    });
  } catch (error) {
    logger.error('Scan initiation error:', error);
    res.status(500).json({ error: 'Failed to initiate scan' });
  }
});

// Get scan history
router.get('/scans', async (req: AuthRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;

    const scans = await db.manyOrNone<ScanHistory>(
      `SELECT * FROM scan_history
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit]
    );

    res.json(scans || []);
  } catch (error) {
    logger.error('Get scans error:', error);
    res.status(500).json({ error: 'Failed to get scans' });
  }
});

// Get single scan status
router.get('/scans/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const scan = await db.oneOrNone<ScanHistory>(
      'SELECT * FROM scan_history WHERE id = $1',
      [id]
    );

    if (!scan) {
      res.status(404).json({ error: 'Scan not found' });
      return;
    }

    res.json(scan);
  } catch (error) {
    logger.error('Get scan error:', error);
    res.status(500).json({ error: 'Failed to get scan' });
  }
});

// Stream live scan progress over Server-Sent Events. The worker writes progress
// to scan_history (separate process), so the API polls that row on a short
// interval and pushes each snapshot to the client until the scan leaves the
// RUNNING state. The client keeps a polling fallback for dropped streams.
router.get('/scans/:id/stream', async (req: AuthRequest, res) => {
  const { id } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Disable proxy buffering (nginx) so events are delivered immediately.
  res.setHeader('X-Accel-Buffering', 'no');
  (res as any).flushHeaders?.();

  let closed = false;
  const send = (event: string, data: unknown) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    clearTimeout(maxLifeTimer);
    res.end();
  };

  const tick = async () => {
    if (closed) return;
    try {
      const scan = await db.oneOrNone<ScanHistory>('SELECT * FROM scan_history WHERE id = $1', [id]);
      if (!scan) {
        send('error', { error: 'Scan not found' });
        cleanup();
        return;
      }
      send('progress', scan);
      if (scan.status !== 'RUNNING') {
        send('done', scan);
        cleanup();
      }
    } catch (error) {
      logger.warn('Scan stream tick failed:', error);
    }
  };

  const pollTimer = setInterval(tick, 1000);
  // Comment heartbeat keeps intermediaries from closing an idle connection.
  const heartbeatTimer = setInterval(() => { if (!closed) res.write(': hb\n\n'); }, 15000);
  // Safety cap so a wedged scan can't hold the connection forever.
  const maxLifeTimer = setTimeout(cleanup, 30 * 60 * 1000);

  req.on('close', cleanup);
  await tick();
});

// Duplicate-detection report (read-only). Surfaces three kinds of likely
// duplicates:
//   1. exactHash    — files with an identical content hash. book_files.file_hash
//                     is UNIQUE so this is normally empty, but it's kept for
//                     robustness against legacy data and as a documented check.
//   2. byTitleAuthor — distinct book records sharing a normalized title + primary
//                     author (e.g. the same work imported twice / as separate rows).
//   3. byIsbn        — distinct book records sharing an ISBN-10 or ISBN-13.
// No destructive actions are exposed — this is report-only by design.
router.get('/duplicates', async (_req: AuthRequest, res) => {
  try {
    // Exact-hash duplicates at the file level.
    const exactHash = await db.manyOrNone<{ file_hash: string; files: any[] }>(
      `SELECT bf.file_hash,
              json_agg(json_build_object(
                'book_id', bf.book_id, 'title', b.title,
                'file_path', bf.file_path, 'format', bf.format, 'file_size', bf.file_size
              )) AS files
       FROM book_files bf
       JOIN books b ON b.id = bf.book_id
       GROUP BY bf.file_hash
       HAVING COUNT(*) > 1`
    );

    // One summary row per book, used to group near-duplicates in JS.
    const books = await db.manyOrNone<{
      id: string;
      title: string;
      isbn_10: string | null;
      isbn_13: string | null;
      primary_author: string | null;
      total_size: string | null;
      formats: string[] | null;
      paths: string[] | null;
    }>(
      `SELECT b.id, b.title, b.isbn_10, b.isbn_13,
              (SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
                 WHERE ba.book_id = b.id ORDER BY ba.author_index LIMIT 1) AS primary_author,
              (SELECT SUM(file_size) FROM book_files WHERE book_id = b.id) AS total_size,
              (SELECT array_agg(DISTINCT format) FROM book_files WHERE book_id = b.id) AS formats,
              (SELECT array_agg(file_path) FROM book_files WHERE book_id = b.id) AS paths
       FROM books b`
    );

    const summary = (b: typeof books[number]) => ({
      id: b.id,
      title: b.title,
      primary_author: b.primary_author,
      formats: b.formats || [],
      paths: b.paths || [],
      total_size: parseInt(b.total_size || '0', 10),
    });

    const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

    // Group by normalized title + primary author.
    const titleAuthorMap = new Map<string, typeof books>();
    for (const b of books) {
      const key = `${norm(b.title)}|${norm(b.primary_author)}`;
      if (!norm(b.title)) continue;
      const arr = titleAuthorMap.get(key) || [];
      arr.push(b);
      titleAuthorMap.set(key, arr);
    }
    const byTitleAuthor = [...titleAuthorMap.values()]
      .filter((arr) => arr.length > 1)
      .map((arr) => ({
        title: arr[0].title,
        author: arr[0].primary_author,
        books: arr.map(summary),
      }));

    // Group by ISBN (10 or 13).
    const isbnMap = new Map<string, typeof books>();
    for (const b of books) {
      for (const isbn of [b.isbn_13, b.isbn_10]) {
        const v = (isbn || '').replace(/[-\s]/g, '');
        if (!v) continue;
        const arr = isbnMap.get(v) || [];
        // Avoid adding the same book twice for the same ISBN value.
        if (!arr.some((x) => x.id === b.id)) arr.push(b);
        isbnMap.set(v, arr);
      }
    }
    const byIsbn = [...isbnMap.entries()]
      .filter(([, arr]) => arr.length > 1)
      .map(([isbn, arr]) => ({ isbn, books: arr.map(summary) }));

    res.json({
      exactHash: exactHash || [],
      byTitleAuthor,
      byIsbn,
      counts: {
        exactHash: (exactHash || []).length,
        titleAuthor: byTitleAuthor.length,
        isbn: byIsbn.length,
      },
    });
  } catch (error) {
    logger.error('Duplicate report error:', error);
    res.status(500).json({ error: 'Failed to build duplicate report' });
  }
});

// System health check
router.get('/health', async (req: AuthRequest, res) => {
  try {
    // Check database
    await db.one('SELECT 1');

    // Get system info
    const bookCount = await db.one<{ count: number }>('SELECT COUNT(*) as count FROM books');

    res.json({
      status: 'healthy',
      database: 'connected',
      books: parseInt(bookCount.count.toString()),
      config: {
        booksPath: config.booksPath,
        nodeEnv: config.nodeEnv,
      },
    });
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: 'System check failed',
    });
  }
});

// Refresh series catalog for a book (dev/admin)
router.post('/series/refresh', async (req: AuthRequest, res) => {
  try {
    const bookId = (req.query.book_id as string) || req.body?.book_id;
    const source = (req.query.source as string) || req.body?.source || 'external';
    if (!bookId) {
      res.status(400).json({ error: 'book_id is required' });
      return;
    }

    const result = await refreshSeriesCatalog(bookId, source === 'internal' ? 'internal' : 'external');
    res.json({ message: `Series refreshed from ${source}`, ...result });
  } catch (error) {
    logger.error('Series refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh series' });
  }
});

export default router;
