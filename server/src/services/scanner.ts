import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { hashFile } from '../utils/hash';
import db from '../db';
import { BookFile, BookFormat } from '../types';

export class LibraryScanner {
  private booksPath: string;
  // Readable in-app: .epub, .pdf, .cbz. Listable/downloadable only: .mobi, .azw3.
  private supportedFormats = ['.epub', '.pdf', '.cbz', '.mobi', '.azw3'];

  constructor(booksPath: string = config.booksPath) {
    this.booksPath = booksPath;
  }

  /**
   * Scan the library for new or changed books
   */
  async scan(scanId: string): Promise<{ added: number; updated: number; removed: number }> {
    logger.info(`Starting library scan: ${scanId}`);

    let filesScanned = 0;
    let filesAdded = 0;
    let filesUpdated = 0;
    let filesRemoved = 0;

    try {
      await this.updateProgress(scanId, { phase: 'SCANNING', file: null });

      // Get all files from disk
      const diskFiles = await this.getAllBookFiles(this.booksPath);
      filesScanned = diskFiles.length;

      logger.info(`Found ${filesScanned} book files on disk`);

      await db.none(
        `UPDATE scan_history SET files_total = $1, current_phase = 'SCANNING',
           progress_updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [diskFiles.length, scanId]
      );

      // Get existing files from database
      const dbFiles = await db.manyOrNone<BookFile>('SELECT * FROM book_files');
      const dbFileMap = new Map(dbFiles?.map(f => [f.file_path, f]) || []);
      const dbFileByHash = new Map((dbFiles || []).map(f => [f.file_hash, f]));

      // Process each file
      let processed = 0;
      for (const filePath of diskFiles) {
        try {
          const relativePath = path.relative(this.booksPath, filePath);

          // Throttled progress write (every few files + first one) so the SSE
          // stream stays live without a DB write per file on large libraries.
          if (processed % 5 === 0) {
            await this.updateProgress(scanId, {
              phase: 'SCANNING',
              file: relativePath,
              scanned: processed,
              added: filesAdded,
              updated: filesUpdated,
            });
          }
          processed++;
          const stats = await fs.stat(filePath);
          const fileHash = await hashFile(filePath);

          const existingFile = dbFileMap.get(relativePath);

          if (existingFile) {
            if (existingFile.file_hash !== fileHash) {
              // File changed in place
              await this.updateFile(existingFile.id, fileHash, stats.size, stats.mtime);
              filesUpdated++;
              logger.info(`Updated file: ${relativePath}`);
            }
            dbFileMap.delete(relativePath);
            continue;
          }

          // Not found by path. If we already know this exact content by hash,
          // the file was moved/renamed — update its path instead of creating a
          // duplicate book (which would also violate the UNIQUE(file_hash)).
          const movedFile = dbFileByHash.get(fileHash);
          if (movedFile) {
            await db.none(
              `UPDATE book_files
               SET file_path = $1, file_size = $2, modified_time = $3, updated_at = CURRENT_TIMESTAMP
               WHERE id = $4`,
              [relativePath, stats.size, stats.mtime, movedFile.id]
            );
            filesUpdated++;
            logger.info(`Relocated file: ${movedFile.file_path} -> ${relativePath}`);
            dbFileMap.delete(movedFile.file_path);
            continue;
          }

          // Genuinely new file.
          await this.addNewFile(relativePath, fileHash, stats.size, stats.mtime);
          filesAdded++;
          logger.info(`Added new file: ${relativePath}`);

          // Remove from map (files left in map will be deleted)
          dbFileMap.delete(relativePath);
        } catch (error) {
          logger.error(`Error processing file ${filePath}:`, error);
        }
      }

      // Remove files that no longer exist
      for (const [filePath, file] of dbFileMap.entries()) {
        await db.none('DELETE FROM book_files WHERE id = $1', [file.id]);
        filesRemoved++;
        logger.info(`Removed missing file: ${filePath}`);
      }

      // Clean up books that no longer have any files (orphans left behind by
      // removals or by older one-book-per-file imports).
      const orphans = await db.result(
        `DELETE FROM books b
         WHERE NOT EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = b.id)`
      );
      if (orphans.rowCount > 0) {
        logger.info(`Removed ${orphans.rowCount} orphaned book record(s)`);
      }

      // Update scan record
      await db.none(
        `UPDATE scan_history
         SET status = 'COMPLETED',
             completed_at = CURRENT_TIMESTAMP,
             files_scanned = $1,
             files_added = $2,
             files_updated = $3,
             files_removed = $4,
             current_phase = 'COMPLETED',
             current_file = NULL,
             progress_updated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [filesScanned, filesAdded, filesUpdated, filesRemoved, scanId]
      );

      logger.info(`Scan completed: ${filesAdded} added, ${filesUpdated} updated, ${filesRemoved} removed`);

      return { added: filesAdded, updated: filesUpdated, removed: filesRemoved };
    } catch (error) {
      logger.error('Scan failed:', error);

      await db.none(
        `UPDATE scan_history
         SET status = 'FAILED',
             completed_at = CURRENT_TIMESTAMP,
             current_phase = 'FAILED',
             current_file = NULL,
             progress_updated_at = CURRENT_TIMESTAMP,
             error_message = $1
         WHERE id = $2`,
        [error instanceof Error ? error.message : 'Unknown error', scanId]
      );

      throw error;
    }
  }

  /**
   * Write a live progress snapshot to scan_history. The API streams these rows
   * to the Admin page over SSE. Best-effort: a failed progress write must never
   * abort the scan.
   */
  private async updateProgress(
    scanId: string,
    p: { phase?: string; file?: string | null; scanned?: number; added?: number; updated?: number }
  ): Promise<void> {
    try {
      const sets: string[] = ['progress_updated_at = CURRENT_TIMESTAMP'];
      const values: (string | number | null)[] = [];
      let i = 1;
      if (p.phase !== undefined) { sets.push(`current_phase = $${i++}`); values.push(p.phase); }
      if (p.file !== undefined) { sets.push(`current_file = $${i++}`); values.push(p.file); }
      if (p.scanned !== undefined) { sets.push(`files_scanned = $${i++}`); values.push(p.scanned); }
      if (p.added !== undefined) { sets.push(`files_added = $${i++}`); values.push(p.added); }
      if (p.updated !== undefined) { sets.push(`files_updated = $${i++}`); values.push(p.updated); }
      values.push(scanId);
      await db.none(`UPDATE scan_history SET ${sets.join(', ')} WHERE id = $${i}`, values);
    } catch (error) {
      logger.warn('Failed to write scan progress:', error);
    }
  }

  /**
   * Recursively find all book files
   */
  private async getAllBookFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip hidden directories
          if (!entry.name.startsWith('.')) {
            const subFiles = await this.getAllBookFiles(fullPath);
            files.push(...subFiles);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (this.supportedFormats.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      logger.error(`Error reading directory ${dir}:`, error);
    }

    return files;
  }

  /**
   * Add a new file to the database. If another format of the same book (same
   * base filename in the same directory) already exists, the file is attached
   * to that book rather than creating a duplicate. The book + file are written
   * in a single transaction so a failure can't leave an orphaned book row.
   */
  private async addNewFile(
    relativePath: string,
    fileHash: string,
    fileSize: number,
    modifiedTime: Date
  ): Promise<void> {
    const ext = path.extname(relativePath);
    const format = ext.substring(1).toUpperCase() as BookFormat;
    const baseName = path.basename(relativePath, ext);

    // Look for a sibling file (other format) of the same book: same directory,
    // same base name, different extension.
    const dir = path.dirname(relativePath);
    const siblingPrefix = path.join(dir, baseName);
    const sibling = await db.oneOrNone<{ book_id: string }>(
      `SELECT book_id FROM book_files
       WHERE file_path = $1 OR file_path = $2
       LIMIT 1`,
      [`${siblingPrefix}.epub`, `${siblingPrefix}.pdf`]
    );

    if (sibling) {
      await db.none(
        `INSERT INTO book_files (book_id, file_path, format, file_size, file_hash, modified_time)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sibling.book_id, relativePath, format, fileSize, fileHash, modifiedTime]
      );
      logger.info(`Attached ${format} to existing book ${sibling.book_id}: ${relativePath}`);
      return;
    }

    await db.tx(async (t) => {
      const book = await t.one(
        `INSERT INTO books (title, sort_title)
         VALUES ($1, $2)
         RETURNING id`,
        [baseName, baseName]
      );

      await t.none(
        `INSERT INTO book_files (book_id, file_path, format, file_size, file_hash, modified_time)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [book.id, relativePath, format, fileSize, fileHash, modifiedTime]
      );

      logger.info(`Created new book: ${book.id} for file: ${relativePath}`);
    });
  }

  /**
   * Update an existing file
   */
  private async updateFile(
    fileId: string,
    fileHash: string,
    fileSize: number,
    modifiedTime: Date
  ): Promise<void> {
    await db.none(
      `UPDATE book_files
       SET file_hash = $1, file_size = $2, modified_time = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [fileHash, fileSize, modifiedTime, fileId]
    );
  }
}
