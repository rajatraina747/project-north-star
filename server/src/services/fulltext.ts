import fs from 'fs/promises';
import EPub from 'epub2';
import pdfParse from 'pdf-parse';
import db from '../db';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { BookFormat } from '../types';

// In-book full-text indexing: extract the plain text of a book's EPUB/PDF and
// store it in book_fulltext (migration 004) for Postgres full-text search. Only
// EPUB and PDF have a reliable server-side text layer here; other formats yield
// no content and are skipped.

/** Strip HTML tags/entities from EPUB chapter markup and collapse whitespace. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEpubText(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const epub = new EPub(filePath);
      epub.on('error', () => resolve(''));
      epub.on('end', () => {
        // `flow` is the reading-order spine; its runtime shape isn't fully typed.
        const chapters = ((epub as unknown as { flow?: { id: string }[] }).flow) || [];
        if (chapters.length === 0) {
          resolve('');
          return;
        }
        let combined = '';
        let remaining = chapters.length;
        const done = () => {
          remaining -= 1;
          if (remaining === 0) resolve(combined.trim());
        };
        for (const chapter of chapters) {
          epub.getChapter(chapter.id, (err: Error | null, text?: string) => {
            if (!err && text) combined += `${htmlToText(text)}\n`;
            done();
          });
        }
      });
      epub.parse();
    } catch {
      resolve('');
    }
  });
}

async function extractPdfText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const pdf = await pdfParse(buffer);
  return (pdf.text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Extract the readable plain text of a book file. Returns '' for unsupported
 * formats or on any parse failure (callers treat empty as "nothing to index").
 */
export async function extractFullText(filePath: string, format: BookFormat): Promise<string> {
  try {
    if (format === 'EPUB') return await extractEpubText(filePath);
    if (format === 'PDF') return await extractPdfText(filePath);
    return '';
  } catch (error) {
    logger.error(`Full-text extraction failed for ${filePath}:`, error);
    return '';
  }
}

/**
 * Extract and upsert a book's full text into book_fulltext. Returns true when
 * content was indexed, false when there was nothing to index. Content is capped
 * at config.fulltextMaxChars to keep the generated tsvector within bounds.
 */
export async function indexBookFullText(
  bookId: string,
  filePath: string,
  format: BookFormat
): Promise<boolean> {
  const text = await extractFullText(filePath, format);
  if (!text) return false;

  const content = text.slice(0, config.fulltextMaxChars);
  await db.none(
    `INSERT INTO book_fulltext (book_id, content, indexed_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (book_id)
     DO UPDATE SET content = EXCLUDED.content, indexed_at = CURRENT_TIMESTAMP`,
    [bookId, content]
  );
  return true;
}
