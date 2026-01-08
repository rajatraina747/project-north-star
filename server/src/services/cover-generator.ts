import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { hashBuffer } from '../utils/hash';

export class CoverGenerator {
  private coversPath: string;
  private thumbnailsPath: string;
  private coverQuality: number;
  private thumbnailSize: number;

  constructor() {
    this.coversPath = config.coversPath;
    this.thumbnailsPath = config.thumbnailsPath;
    this.coverQuality = config.coverQuality;
    this.thumbnailSize = config.thumbnailSize;
  }

  /**
   * Generate cover and thumbnail from image buffer
   */
  async generateFromBuffer(imageBuffer: Buffer, bookId: string): Promise<{ coverPath: string; thumbnailPath: string }> {
    try {
      // Ensure directories exist
      await fs.mkdir(this.coversPath, { recursive: true });
      await fs.mkdir(this.thumbnailsPath, { recursive: true });

      const hash = hashBuffer(imageBuffer).substring(0, 16);
      const coverFilename = `${bookId}-${hash}.jpg`;
      const thumbnailFilename = `${bookId}-${hash}-thumb.jpg`;

      const coverPath = path.join(this.coversPath, coverFilename);
      const thumbnailPath = path.join(this.thumbnailsPath, thumbnailFilename);

      // Generate full cover (max 1200px width, maintain aspect ratio)
      await sharp(imageBuffer)
        .resize(1200, 1800, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: this.coverQuality })
        .toFile(coverPath);

      // Generate thumbnail
      await sharp(imageBuffer)
        .resize(this.thumbnailSize, Math.floor(this.thumbnailSize * 1.5), {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toFile(thumbnailPath);

      logger.info(`Generated cover and thumbnail for book ${bookId}`);

      return {
        coverPath: coverFilename,
        thumbnailPath: thumbnailFilename,
      };
    } catch (error) {
      logger.error('Error generating cover from buffer:', error);
      throw error;
    }
  }

  /**
   * Extract cover from PDF (first page)
   */
  async extractFromPdf(pdfPath: string, bookId: string): Promise<{ coverPath: string; thumbnailPath: string } | null> {
    try {
      const pdfBuffer = await fs.readFile(pdfPath);
      const pdfDoc = await PDFDocument.load(pdfBuffer);

      if (pdfDoc.getPageCount() === 0) {
        logger.warn(`PDF has no pages: ${pdfPath}`);
        return null;
      }

      // Note: pdf-lib doesn't support rendering to image
      // For a production system, you'd use a library like pdf2pic or pdf-to-image
      // For now, we'll skip PDF cover extraction and rely on external metadata
      logger.info(`Skipping PDF cover extraction for ${pdfPath} - not implemented`);

      return null;
    } catch (error) {
      logger.error('Error extracting PDF cover:', error);
      return null;
    }
  }

  /**
   * Download and save cover from URL
   */
  async downloadCover(imageUrl: string, bookId: string): Promise<{ coverPath: string; thumbnailPath: string } | null> {
    try {
      const axios = (await import('axios')).default;
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });

      const imageBuffer = Buffer.from(response.data);

      return await this.generateFromBuffer(imageBuffer, bookId);
    } catch (error) {
      logger.error(`Error downloading cover from ${imageUrl}:`, error);
      return null;
    }
  }

  /**
   * Delete cover and thumbnail files
   */
  async deleteCover(coverFilename: string | null, thumbnailFilename: string | null): Promise<void> {
    try {
      if (coverFilename) {
        const coverPath = path.join(this.coversPath, coverFilename);
        await fs.unlink(coverPath).catch(() => {});
      }

      if (thumbnailFilename) {
        const thumbnailPath = path.join(this.thumbnailsPath, thumbnailFilename);
        await fs.unlink(thumbnailPath).catch(() => {});
      }
    } catch (error) {
      logger.error('Error deleting cover files:', error);
    }
  }
}
