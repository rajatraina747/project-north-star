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
