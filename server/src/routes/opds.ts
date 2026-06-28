import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import db from '../db';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { authenticateOpds, AuthRequest } from '../middleware/auth';
import { Book, Author, Series, Tag } from '../types';
import { attachListDetails, resolveWithin, BookListItem } from './books';

const router = Router();

// Every OPDS route authenticates via HTTP Basic (bridged to the user model).
router.use(authenticateOpds);

const NAV_TYPE = 'application/atom+xml;profile=opds-catalog;kind=navigation';
const ACQ_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
const ROOT = '/api/opds';

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sendFeed(res: Response, type: string, xml: string) {
  res.setHeader('Content-Type', type);
  res.send('<?xml version="1.0" encoding="UTF-8"?>\n' + xml);
}

interface NavEntry {
  id: string;
  title: string;
  href: string;
  content?: string;
  type?: string; // link type (defaults to navigation)
}

function navFeed(id: string, title: string, self: string, entries: NavEntry[]): string {
  const now = new Date().toISOString();
  const entryXml = entries
    .map(
      (e) => `  <entry>
    <title>${escapeXml(e.title)}</title>
    <id>${escapeXml(e.id)}</id>
    <updated>${now}</updated>
    ${e.content ? `<content type="text">${escapeXml(e.content)}</content>` : ''}
    <link rel="subsection" href="${escapeXml(e.href)}" type="${escapeXml(e.type || NAV_TYPE)}"/>
  </entry>`
    )
    .join('\n');

  return `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>${escapeXml(id)}</id>
  <title>${escapeXml(title)}</title>
  <updated>${now}</updated>
  <link rel="self" href="${escapeXml(self)}" type="${NAV_TYPE}"/>
  <link rel="start" href="${ROOT}" type="${NAV_TYPE}"/>
${entryXml}
</feed>`;
}

function acquisitionFeed(id: string, title: string, self: string, books: BookListItem[]): string {
  const now = new Date().toISOString();
  const entryXml = books
    .map((b) => {
      const authors = (b.authors || [])
        .map((a) => `    <author><name>${escapeXml(a.name)}</name></author>`)
        .join('\n');
      const acqLinks = (b.files || [])
        .map((f) => {
          const mime = f.format === 'EPUB' ? 'application/epub+zip' : 'application/pdf';
          return `    <link rel="http://opds-spec.org/acquisition" href="${ROOT}/download/${b.id}/${f.id}" type="${mime}" length="${f.file_size}"/>`;
        })
        .join('\n');
      const coverLinks = b.cover_path
        ? `    <link rel="http://opds-spec.org/image" href="${ROOT}/cover/${b.id}" type="image/jpeg"/>
    <link rel="http://opds-spec.org/image/thumbnail" href="${ROOT}/cover/${b.id}?thumbnail=true" type="image/jpeg"/>`
        : '';
      const updated = b.updated_at ? new Date(b.updated_at).toISOString() : now;
      return `  <entry>
    <title>${escapeXml(b.title)}</title>
    <id>urn:northstar:book:${escapeXml(b.id)}</id>
    <updated>${updated}</updated>
${authors}
    ${b.description ? `<content type="text">${escapeXml(b.description)}</content>` : ''}
${coverLinks}
${acqLinks}
  </entry>`;
    })
    .join('\n');

  return `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>${escapeXml(id)}</id>
  <title>${escapeXml(title)}</title>
  <updated>${now}</updated>
  <link rel="self" href="${escapeXml(self)}" type="${ACQ_TYPE}"/>
  <link rel="start" href="${ROOT}" type="${NAV_TYPE}"/>
${entryXml}
</feed>`;
}

// Root navigation catalog
router.get('/', (_req: AuthRequest, res) => {
  const xml = navFeed('urn:northstar:opds:root', 'North Star Library', ROOT, [
    { id: 'urn:northstar:opds:recent', title: 'Recently Added', href: `${ROOT}/recent`, content: 'Newest books in the library', type: ACQ_TYPE },
    { id: 'urn:northstar:opds:all', title: 'All Books', href: `${ROOT}/all`, content: 'Every book, by title', type: ACQ_TYPE },
    { id: 'urn:northstar:opds:authors', title: 'By Author', href: `${ROOT}/authors`, content: 'Browse by author' },
    { id: 'urn:northstar:opds:series', title: 'By Series', href: `${ROOT}/series`, content: 'Browse by series' },
    { id: 'urn:northstar:opds:tags', title: 'By Tag', href: `${ROOT}/tags`, content: 'Browse by tag/collection' },
  ]);
  sendFeed(res, NAV_TYPE, xml);
});

