export interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  is_admin: boolean;
  is_active: boolean;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type ShelfStatus = 'WANT_TO_READ' | 'READING' | 'FINISHED';

export interface UserBookStatus {
  id: string;
  user_id: string;
  book_id: string;
  status: ShelfStatus;
  created_at: Date;
  updated_at: Date;
}

export interface Author {
  id: string;
  name: string;
  sort_name: string | null;
  bio: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Series {
  id: string;
  name: string;
  description: string | null;
  series_key: string | null;
  provider: string | null;
  provider_series_id: string | null;
  work_count: number | null;
  last_fetched_at: Date | null;
  ttl_days: number | null;
  confidence: number | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Book {
  id: string;
  title: string;
  sort_title: string | null;
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  published_date: Date | null;
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
  created_at: Date;
  updated_at: Date;
}

export interface BookWithDetails extends Book {
  authors: Author[];
  series: Series | null;
  series_total?: number | null;
  series_context?: SeriesContext | null;
  tags: Tag[];
  files: BookFile[];
}

export interface SeriesCatalogEntry {
  title: string;
  position?: number | null;
  isbn13?: string;
  isbn10?: string;
  googleBooksId?: string;
  openLibraryId?: string;
  coverUrl?: string;
  publishedYear?: number;
  authors?: string[];
}

export interface SeriesEntry {
  id: string;
  series_id: string;
  provider_work_id: string | null;
  title: string;
  series_index: number | null;
  isbn13: string | null;
  isbn10: string | null;
  cover_url: string | null;
  published_date: Date | null;
  authors: Array<{ name: string }> | null;
  created_at: Date;
  updated_at: Date;
}

export interface SeriesBookMatch {
  series_id: string;
  provider_work_id: string | null;
  book_id: string;
  match_confidence: number | null;
  created_at: Date;
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

export interface SeriesContext {
  series_key: string;
  series_name: string;
  total: number;
  items: SeriesContextItem[];
}

// Readable in-app: EPUB, PDF, CBZ. Listable + downloadable only: MOBI, AZW3.
export type BookFormat = 'EPUB' | 'PDF' | 'CBZ' | 'MOBI' | 'AZW3';

export interface BookFile {
  id: string;
  book_id: string;
  file_path: string;
  format: BookFormat;
  file_size: number;
  file_hash: string;
  modified_time: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Tag {
  id: string;
  name: string;
  created_at: Date;
}

export enum MetadataSourceType {
  EMBEDDED = 'EMBEDDED',
  FILENAME = 'FILENAME',
  GOOGLE_BOOKS = 'GOOGLE_BOOKS',
  OPEN_LIBRARY = 'OPEN_LIBRARY',
  MANUAL = 'MANUAL',
}

export interface MetadataSource {
  id: string;
  book_id: string;
  source_type: MetadataSourceType;
  source_identifier: string | null;
  confidence_score: number | null;
  metadata: Record<string, unknown>;
  created_at: Date;
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
  device_info: string | null;
  finished: boolean;
  finished_at: Date | null;
  last_read_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ReadingSession {
  id: string;
  user_id: string;
  book_id: string;
  book_file_id: string;
  day: string;
  seconds: number;
  pages_read: number;
  created_at: Date;
  updated_at: Date;
}

export interface ScanHistory {
  id: string;
  started_at: Date;
  completed_at: Date | null;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  files_scanned: number;
  files_added: number;
  files_updated: number;
  files_removed: number;
  files_total: number | null;
  current_phase: string | null;
  current_file: string | null;
  progress_updated_at: Date | null;
  error_message: string | null;
}

export interface Setting {
  key: string;
  value: unknown;
  updated_at: Date;
}

// Request/Response types
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  // Rotating refresh token. Null when the refresh_tokens table isn't present yet
  // (migration 003 not run) — the access token still works, just without renewal.
  refresh_token: string | null;
  user: {
    id: string;
    username: string;
    display_name: string | null;
    is_admin: boolean;
  };
}

export interface UpdateProgressRequest {
  progress_percent: number;
  epub_cfi?: string;
  pdf_page?: number;
  pdf_scroll_position?: number;
  device_info?: string;
}

export interface SearchRequest {
  query: string;
  filters?: {
    authors?: string[];
    series?: string[];
    tags?: string[];
    formats?: BookFormat[];
    language?: string;
  };
  sort?: 'title' | 'author' | 'recent' | 'added';
  limit?: number;
  offset?: number;
  // Opaque keyset cursor from a previous response's `nextCursor`. When present,
  // pagination seeks past the cursor row and `offset` is ignored.
  cursor?: string;
}

export interface SearchResponse {
  books: BookWithDetails[];
  total: number;
  limit: number;
  offset: number;
  // Token to fetch the next page, or null when the last page has been returned.
  nextCursor: string | null;
}

export interface UpdateBookRequest {
  title?: string;
  subtitle?: string;
  description?: string;
  publisher?: string;
  published_date?: string;
  language?: string;
  isbn_10?: string;
  isbn_13?: string;
  series_id?: string;
  series_index?: number;
  page_count?: number;
  metadata_locked?: boolean;
}

export interface ScanRequest {
  force?: boolean;
}

export interface Bookmark {
  id: string;
  user_id: string;
  book_id: string;
  book_file_id: string;
  epub_cfi: string | null;
  pdf_page: number | null;
  label: string | null;
  created_at: Date;
}

export interface CreateBookmarkRequest {
  epub_cfi?: string;
  pdf_page?: number;
  label?: string;
}

// Metadata enrichment types
export interface GoogleBooksResult {
  title: string;
  subtitle?: string;
  authors: string[];
  publisher?: string;
  publishedDate?: string;
  description?: string;
  isbn_10?: string;
  isbn_13?: string;
  pageCount?: number;
  categories?: string[];
  language?: string;
  imageLinks?: {
    thumbnail?: string;
    smallThumbnail?: string;
  };
}

export interface OpenLibraryResult {
  title: string;
  authors: Array<{ name: string }>;
  publishers?: string[];
  publish_date?: string;
  number_of_pages?: number;
  isbn_10?: string[];
  isbn_13?: string[];
  subjects?: string[];
  covers?: number[];
}

export interface ExtractedMetadata {
  title?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  description?: string;
  language?: string;
  isbn?: string;
  pageCount?: number;
  coverImage?: Buffer;
  coverImageBuffer?: Buffer;
  coverImageMimeType?: string;
}
