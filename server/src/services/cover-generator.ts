import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
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
   * Extract a cover by rasterizing the PDF's first page. Uses the Node-friendly
   * pdf.js build with @napi-rs/canvas (pure prebuilt binary — no cairo/system
   * deps). Best-effort: any failure returns null so the caller falls back to
   * external cover lookup.
   */
  async extractFromPdf(pdfPath: string, bookId: string): Promise<{ coverPath: string; thumbnailPath: string } | null> {
    try {
      const napi = await import('@napi-rs/canvas');

      // pdf.js expects these to exist as globals when running under Node.
      const g = globalThis as Record<string, unknown>;
      g.DOMMatrix = g.DOMMatrix || napi.DOMMatrix;
      g.Path2D = g.Path2D || napi.Path2D;
      g.ImageData = g.ImageData || napi.ImageData;

      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');

      // Bridge pdf.js's canvas needs to @napi-rs/canvas.
      const canvasFactory = {
        create(w: number, h: number) {
          const canvas = napi.createCanvas(w, h);
          return { canvas, context: canvas.getContext('2d') };
        },
        reset(cc: { canvas: { width: number; height: number } }, w: number, h: number) {
          cc.canvas.width = w;
          cc.canvas.height = h;
        },
        destroy(cc: { canvas: { width: number; height: number } }) {
          cc.canvas.width = 0;
          cc.canvas.height = 0;
        },
      };

      const data = new Uint8Array(await fs.readFile(pdfPath));
      const doc = await pdfjs.getDocument({
        data,
        disableWorker: true,
        isEvalSupported: false,
        canvasFactory,
      }).promise;

      if (doc.numPages < 1) {
        logger.warn(`PDF has no pages: ${pdfPath}`);
        return null;
      }

      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const cc = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: cc.context, viewport, canvasFactory }).promise;

      const png = cc.canvas.toBuffer('image/png');
      await doc.cleanup?.();

      logger.info(`Rasterized PDF cover from first page: ${pdfPath}`);
      return await this.generateFromBuffer(png, bookId);
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