// Recently added (acquisition)
router.get('/recent', async (_req: AuthRequest, res) => {
  try {
    const books = await db.manyOrNone<Book>('SELECT * FROM books ORDER BY created_at DESC LIMIT 50');
    const detailed = await attachListDetails(books || []);
    sendFeed(res, ACQ_TYPE, acquisitionFeed('urn:northstar:opds:recent', 'Recently Added', `${ROOT}/recent`, detailed));
  } catch (error) {
    logger.error('OPDS recent error:', error);
    res.status(500).json({ error: 'Failed to build feed' });
  }
});

// All books (acquisition)
router.get('/all', async (_req: AuthRequest, res) => {
  try {
    const books = await db.manyOrNone<Book>('SELECT * FROM books ORDER BY sort_title ASC LIMIT 500');
    const detailed = await attachListDetails(books || []);
    sendFeed(res, ACQ_TYPE, acquisitionFeed('urn:northstar:opds:all', 'All Books', `${ROOT}/all`, detailed));
  } catch (error) {
    logger.error('OPDS all error:', error);
    res.status(500).json({ error: 'Failed to build feed' });
  }
});

// Authors navigation
router.get('/authors', async (_req: AuthRequest, res) => {
  try {
    const authors = await db.manyOrNone<Author & { book_count: number }>(
      `SELECT a.*, COUNT(DISTINCT ba.book_id) AS book_count
       FROM authors a LEFT JOIN book_authors ba ON a.id = ba.author_id
       GROUP BY a.id HAVING COUNT(DISTINCT ba.book_id) > 0
       ORDER BY a.sort_name ASC`
    );
    const xml = navFeed(
      'urn:northstar:opds:authors',
      'By Author',
      `${ROOT}/authors`,
      (authors || []).map((a) => ({
        id: `urn:northstar:author:${a.id}`,
        title: a.name,
        href: `${ROOT}/authors/${a.id}`,
        content: `${a.book_count} book${Number(a.book_count) === 1 ? '' : 's'}`,
        type: ACQ_TYPE,
      }))
    );
    sendFeed(res, NAV_TYPE, xml);
  } catch (error) {
    logger.error('OPDS authors error:', error);
    res.status(500).json({ error: 'Failed to build feed' });
  }
});

router.get('/authors/:id', async (req: AuthRequest, res) => {
  try {
    const books = await db.manyOrNone<Book>(
      `SELECT b.* FROM books b
       INNER JOIN book_authors ba ON b.id = ba.book_id
       WHERE ba.author_id = $1 ORDER BY b.series_index ASC, b.sort_title ASC`,
      [req.params.id]
    );
    const detailed = await attachListDetails(books || []);
    sendFeed(res, ACQ_TYPE, acquisitionFeed(`urn:northstar:author:${req.params.id}`, 'Author', `${ROOT}/authors/${req.params.id}`, detailed));
  } catch (error) {
    logger.error('OPDS author error:', error);
    res.status(500).json({ error: 'Failed to build feed' });
  }
});

// Series navigation
router.get('/series', async (_req: AuthRequest, res) => {
  try {
    const series = await db.manyOrNone<Series & { book_count: number }>(
      `SELECT s.*, COUNT(DISTINCT b.id) AS book_count
       FROM series s LEFT JOIN books b ON s.id = b.series_id
       GROUP BY s.id HAVING COUNT(DISTINCT b.id) > 0
       ORDER BY s.name ASC`
    );
    const xml = navFeed(
      'urn:northstar:opds:series',
      'By Series',
      `${ROOT}/series`,
      (series || []).map((s) => ({
        id: `urn:northstar:series:${s.id}`,
        title: s.name,
        href: `${ROOT}/series/${s.id}`,
        content: `${s.book_count} book${Number(s.book_count) === 1 ? '' : 's'}`,
        type: ACQ_TYPE,
      }))
    );
    sendFeed(res, NAV_TYPE, xml);
  } catch (error) {
    logger.error('OPDS series error:', error);
    res.status(500).json({ error: 'Failed to build feed' });
  }
});

