export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  is_active?: boolean;
  disabled_at?: string | null;
  created_at?: string;
}

export type ShelfStatus = 'WANT_TO_READ' | 'READING' | 'FINISHED';

export interface ShelfBook extends Book {
  shelf_status: ShelfStatus;
  shelved_at?: string;
}

export interface Book {
  id: string;
  title: string;
  sort_title: string | null;
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  published_date: string | null;
  language: string;
  isbn_10: string | null;
  isbn_13: string | null;
  google_books_id: string | null;
  open_library_id: string | null;
  series_key: string | null;
  series_name: string | null;
  series_id: string | null;
  series_index: number | null;
  page_count: number | null;
  cover_path: string | null;
  thumbnail_path: string | null;
  metadata_locked: boolean;
  created_at: string;
  updated_at: string;
  files?: BookFile[];
  authors?: Author[];
}

export interface BookWithDetails extends Book {
  authors: Author[];
  series: Series | null;
  series_total?: number | null;
  series_context?: SeriesContext | null;
  tags: Tag[];
  files: BookFile[];
}

export interface Author {
  id: string;
  name: string;
  sort_name: string | null;
  bio: string | null;
}

export interface Series {
  id: string;
  name: string;
  description: string | null;
}

export interface SeriesContext {
  series_key: string;
  series_name: string;
  total: number;
  items: SeriesContextItem[];
}

export interface SeriesContextItem {
  title: string;
  position?: number | null;
  coverUrl?: string | null;
  in_library: boolean;
  library_book_id?: string | null;
  acquire?: {
    query: string;
    googleBooksId?: string;
    isbn13?: string;
  };
}

export interface Tag {
  id: string;
  name: string;
}

export type BookFormat = 'EPUB' | 'PDF' | 'CBZ' | 'MOBI' | 'AZW3';

// Formats that have an in-app reader. MOBI/AZW3 are download-only.
export const READABLE_FORMATS: BookFormat[] = ['EPUB', 'PDF', 'CBZ'];

export interface BookFile {
  id: string;
  book_id: string;
  file_path: string;
  format: BookFormat;
  file_size: number;
  file_hash: string;
  modified_time: string;
}

export interface ReadingProgress {
  id: string;
  user_id: string;
  book_id: string;
  book_file_id: string;
  progress_percent: number;
  epub_cfi: string | null;
  pdf_page: number | null;
  pdf_scroll_position: number | null;
  finished?: boolean;
  finished_at?: string | null;
  last_read_at: string;
}

export interface ScanHistory {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  files_scanned: number;
  files_added: number;
  files_updated: number;
  files_removed: number;
  files_total: number | null;
  current_phase: string | null;
  current_file: string | null;
  progress_updated_at: string | null;
  error_message: string | null;
}

export interface ReadingStats {
  total_seconds: number;
  total_pages: number;
  books_finished: number;
  current_streak: number;
  active_days: number;
  avg_pages_per_day: number;
  per_day: { day: string; seconds: number; pages_read: number }[];
  per_book: { book_id: string; title: string; thumbnail_path: string | null; seconds: number; pages_read: number }[];
}

export interface Bookmark {
  id: string;
  user_id: string;
  book_id: string;
  book_file_id: string;
  epub_cfi: string | null;
  pdf_page: number | null;
  label: string | null;
  created_at: string;
}

export interface AuthorWithBooks extends Author {
  books: Book[];
}

export interface SeriesWithBooks extends Series {
  books: Book[];
  book_count?: number;
}

export interface TagWithCount extends Tag {
  book_count?: number;
}
