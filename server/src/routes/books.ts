import express, { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import db from '../db';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth';
import { signFileTicket, verifyFileTicket } from '../utils/file-ticket';
import { Book, BookWithDetails, Author, Series, Tag, BookFile, UpdateBookRequest } from '../types';
import { buildSeriesContext } from '../services/series';
import { MetadataEnricher } from '../services/metadata-enricher';
import { CoverGenerator } from '../services/cover-generator';

const router = Router();

/**
 * Safely resolve a DB-provided relative path inside a trusted base directory.
 * Returns null if the resolved path would escape the base (path traversal).
 */
export function resolveWithin(baseDir: string, relativePath: string): string | null {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, relativePath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    return null;
  }
  return resolved;
}

/**
 * Attach authors and files to a list of books using two batched queries (no
 * N+1). Lets list views show the author and a format badge.
 */
type AuthorBrief = { id: string; name: string; sort_name: string | null };
type FileBrief = { book_id: string; id: string; format: string; file_path: string; file_size: string };
export type BookListItem = Book & { authors: AuthorBrief[]; files: FileBrief[] };

export async function attachListDetails(books: Book[]): Promise<BookListItem[]> {
  if (!books || books.length === 0) return [];
  const ids = books.map((b) => b.id);

  const authors = await db.manyOrNone<{ book_id: string; id: string; name: string; sort_name: string | null }>(
    `SELECT ba.book_id, a.id, a.name, a.sort_name
     FROM book_authors ba
     INNER JOIN authors a ON a.id = ba.author_id
     WHERE ba.book_id IN ($1:csv)
     ORDER BY ba.author_index ASC`,
    [ids]
  );
  const files = await db.manyOrNone<{ book_id: string; id: string; format: string; file_path: string; file_size: string }>(
    `SELECT id, book_id, format, file_path, file_size
     FROM book_files
     WHERE book_id IN ($1:csv)`,
    [ids]
  );

  const authorsByBook = new Map<string, AuthorBrief[]>();
  for (const a of authors) {
    const list = authorsByBook.get(a.book_id) ?? [];
    list.push({ id: a.id, name: a.name, sort_name: a.sort_name });
    authorsByBook.set(a.book_id, list);
  }
  const filesByBook = new Map<string, FileBrief[]>();
  for (const f of files) {
    const list = filesByBook.get(f.book_id) ?? [];
    list.push(f);
    filesByBook.set(f.book_id, list);
  }

  return books.map((b) => ({
    ...b,
    authors: authorsByBook.get(b.id) ?? [],
    files: filesByBook.get(b.id) ?? [],
  }));
}

// Upload limit (MB). Kept generous for large PDFs; configurable via env.
const UPLOAD_MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '200', 10);
const ALLOWED_UPLOAD_EXTS = ['.epub', '.pdf', '.cbz', '.mobi', '.azw3'];

// MIME types per format for the file-serving route. CBZ is a ZIP of images;
// MOBI/AZW3 are download-only (no in-app reader).
const FORMAT_MIME_TYPES: Record<string, string> = {
  EPUB: 'application/epub+zip',
  PDF: 'application/pdf',
  CBZ: 'application/vnd.comicbook+zip',
  MOBI: 'application/x-mobipocket-ebook',
  AZW3: 'application/vnd.amazon.ebook',
};

const uploadHandler = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_UPLOAD_EXTS.includes(ext)) {
      cb(new Error('Unsupported file type. Allowed: EPUB, PDF, CBZ, MOBI, AZW3'));
      return;
    }
    cb(null, true);
  },
});

/**
 * Turn an arbitrary upload filename into a safe basename: strip any directory
 * components, allow only a conservative character set, and bound the length.
 * Combined with resolveWithin this prevents path traversal.
 */
function sanitizeBaseName(name: string): string {
  const base = path.basename(name);
  const cleaned = base
    .replace(/[^a-zA-Z0-9-_. ]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[._]+/, '')
    .trim();
  return cleaned.slice(0, 180) || 'upload';
}

