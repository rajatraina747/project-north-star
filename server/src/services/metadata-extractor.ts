import path from 'path';
import fs from 'fs/promises';
import EPub from 'epub2';
import pdfParse from 'pdf-parse';
import { logger } from '../utils/logger';
import { ExtractedMetadata, BookFormat } from '../types';

export class MetadataExtractor {
  /**
   * Extract metadata from a book file. EPUB/PDF have embedded-metadata parsers;
   * CBZ/MOBI/AZW3 have no reliable server-side parser here, so we fall back to
   * deriving a title from the filename (enrichment can still match externally).
   */
  async extract(filePath: string, format: BookFormat): Promise<ExtractedMetadata> {
    try {
      if (format === 'EPUB') {
        return await this.extractEpubMetadata(filePath);
      } else if (format === 'PDF') {
        return await this.extractPdfMetadata(filePath);
      }

      return this.extractFromFilename(filePath);
    } catch (error) {
      logger.error(`Error extracting metadata from ${filePath}:`, error);
      return this.extractFromFilename(filePath);
    }
  }

  /**
   * Extract metadata from EPUB file
   */
  private async extractEpubMetadata(filePath: string): Promise<ExtractedMetadata> {
    try {
      return new Promise((resolve, reject) => {
        const epub = new EPub(filePath);

        epub.on('error', (err) => {
          logger.error(`Error parsing EPUB ${filePath}:`, err);
          resolve(this.extractFromFilename(filePath));
        });

        epub.on('end', () => {
          const metadata: ExtractedMetadata = {};

          if (epub.metadata.title) {
            metadata.title = epub.metadata.title;
          }

          if (epub.metadata.creator) {
            metadata.authors = [epub.metadata.creator];
          }

          if (epub.metadata.publisher) {
            metadata.publisher = epub.metadata.publisher;
          }

          if (epub.metadata.description) {
            metadata.description = epub.metadata.description;
          }

          if (epub.metadata.language) {
            metadata.language = epub.metadata.language;
          }

          if (epub.metadata.date) {
            metadata.publishedDate = epub.metadata.date;
          }

          if (epub.metadata.ISBN) {
            metadata.isbn = epub.metadata.ISBN;
          }

          // Extract cover image if available
          if (epub.metadata.cover) {
            const coverImageId = epub.metadata.cover;
            epub.getImage(coverImageId, (err, data, mimeType) => {
              if (!err && data) {
                metadata.coverImageBuffer = data;
                metadata.coverImageMimeType = mimeType;
              }
              resolve(metadata);
            });
          } else {
            resolve(metadata);
          }
        });

        epub.parse();
      });
    } catch (error) {
      logger.error(`Error parsing EPUB ${filePath}:`, error);
      return this.extractFromFilename(filePath);
    }
  }

  /**
   * Extract metadata from PDF file
   */
  private async extractPdfMetadata(filePath: string): Promise<ExtractedMetadata> {
    try {
      const buffer = await fs.readFile(filePath);
      const pdf = await pdfParse(buffer);

      const metadata: ExtractedMetadata = {};

      if (pdf.info?.Title) {
        metadata.title = pdf.info.Title;
      }

      if (pdf.info?.Author) {
        metadata.authors = pdf.info.Author.split(/[,;&]/).map((a: string) => a.trim());
      }

      if (pdf.info?.Subject) {
        metadata.description = pdf.info.Subject;
      }

      if (pdf.numpages) {
        metadata.pageCount = pdf.numpages;
      }

      // Fallback to filename if no title
      if (!metadata.title) {
        metadata.title = path.basename(filePath, '.pdf');
      }

      return metadata;
    } catch (error) {
      logger.error(`Error parsing PDF ${filePath}:`, error);
      return this.extractFromFilename(filePath);
    }
  }

  /**
   * Extract basic metadata from filename
   */
  private extractFromFilename(filePath: string): ExtractedMetadata {
    const basename = path.basename(filePath, path.extname(filePath)).trim();

    let working = basename;
    let author: string | undefined;

    // A trailing "(Author)" is a very common convention, e.g.
    // "Series - Title (Rick Riordan)".
    const paren = working.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (paren) {
      working = paren[1].trim();
      author = paren[2].trim();
    }

    let title = working;
    if (working.includes(' - ')) {
      const parts = working.split(' - ').map((p) => p.trim()).filter(Boolean);
      if (author) {
        // Author already known from parentheses: the last segment (after any
        // "Series - ") is the actual book title.
        title = parts[parts.length - 1];
      } else {
        // No parenthetical author: assume the classic "Author - Title" form.
        author = parts[0];
        title = parts.slice(1).join(' - ');
      }
    }

    const result: ExtractedMetadata = { title: title || basename };
    if (author) {
      result.authors = [author];
    }
    return result;
  }

  /**
   * Clean and normalize title
   */
  private normalizeTitle(title: string): string {
    return title
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\-']/g, '');
  }
}
