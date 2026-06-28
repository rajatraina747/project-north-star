import cron from 'node-cron';
import { logger } from './utils/logger';
import { config } from './utils/config';
import { testConnection } from './db';
import db from './db';
import { LibraryScanner } from './services/scanner';
import { MetadataExtractor } from './services/metadata-extractor';
import { MetadataEnricher } from './services/metadata-enricher';
import { CoverGenerator } from './services/cover-generator';
import { refreshStaleSeries } from './services/series';
import { indexBookFullText } from './services/fulltext';
import { ScanHistory, BookFormat, ExtractedMetadata } from './types';

class WorkerService {
  private scanner: LibraryScanner;
  private metadataExtractor: MetadataExtractor;
  private metadataEnricher: MetadataEnricher;
  private coverGenerator: CoverGenerator;

  constructor() {
    this.scanner = new LibraryScanner();
    this.metadataExtractor = new MetadataExtractor();
    this.metadataEnricher = new MetadataEnricher();
    this.coverGenerator = new CoverGenerator();
  }

  /**
   * Start the worker service
   */
  async start(): Promise<void> {
    logger.info('Starting North Star Worker Service');

    // Test database connection
    const connected = await testConnection();
    if (!connected) {
      logger.error('Failed to connect to database');
      process.exit(1);
    }

    // Start monitoring for scan requests
    this.startScanMonitor();

    // Schedule automatic scans if enabled
    if (config.autoScanEnabled) {
      this.scheduleAutomaticScans();
    }

    logger.info('Worker service started successfully');
  }

