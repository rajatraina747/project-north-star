-- In-book full-text search: store the extracted plain text of each book's
-- EPUB/PDF and a generated tsvector for Postgres full-text search. Kept in a
-- side table (not on books) so the large content/index doesn't bloat the hot
-- books row. Idempotent so it's safe to re-run.
CREATE TABLE IF NOT EXISTS book_fulltext (
    book_id UUID PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    -- Maintained automatically from content; English config matches the rest of
    -- the search route's to_tsvector/plainto_tsquery usage.
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    indexed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_book_fulltext_tsv ON book_fulltext USING GIN (tsv);