router.get('/series/:id', async (req: AuthRequest, res) => {
  try {
    const books = await db.manyOrNone<Book>(
      'SELECT * FROM books WHERE series_id = $1 ORDER BY series_index ASC, sort_title ASC',
      [req.params.id]
    );
    const detailed = await attachListDetails(books || []);
    sendFeed(res, ACQ_TYPE, acquisitionFeed(`urn:northstar:series:${req.params.id}`, 'Series', `${ROOT}/series/${req.params.id}`, detailed));
  } catch (error) {
    logger.error('OPDS series detail error:', error);
    res.status(500).json({ error: 'Failed to build feed' });
  }
});

// Tags navigation
router.get('/tags', async (_req: AuthRequest, res) => {
  try {
    const tags = await db.manyOrNone<Tag & { book_count: number }>(
      `SELECT t.*, COUNT(DISTINCT bt.book_id) AS book_count
       FROM tags t LEFT JOIN book_tags bt ON t.id = bt.tag_id
       GROUP BY t.id HAVING COUNT(DISTINCT bt.book_id) > 0
       ORDER BY t.name ASC`
    );
    const xml = navFeed(
      'urn:northstar:opds:tags',
      'By Tag',
      `${ROOT}/tags`,
      (tags || []).map((t) => ({
        id: `urn:northstar:tag:${t.id}`,
        title: t.name,
        href: `${ROOT}/tags/${t.id}`,
        content: `${t.book_count} book${Number(t.book_count) === 1 ? '' : 's'}`,
        type: ACQ_TYPE,
      }))
    );
    sendFeed(res, NAV_TYPE, xml);
  } catch (error) {
    logger.error('OPDS tags error:', error);
    res.status(500).json({ error: 'Failed to build feed' });
  }
});

router.get('/tags/:id', async (req: AuthRequest, res) => {
  try {
    const books = await db.manyOrNone<Book>(
      `SELECT b.* FROM books b
       INNER JOIN book_tags bt ON b.id = bt.book_id
       WHERE bt.tag_id = $1 ORDER BY b.sort_title ASC`,
      [req.params.id]
    );
    const detailed = await attachListDetails(books || []);
    sendFeed(res, ACQ_TYPE, acquisitionFeed(`urn:northstar:tag:${req.params.id}`, 'Tag', `${ROOT}/tags/${req.params.id}`, detailed));
  } catch (error) {
    logger.error('OPDS tag detail error:', error);
    res.status(500).json({ error: 'Failed to build feed' });
  }
});

// Cover image (Basic-auth) — OPDS clients can't send the Bearer token the
// regular /api/books/:id/cover route requires, so mirror it here.
router.get('/cover/:id', async (req: AuthRequest, res) => {
  try {
    const book = await db.oneOrNone<{ cover_path: string | null; thumbnail_path: string | null }>(
      'SELECT cover_path, thumbnail_path FROM books WHERE id = $1',
      [req.params.id]
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
    const fullPath = resolveWithin(thumbnail ? config.thumbnailsPath : config.coversPath, imagePath);
    if (!fullPath) {
      res.status(400).json({ error: 'Invalid cover path' });
      return;
    }
    await fs.access(fullPath);
    res.sendFile(fullPath);
  } catch {
    res.status(404).json({ error: 'Cover file not found' });
  }
});

// Acquisition / download (Basic-auth). Express's sendFile honors Range requests
// and sets Content-Length, which OPDS readers rely on for resumable downloads.
router.get('/download/:bookId/:fileId', async (req: AuthRequest, res) => {
  try {
    const { bookId, fileId } = req.params;
    const file = await db.oneOrNone<{ file_path: string; format: 'EPUB' | 'PDF' }>(
      'SELECT file_path, format FROM book_files WHERE id = $1 AND book_id = $2',
      [fileId, bookId]
    );
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const fullPath = resolveWithin(config.booksPath, file.file_path);
    if (!fullPath) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }
    await fs.access(fullPath);
    const mimeType = file.format === 'EPUB' ? 'application/epub+zip' : 'application/pdf';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file.file_path)}"`);
    res.sendFile(fullPath);
  } catch (error) {
    logger.error('OPDS download error:', error);
    res.status(404).json({ error: 'Book file not found on disk' });
  }
});

export default router;
