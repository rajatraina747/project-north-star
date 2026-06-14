-- North Star Database Schema
-- PostgreSQL 16+
--
-- This script is idempotent: it can be run repeatedly (e.g. on every deploy)
-- without error. Tables/indexes use IF NOT EXISTS, triggers are dropped before
-- being recreated, and seed rows use ON CONFLICT DO NOTHING.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (designed for future multi-user support)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    is_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Authors table
CREATE TABLE IF NOT EXISTS authors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(500) NOT NULL,
    sort_name VARCHAR(500),
    bio TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Series table
CREATE TABLE IF NOT EXISTS series (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(500) NOT NULL,
    description TEXT,
    series_key VARCHAR(255) UNIQUE,
    provider VARCHAR(20),
    provider_series_id VARCHAR(255),
    work_count INTEGER,
    last_fetched_at TIMESTAMP WITH TIME ZONE,
    ttl_days INTEGER DEFAULT 30,
    confidence DECIMAL(3,2) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Books table
CREATE TABLE IF NOT EXISTS books (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(1000) NOT NULL,
    sort_title VARCHAR(1000),
    subtitle VARCHAR(1000),
    description TEXT,
    publisher VARCHAR(500),
    published_date DATE,
    language VARCHAR(10) DEFAULT 'en',
    isbn_10 VARCHAR(13),
    isbn_13 VARCHAR(17),
    google_books_id VARCHAR(255),
    open_library_id VARCHAR(255),
    series_key VARCHAR(255),
    series_name VARCHAR(500),
    series_id UUID REFERENCES series(id) ON DELETE SET NULL,
    series_index DECIMAL(5,2),
    page_count INTEGER,
    cover_path VARCHAR(1000),
    thumbnail_path VARCHAR(1000),
    metadata_locked BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Book-Author relationship (many-to-many)
CREATE TABLE IF NOT EXISTS book_authors (
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    author_id UUID REFERENCES authors(id) ON DELETE CASCADE,
    author_index INTEGER DEFAULT 0,
    PRIMARY KEY (book_id, author_id)
);

-- Book files (one book can have multiple formats)
CREATE TABLE IF NOT EXISTS book_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    file_path VARCHAR(2000) NOT NULL,
    format VARCHAR(10) NOT NULL CHECK (format IN ('EPUB', 'PDF')),
    file_size BIGINT NOT NULL,
    file_hash VARCHAR(64) NOT NULL,
    modified_time TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_hash)
);

-- Tags/Collections
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Book-Tag relationship
CREATE TABLE IF NOT EXISTS book_tags (
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, tag_id)
);

-- Metadata sources (track where metadata came from)
CREATE TABLE IF NOT EXISTS metadata_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('EMBEDDED', 'FILENAME', 'GOOGLE_BOOKS', 'OPEN_LIBRARY', 'MANUAL')),
    source_identifier VARCHAR(500),
    confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Reading progress/state
CREATE TABLE IF NOT EXISTS reading_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    book_file_id UUID REFERENCES book_files(id) ON DELETE CASCADE,
    progress_percent DECIMAL(5,2) CHECK (progress_percent >= 0 AND progress_percent <= 100),

    -- EPUB specific (CFI - Canonical Fragment Identifier)
    epub_cfi TEXT,

    -- PDF specific
    pdf_page INTEGER,
    pdf_scroll_position DECIMAL(5,2),

    -- Common fields
    device_info VARCHAR(500),
    last_read_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(user_id, book_file_id)
);

-- Library scan history
CREATE TABLE IF NOT EXISTS scan_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
    files_scanned INTEGER DEFAULT 0,
    files_added INTEGER DEFAULT 0,
    files_updated INTEGER DEFAULT 0,
    files_removed INTEGER DEFAULT 0,
    error_message TEXT
);

