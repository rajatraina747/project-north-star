import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { hashFile } from '../utils/hash';
import db from '../db';
import { BookFile } from '../types';

export class LibraryScanner {
  private booksPath: string;
  private supportedFormats = ['.epub', '.pdf'];

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
      // Get all files from disk
      const diskFiles = await this.getAllBookFiles(this.booksPath);
      filesScanned = diskFiles.length;

      logger.info(`Found ${filesScanned} book files on disk`);

      // Get existing files from database
      const dbFiles = await db.manyOrNone<BookFile>('SELECT * FROM book_files');
      const dbFileMap = new Map(dbFiles?.map(f => [f.file_path, f]) || []);

      // Process each file
      for (const filePath of diskFiles) {
        try {
          const relativePath = path.relative(this.booksPath, filePath);
          const stats = await fs.stat(filePath);
          const fileHash = await hashFile(filePath);

          const existingFile = dbFileMap.get(relativePath);

          if (!existingFile) {
            // New file
            await this.addNewFile(filePath, relativePath, fileHash, stats.size, stats.mtime);
            filesAdded++;
            logger.info(`Added new file: ${relativePath}`);
          } else if (existingFile.file_hash !== fileHash) {
            // File changed
            await this.updateFile(existingFile.id, fileHash, stats.size, stats.mtime);
            filesUpdated++;
            logger.info(`Updated file: ${relativePath}`);
          }

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

      // Update scan record
      await db.none(
        `UPDATE scan_history
         SET status = 'COMPLETED',
             completed_at = CURRENT_TIMESTAMP,
             files_scanned = $1,
             files_added = $2,
             files_updated = $3,
             files_removed = $4
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
             error_message = $1
         WHERE id = $2`,
        [error instanceof Error ? error.message : 'Unknown error', scanId]
      );

      throw error;
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
   * Add a new file to the database
   */
  private async addNewFile(
    fullPath: string,
    relativePath: string,
    fileHash: string,
    fileSize: number,
    modifiedTime: Date
  ): Promise<void> {
    const format = path.extname(fullPath).substring(1).toUpperCase() as 'EPUB' | 'PDF';

    // Create a new book entry
    const book = await db.one(
      `INSERT INTO books (title, sort_title)
       VALUES ($1, $2)
       RETURNING id`,
      [path.basename(fullPath, path.extname(fullPath)), path.basename(fullPath, path.extname(fullPath))]
    );

    // Create book file entry
    await db.none(
      `INSERT INTO book_files (book_id, file_path, format, file_size, file_hash, modified_time)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [book.id, relativePath, format, fileSize, fileHash, modifiedTime]
    );

    logger.info(`Created new book: ${book.id} for file: ${relativePath}`);
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
