export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
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

export interface BookFile {
  id: string;
  book_id: string;
  file_path: string;
  format: 'EPUB' | 'PDF';
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
  last_read_at: string;
}