  /**
   * Monitor for pending scans
   */
  private startScanMonitor(): void {
    setInterval(async () => {
      try {
        const pendingScan = await db.oneOrNone<ScanHistory>(
          `SELECT * FROM scan_history
           WHERE status = 'RUNNING'
           ORDER BY started_at ASC
           LIMIT 1`
        );

        if (pendingScan) {
          await this.processScan(pendingScan.id);
        }
      } catch (error) {
        logger.error('Error in scan monitor:', error);
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Schedule automatic scans
   */
  private scheduleAutomaticScans(): void {
    cron.schedule(config.scanSchedule, async () => {
      logger.info('Running scheduled library scan');

      try {
        const scan = await db.one<ScanHistory>(
          `INSERT INTO scan_history (status, started_at)
           VALUES ('RUNNING', CURRENT_TIMESTAMP)
           RETURNING *`
        );

        await this.processScan(scan.id);
      } catch (error) {
        logger.error('Scheduled scan failed:', error);
      }
    });

    logger.info(`Scheduled automatic scans: ${config.scanSchedule}`);
  }

  /**
   * Process a library scan, guarded by a Postgres session-level advisory lock.
   *
   * db.task() checks out a single connection and reuses it for every query
   * inside the callback, which means the advisory lock and unlock run on the
   * same backend session — required for session-scoped advisory locks.
   *
   * If another worker replica holds the lock for this scanId, pg_try_advisory_lock
   * returns false immediately (non-blocking) and we skip processing.
   */
  private async processScan(scanId: string): Promise<void> {
    await db.task(async (t) => {
      const { acquired } = await t.one<{ acquired: boolean }>(
        `SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`,
        [`northstar_scan:${scanId}`]
      );

      if (!acquired) {
        logger.warn(`Scan ${scanId} is already being processed by another worker`);
        return;
      }

      try {
        logger.info(`Processing scan ${scanId}`);

        const result = await this.scanner.scan(scanId);

        logger.info(`Scan ${scanId} completed: ${result.added} added, ${result.updated} updated, ${result.removed} removed`);

        await this.processNewBooks();

        try {
          await refreshStaleSeries();
        } catch (error) {
          logger.error('Stale series refresh failed:', error);
        }
      } catch (error) {
        logger.error(`Scan ${scanId} failed:`, error);
      } finally {
        await t.none(`SELECT pg_advisory_unlock(hashtext($1))`, [`northstar_scan:${scanId}`]);
      }
    });
  }

  /**
   * Process metadata for newly added books
   */
  private async processNewBooks(): Promise<void> {
    try {
      // Drain the backlog of unprocessed books in batches. A book is considered
      // "processed" once it has any metadata_sources row (processBookMetadata
      // always writes an EMBEDDED source first), which prevents the same books
      // from being re-enriched — and re-hitting external APIs — on every scan.
      const batchSize = Math.max(1, config.maxConcurrentScans);

      // Safety bound so a persistent failure can't loop forever.
      const maxBatches = 1000;

      for (let batch = 0; batch < maxBatches; batch++) {
        const booksToProcess = await db.manyOrNone<{ id: string; book_id: string; file_path: string; format: BookFormat }>(
          `SELECT DISTINCT ON (bf.book_id) bf.id, bf.book_id, bf.file_path, bf.format
           FROM book_files bf
           INNER JOIN books b ON bf.book_id = b.id
           WHERE NOT EXISTS (
             SELECT 1 FROM metadata_sources ms
             WHERE ms.book_id = b.id
           )
           ORDER BY bf.book_id, bf.format
           LIMIT $1`,
          [batchSize]
        );

        if (!booksToProcess || booksToProcess.length === 0) {
          return;
        }

        logger.info(`Processing metadata for ${booksToProcess.length} books`);

        for (const file of booksToProcess) {
          try {
            await this.processBookMetadata(file.book_id, file.file_path, file.format);
          } catch (error) {
            logger.error(`Error processing metadata for book ${file.book_id}:`, error);
            // Record a marker so a permanently failing book doesn't wedge the
            // batch loop (it would otherwise be selected again every iteration).
            await db.none(
              `INSERT INTO metadata_sources (book_id, source_type, confidence_score, metadata)
               VALUES ($1, 'EMBEDDED', 0, $2)`,
              [file.book_id, JSON.stringify({ error: 'metadata extraction failed' })]
            ).catch(() => undefined);
          }
        }
      }
    } catch (error) {
      logger.error('Error processing new books:', error);
    }
  }

  /**
   * Process metadata for a single book
   */
  private async processBookMetadata(bookId: string, filePath: string, format: BookFormat): Promise<void> {
    try {
      const fullPath = `${config.booksPath}/${filePath}`;

      logger.info(`Extracting metadata from ${filePath}`);

      // Extract embedded metadata
      const extractedMetadata = await this.metadataExtractor.extract(fullPath, format);

      // Save embedded metadata
      await db.none(
        `INSERT INTO metadata_sources (book_id, source_type, confidence_score, metadata)
         VALUES ($1, 'EMBEDDED', 0.5, $2)`,
        [bookId, JSON.stringify(extractedMetadata)]
      );

      // Index the in-book full text for search (best-effort: a failure here must
      // not block metadata/cover processing).
      try {
        await indexBookFullText(bookId, fullPath, format);
      } catch (error) {
        logger.error(`Full-text indexing failed for book ${bookId}:`, error);
      }

      // Enrich with external APIs
      const enrichedMetadata = await this.metadataEnricher.enrich(extractedMetadata);

      // Update book with enriched metadata
      await this.updateBookWithMetadata(bookId, enrichedMetadata);

      // Generate cover from extracted buffer or API image
      let coverGenerated = false;

      // First try extracted cover from EPUB
      if (extractedMetadata.coverImageBuffer) {
        try {
          const coverPaths = await this.coverGenerator.generateFromBuffer(extractedMetadata.coverImageBuffer, bookId);
          await db.none(
            `UPDATE books
             SET cover_path = $1, thumbnail_path = $2
             WHERE id = $3`,
            [coverPaths.coverPath, coverPaths.thumbnailPath, bookId]
          );
          coverGenerated = true;
          logger.info(`Generated cover from embedded image for book ${bookId}`);
        } catch (error) {
          logger.error(`Failed to generate cover from embedded image for book ${bookId}:`, error);
        }
      }

      // Fallback to API cover image
      if (!coverGenerated && enrichedMetadata.coverImage) {
        try {
          const coverPaths = await this.coverGenerator.generateFromBuffer(enrichedMetadata.coverImage, bookId);
          await db.none(
            `UPDATE books
             SET cover_path = $1, thumbnail_path = $2
             WHERE id = $3`,
            [coverPaths.coverPath, coverPaths.thumbnailPath, bookId]
          );
          coverGenerated = true;
          logger.info(`Generated cover from API image for book ${bookId}`);
        } catch (error) {
          logger.error(`Failed to generate cover from API image for book ${bookId}:`, error);
        }
      }

      // Last resort for PDFs with no embedded/external cover: rasterize page 1.
      if (!coverGenerated && format === 'PDF') {
        try {
          const coverPaths = await this.coverGenerator.extractFromPdf(fullPath, bookId);
          if (coverPaths) {
            await db.none(
              `UPDATE books
               SET cover_path = $1, thumbnail_path = $2
               WHERE id = $3`,
              [coverPaths.coverPath, coverPaths.thumbnailPath, bookId]
            );
            logger.info(`Generated cover by rasterizing PDF for book ${bookId}`);
          }
        } catch (error) {
          logger.error(`Failed to rasterize PDF cover for book ${bookId}:`, error);
        }
      }

      logger.info(`Metadata processed for book ${bookId}`);
    } catch (error) {
      logger.error(`Error processing book metadata for ${bookId}:`, error);
      throw error;
    }
  }

  /**
   * Update book with extracted/enriched metadata
   */
  private async updateBookWithMetadata(bookId: string, metadata: ExtractedMetadata): Promise<void> {
    try {
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (metadata.title) {
        updates.push(`title = $${paramIndex++}`);
        values.push(metadata.title);
        updates.push(`sort_title = $${paramIndex++}`);
        values.push(metadata.title);
      }

      if (metadata.description) {
        updates.push(`description = $${paramIndex++}`);
        values.push(metadata.description);
      }

      if (metadata.publisher) {
        updates.push(`publisher = $${paramIndex++}`);
        values.push(metadata.publisher);
      }

      if (metadata.publishedDate) {
        updates.push(`published_date = $${paramIndex++}`);
        values.push(metadata.publishedDate);
      }

      if (metadata.language) {
        updates.push(`language = $${paramIndex++}`);
        values.push(metadata.language);
      }

      if (metadata.pageCount) {
        updates.push(`page_count = $${paramIndex++}`);
        values.push(metadata.pageCount);
      }

      if (metadata.isbn) {
        const isbn = metadata.isbn.replace(/[-\s]/g, '');
        if (isbn.length === 10) {
          updates.push(`isbn_10 = $${paramIndex++}`);
          values.push(isbn);
        } else if (isbn.length === 13) {
          updates.push(`isbn_13 = $${paramIndex++}`);
          values.push(isbn);
        }
      }

      if (updates.length > 0) {
        values.push(bookId);
        await db.none(
          `UPDATE books SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex}`,
          values
        );
      }

      // Handle authors
      if (metadata.authors && metadata.authors.length > 0) {
        await this.updateBookAuthors(bookId, metadata.authors);
      }
    } catch (error) {
      logger.error('Error updating book metadata:', error);
      throw error;
    }
  }

  /**
   * Update book authors
   */
  private async updateBookAuthors(bookId: string, authorNames: string[]): Promise<void> {
    try {
      for (let i = 0; i < authorNames.length; i++) {
        const rawAuthorName = authorNames[i];
        const { displayName, sortName } = this.normalizeAuthorName(rawAuthorName);

        // Find author by either display name or sort name
        let author = await db.oneOrNone(
          'SELECT id FROM authors WHERE name = $1 OR sort_name = $2',
          [displayName, sortName]
        );

        if (!author) {
          author = await db.one(
            `INSERT INTO authors (name, sort_name)
             VALUES ($1, $2)
             RETURNING id`,
            [displayName, sortName]
          );
          logger.info(`Created author: ${displayName} (sort: ${sortName})`);
        }

        // Link author to book
        await db.none(
          `INSERT INTO book_authors (book_id, author_id, author_index)
           VALUES ($1, $2, $3)
           ON CONFLICT (book_id, author_id) DO NOTHING`,
          [bookId, author.id, i]
        );
      }
    } catch (error) {
      logger.error('Error updating book authors:', error);
      throw error;
    }
  }

  /**
   * Normalize author name to handle different formats
   * Converts "Lastname, Firstname" OR "Firstname Lastname" -> consistent format
   */
  private normalizeAuthorName(name: string): { displayName: string; sortName: string } {
    const trimmed = name.trim();

    // Check if name is in "Lastname, Firstname" format
    if (trimmed.includes(',')) {
      const parts = trimmed.split(',').map(p => p.trim());
      const lastName = parts[0];
      const firstName = parts[1] || '';

      return {
        displayName: firstName ? `${firstName} ${lastName}` : lastName,
        sortName: trimmed, // Keep original "Lastname, Firstname" format for sorting
      };
    }

    // Name is in "Firstname Lastname" format
    const words = trimmed.split(/\s+/);
    if (words.length >= 2) {
      const lastName = words[words.length - 1];
      const firstName = words.slice(0, -1).join(' ');

      return {
        displayName: trimmed,
        sortName: `${lastName}, ${firstName}`,
      };
    }

    // Single name (like "Madonna")
    return {
      displayName: trimmed,
      sortName: trimmed,
    };
  }
}

// Start the worker
const worker = new WorkerService();
worker.start().catch((error) => {
  logger.error('Worker failed to start:', error);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down worker...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down worker...');
  process.exit(0);
});