-- Application settings
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Series catalog entries (cached)
CREATE TABLE IF NOT EXISTS series_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    series_id UUID REFERENCES series(id) ON DELETE CASCADE,
    provider_work_id VARCHAR(255),
    title VARCHAR(1000) NOT NULL,
    series_index DECIMAL(6,2),
    isbn13 VARCHAR(17),
    isbn10 VARCHAR(13),
    cover_url TEXT,
    published_date DATE,
    authors JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(series_id, provider_work_id)
);

-- Optional explicit match table
CREATE TABLE IF NOT EXISTS series_book_match (
    series_id UUID REFERENCES series(id) ON DELETE CASCADE,
    provider_work_id VARCHAR(255),
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    match_confidence DECIMAL(3,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (series_id, provider_work_id, book_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_sort_title ON books(sort_title);
CREATE INDEX IF NOT EXISTS idx_books_series ON books(series_id);
CREATE INDEX IF NOT EXISTS idx_books_series_key ON books(series_key);
CREATE INDEX IF NOT EXISTS idx_series_key ON series(series_key);
CREATE INDEX IF NOT EXISTS idx_series_entries_series_id ON series_entries(series_id);
CREATE INDEX IF NOT EXISTS idx_series_entries_isbn13 ON series_entries(isbn13);
CREATE INDEX IF NOT EXISTS idx_series_book_match_book_id ON series_book_match(book_id);
CREATE INDEX IF NOT EXISTS idx_authors_name ON authors(name);
CREATE INDEX IF NOT EXISTS idx_authors_sort_name ON authors(sort_name);
CREATE INDEX IF NOT EXISTS idx_book_files_book_id ON book_files(book_id);
CREATE INDEX IF NOT EXISTS idx_book_files_hash ON book_files(file_hash);
CREATE INDEX IF NOT EXISTS idx_book_files_format ON book_files(format);
CREATE INDEX IF NOT EXISTS idx_reading_progress_user_book ON reading_progress(user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_reading_progress_last_read ON reading_progress(last_read_at DESC);
CREATE INDEX IF NOT EXISTS idx_metadata_sources_book ON metadata_sources(book_id);
CREATE INDEX IF NOT EXISTS idx_scan_history_started ON scan_history(started_at DESC);

-- Full-text search indexes
CREATE INDEX IF NOT EXISTS idx_books_title_search ON books USING GIN(to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_books_description_search ON books USING GIN(to_tsvector('english', COALESCE(description, '')));
CREATE INDEX IF NOT EXISTS idx_authors_name_search ON authors USING GIN(to_tsvector('english', name));

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_books_updated_at ON books;
CREATE TRIGGER update_books_updated_at BEFORE UPDATE ON books
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_authors_updated_at ON authors;
CREATE TRIGGER update_authors_updated_at BEFORE UPDATE ON authors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_series_updated_at ON series;
CREATE TRIGGER update_series_updated_at BEFORE UPDATE ON series
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_series_entries_updated_at ON series_entries;
CREATE TRIGGER update_series_entries_updated_at BEFORE UPDATE ON series_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_book_files_updated_at ON book_files;
CREATE TRIGGER update_book_files_updated_at BEFORE UPDATE ON book_files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_reading_progress_updated_at ON reading_progress;
CREATE TRIGGER update_reading_progress_updated_at BEFORE UPDATE ON reading_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- No default admin user is seeded. On a fresh database the POST /api/auth/register
-- endpoint is open until the first user (admin) is created, after which it is
-- permanently closed. Run migrations and then call /register to create your admin.

-- Create default settings
INSERT INTO settings (key, value) VALUES
    ('library_path', '"/books"'),
    ('scan_schedule', '"0 2 * * *"'),
    ('metadata_agents', '["GOOGLE_BOOKS", "OPEN_LIBRARY"]'),
    ('auto_scan_enabled', 'false'),
    ('cover_quality', '90'),
    ('thumbnail_size', '300')
ON CONFLICT (key) DO NOTHING;