/**
 * Auth for the file-serving route. Accepts EITHER a normal Bearer token (used by
 * the download flow, which can set headers) OR a short-lived `?token=` ticket
 * scoped to this exact book+file (used by streaming readers, whose internal
 * range requests can't set headers). Registered before the global auth so the
 * ticket path isn't rejected by the header-only middleware.
 */
async function authenticateFileAccess(req: AuthRequest, res: express.Response, next: express.NextFunction): Promise<void> {
  const { id, fileId } = req.params;
  const ticket = typeof req.query.token === 'string' ? req.query.token : null;
  if (ticket && verifyFileTicket(ticket, id, fileId)) {
    next();
    return;
  }
  await authenticateToken(req, res, next);
}

// Serve a book file for reading/downloading, with HTTP range support so readers
// can stream large files instead of buffering them whole. Defined before the
// global auth middleware so it can accept signed file tickets (see above).
router.get('/:id/file/:fileId', authenticateFileAccess, async (req: AuthRequest, res) => {
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

    const fullPath = resolveWithin(config.booksPath, file.file_path);
    if (!fullPath) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }

    try {
      await fs.access(fullPath);
      const mimeType = FORMAT_MIME_TYPES[file.format] || 'application/octet-stream';

      // Headers for epub.js / PDF.js byte-range support.
      // CORS is handled by the global cors() middleware — no manual header here.
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      // Auth-gated content, but book files don't change in place — let the
      // browser/reader cache and revalidate via the ETag sendFile still sets.
      res.setHeader('Cache-Control', 'private, max-age=86400');

      res.sendFile(fullPath, { cacheControl: false });
    } catch {
      res.status(404).json({ error: 'Book file not found on disk' });
    }
  } catch (error) {
    logger.error('Get file error:', error);
    res.status(500).json({ error: 'Failed to get file' });
  }
});

// All remaining routes require authentication
router.use(authenticateToken);

// Issue a short-lived streaming ticket for a file. The reader embeds it in the
// file URL so pdf.js/epub.js can fetch byte ranges without an auth header.
router.get('/:id/file/:fileId/ticket', async (req: AuthRequest, res) => {
  try {
    const { id, fileId } = req.params;
    const exists = await db.oneOrNone<{ id: string }>(
      'SELECT id FROM book_files WHERE id = $1 AND book_id = $2',
      [fileId, id]
    );
    if (!exists) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const token = signFileTicket(req.user!.id, id, fileId);
    res.json({ token });
  } catch (error) {
    logger.error('Issue file ticket error:', error);
    res.status(500).json({ error: 'Failed to issue file ticket' });
  }
});

// Upload a book file into the library (admin only — modifies the shared library).
// Writes the file under a sanitized path inside the read-write books volume,
// then creates a scan record so the worker imports + enriches it asynchronously
// (the request does NOT block on a full scan).
router.post('/upload', requireAdmin, (req: AuthRequest, res) => {
  uploadHandler.single('file')(req, res, async (err: unknown) => {
    if (err) {
      const e = err as { code?: string; message?: string };
      const status = e.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      res.status(status).json({ error: e.message || 'Upload failed' });
      return;
    }
    try {
      const file = (req as AuthRequest & { file?: { originalname: string; buffer: Buffer; size: number } }).file;
      if (!file) {
        res.status(400).json({ error: 'No file provided (field name must be "file")' });
        return;
      }

      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_UPLOAD_EXTS.includes(ext)) {
        res.status(415).json({ error: 'Unsupported file type. Allowed: EPUB, PDF, CBZ, MOBI, AZW3' });
        return;
      }

      const safeBase = sanitizeBaseName(path.basename(file.originalname, ext));

      // Place uploads in an "uploads/" subfolder; resolveWithin rejects any
      // path that would escape the books directory.
      let relativePath = path.join('uploads', `${safeBase}${ext}`);
      let fullPath = resolveWithin(config.booksPath, relativePath);
      if (!fullPath) {
        res.status(400).json({ error: 'Invalid file path' });
        return;
      }

      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      // Avoid clobbering an existing file: append a timestamp on collision.
      try {
        await fs.access(fullPath);
        relativePath = path.join('uploads', `${safeBase}-${Date.now()}${ext}`);
        fullPath = resolveWithin(config.booksPath, relativePath)!;
      } catch {
        // does not exist — good
      }

      await fs.writeFile(fullPath, file.buffer);

      // Trigger an asynchronous scan (worker picks up RUNNING rows). This reuses
      // the existing scanner + metadata/cover enrichment pipeline.
      const scan = await db.one<{ id: string }>(
        `INSERT INTO scan_history (status, started_at)
         VALUES ('RUNNING', CURRENT_TIMESTAMP)
         RETURNING id`
      );

      logger.info(`Uploaded book file: ${relativePath} (scan ${scan.id})`);
      res.status(201).json({
        message: 'Upload successful; importing in the background',
        path: relativePath,
        scan_id: scan.id,
      });
    } catch (error) {
      logger.error('Upload error:', error);
      res.status(500).json({ error: 'Failed to save upload' });
    }
  });
});

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
      books: await attachListDetails(books),
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
       WHERE rp.user_id = $1 AND rp.progress_percent < 100 AND rp.finished = false
       ORDER BY rp.last_read_at DESC
       LIMIT $2`,
      [req.user!.id, limit]
    );

    // Transform to include progress data with each book
    const booksWithProgress = results.map((row: Record<string, unknown>) => ({
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
        progress_percent: Number(row.progress_percent) || 0,
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

// Update book metadata (admin only — metadata changes affect all users)
router.patch('/:id', requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const updates = req.body as UpdateBookRequest;

    const book = await db.oneOrNone('SELECT id FROM books WHERE id = $1', [id]);
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    // Whitelist of columns clients are allowed to update. Anything else
    // (including SQL fragments or protected columns like created_at/series_id)
    // is ignored rather than interpolated into the query.
    const allowedFields: (keyof UpdateBookRequest)[] = [
      'title',
      'subtitle',
      'description',
      'publisher',
      'published_date',
      'language',
      'isbn_10',
      'isbn_13',
      'series_id',
      'series_index',
      'page_count',
      'metadata_locked',
    ];

    const fields: string[] = [];
    const values: (string | number | boolean | null)[] = [];
    let paramIndex = 1;

    for (const key of allowedFields) {
      const value = updates[key];
      if (value !== undefined) {
        fields.push(`${key} = $${paramIndex++}`);
        values.push(value);
      }
    }

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

    const fullPath = resolveWithin(thumbnail ? config.thumbnailsPath : config.coversPath, imagePath);
    if (!fullPath) {
      res.status(400).json({ error: 'Invalid cover path' });
      return;
    }

    try {
      await fs.access(fullPath);
      // Covers rarely change; cache for a day and revalidate via ETag.
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.sendFile(fullPath, { cacheControl: false });
    } catch {
      res.status(404).json({ error: 'Cover file not found' });
    }
  } catch (error) {
    logger.error('Get cover error:', error);
    res.status(500).json({ error: 'Failed to get cover' });
  }
});

// Re-fetch metadata from external sources for a single book (admin only)
router.post('/:id/refresh-metadata', requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const book = await db.oneOrNone<Book>('SELECT * FROM books WHERE id = $1', [id]);
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    if (book.metadata_locked) {
      res.status(409).json({ error: 'Metadata is locked for this book' });
      return;
    }

    const authors = await db.manyOrNone<Author>(
      `SELECT a.* FROM authors a
       INNER JOIN book_authors ba ON a.id = ba.author_id
       WHERE ba.book_id = $1 ORDER BY ba.author_index`,
      [id]
    );

    const enricher = new MetadataEnricher();
    const enriched = await enricher.enrich({
      title: book.title,
      authors: authors.map((a) => a.name),
      isbn: book.isbn_13 || book.isbn_10 || undefined,
      description: book.description || undefined,
      publisher: book.publisher || undefined,
    });

    const updates: Record<string, unknown> = {};
    if (enriched.title && enriched.title !== book.title) {
      updates.title = enriched.title;
      updates.sort_title = enriched.title;
    }
    if (enriched.description && !book.description) updates.description = enriched.description;
    if (enriched.publisher && !book.publisher) updates.publisher = enriched.publisher;
    if (enriched.publishedDate && !book.published_date) updates.published_date = enriched.publishedDate;
    if (enriched.pageCount && !book.page_count) updates.page_count = enriched.pageCount;
    if (enriched.language && !book.language) updates.language = enriched.language;
    if (enriched.isbn && !book.isbn_13 && !book.isbn_10) {
      if (enriched.isbn.length === 13) updates.isbn_13 = enriched.isbn;
      else updates.isbn_10 = enriched.isbn;
    }

    // Handle cover image if provided
    let coverUpdate: Record<string, string> = {};
    if (enriched.coverImage || enriched.coverImageBuffer) {
      const imgBuffer = enriched.coverImageBuffer || enriched.coverImage!;
      try {
        const generator = new CoverGenerator();
        const paths = await generator.generateFromBuffer(imgBuffer, id);
        coverUpdate = { cover_path: paths.coverPath, thumbnail_path: paths.thumbnailPath };
      } catch (coverErr) {
        logger.warn('Cover generation failed during metadata refresh:', coverErr);
      }
    }

    const allUpdates = { ...updates, ...coverUpdate };
    if (Object.keys(allUpdates).length === 0) {
      res.json({ message: 'No new metadata found', book });
      return;
    }

    const fields = Object.keys(allUpdates).map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = Object.values(allUpdates);
    values.push(id);

    const updatedBook = await db.one<Book>(
      `UPDATE books SET ${fields}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length} RETURNING *`,
      values
    );

    res.json(updatedBook);
  } catch (error) {
    logger.error('Refresh metadata error:', error);
    res.status(500).json({ error: 'Failed to refresh metadata' });
  }
});

// Replace book cover (admin only)
// Accepts raw image bytes; client must set Content-Type: image/jpeg or image/png
router.post('/:id/cover', requireAdmin,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: '10mb' }),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const contentType = req.headers['content-type'] || '';

      if (!contentType.startsWith('image/')) {
        res.status(415).json({ error: 'Content-Type must be an image type (image/jpeg, image/png, etc.)' });
        return;
      }

      const imageBuffer = req.body as Buffer;
      if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
        res.status(400).json({ error: 'Image body is empty or invalid' });
        return;
      }

      const book = await db.oneOrNone<Book>(
        'SELECT id, cover_path, thumbnail_path FROM books WHERE id = $1',
        [id]
      );
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }

      const generator = new CoverGenerator();

      // Delete old cover files if they exist
      if (book.cover_path || book.thumbnail_path) {
        await generator.deleteCover(book.cover_path, book.thumbnail_path);
      }

      const paths = await generator.generateFromBuffer(imageBuffer, id);

      const updatedBook = await db.one<Book>(
        `UPDATE books SET cover_path = $1, thumbnail_path = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 RETURNING *`,
        [paths.coverPath, paths.thumbnailPath, id]
      );

      res.json(updatedBook);
    } catch (error) {
      logger.error('Replace cover error:', error);
      res.status(500).json({ error: 'Failed to replace cover' });
    }
  }
);

// Delete book (admin only)
router.delete('/:id', requireAdmin, async (req: AuthRequest, res) => {
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
