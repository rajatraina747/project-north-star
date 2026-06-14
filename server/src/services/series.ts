import db from '../db';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import type {
  Book,
  Series,
  SeriesContext,
  SeriesEntry,
  SeriesBookMatch,
} from '../types';
import { fetchGoogleSeriesByIsbn, fetchOpenLibrarySeriesByIsbn, ProviderSeriesResult } from './series-providers';

const SERIES_LOG = 'series';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isSeriesFresh(series: Series): boolean {
  const ttlDays = series.ttl_days || config.seriesCacheTtlDays;
  if (!series.last_fetched_at) return false;
  const last = new Date(series.last_fetched_at).getTime();
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  return Date.now() - last < ttlMs;
}

export async function resolveSeriesIdentity(book: Book, series: Series | null) {
  if (series) {
    const seriesKey = series.series_key || `series:${slugify(series.name)}`;
    return {
      series_id: series.id,
      series_key: seriesKey,
      series_name: series.name,
      position: book.series_index ?? null,
      confidence: 0.8,
    };
  }

  if (book.series_key && book.series_name) {
    return {
      series_id: null,
      series_key: book.series_key,
      series_name: book.series_name,
      position: book.series_index ?? null,
      confidence: 0.7,
    };
  }

  const name = book.series_name;
  if (!name) {
    return null;
  }

  const seriesKey = `series:${slugify(name)}`;
  const existingSeries = await db.oneOrNone<Series>(
    'SELECT * FROM series WHERE series_key = $1 OR name = $2',
    [seriesKey, name]
  );

  if (existingSeries) {
    return {
      series_id: existingSeries.id,
      series_key: existingSeries.series_key || seriesKey,
      series_name: existingSeries.name,
      position: book.series_index ?? null,
      confidence: 0.6,
    };
  }

  return {
    series_id: null,
    series_key: seriesKey,
    series_name: name,
    position: book.series_index ?? null,
    confidence: 0.5,
  };
}

async function getSeriesEntries(seriesId: string): Promise<SeriesEntry[]> {
  return db.manyOrNone<SeriesEntry>(
    `SELECT *
     FROM series_entries
     WHERE series_id = $1
     ORDER BY (series_index IS NULL) ASC, series_index ASC, title ASC`,
    [seriesId]
  );
}

async function getSeriesMatches(seriesId: string): Promise<SeriesBookMatch[]> {
  return db.manyOrNone<SeriesBookMatch>(
    `SELECT *
     FROM series_book_match
     WHERE series_id = $1`,
    [seriesId]
  );
}

async function upsertSeriesMatch(
  seriesId: string,
  providerWorkId: string | null,
  bookId: string,
  confidence: number
): Promise<void> {
  await db.none(
    `INSERT INTO series_book_match (series_id, provider_work_id, book_id, match_confidence)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (series_id, provider_work_id, book_id)
     DO UPDATE SET match_confidence = GREATEST(series_book_match.match_confidence, $4)`,
    [seriesId, providerWorkId, bookId, confidence]
  );
}

export async function buildSeriesContext(
  book: Book,
  series: Series | null
): Promise<SeriesContext | null> {
  const identity = await resolveSeriesIdentity(book, series);
  if (!identity) {
    return null;
  }

  logger.info(`${SERIES_LOG}:resolve`, {
    book_id: book.id,
    series_key: identity.series_key,
    confidence: identity.confidence,
  });

  if (!identity.series_id) {
    logger.info(`${SERIES_LOG}:context`, {
      series_key: identity.series_key,
      used: 'none',
      entries: 0,
    });
    return null;
  }

  const seriesRecord = series || (await db.oneOrNone<Series>('SELECT * FROM series WHERE id = $1', [identity.series_id]));
  if (!seriesRecord) {
    return null;
  }

  // NOTE: provider refresh used to happen here, which made book-detail requests
  // block on (and fail with) external API calls. Refresh is now done by the
  // worker (see refreshStaleSeries) so this path is read-only and fast.

  const [entries, matches, libraryBooks, authorRows] = await Promise.all([
    getSeriesEntries(identity.series_id),
    getSeriesMatches(identity.series_id),
    db.manyOrNone<Book>('SELECT * FROM books'),
    db.manyOrNone<{ book_id: string; author_name: string }>(
      `SELECT ba.book_id, a.name as author_name
       FROM book_authors ba
       INNER JOIN authors a ON a.id = ba.author_id
       ORDER BY ba.author_index ASC`
    ),
  ]);

  if (!entries || entries.length === 0) {
    const fallbackBooks = libraryBooks.filter((item) => item.series_id === identity.series_id);
    if (fallbackBooks.length > 0) {
      logger.info(`${SERIES_LOG}:context`, {
        series_key: identity.series_key,
        used: 'fallback',
        entries: fallbackBooks.length,
      });

      const items = fallbackBooks
        .map((entry) => ({
          title: entry.title,
          position: entry.series_index ?? null,
          coverUrl: null,
          in_library: true,
          library_book_id: entry.id,
        }))
        .sort((a, b) => {
          if (a.position == null && b.position != null) return 1;
          if (a.position != null && b.position == null) return -1;
          if (a.position != null && b.position != null) return a.position - b.position;
          return a.title.localeCompare(b.title);
        });

      return {
        series_key: identity.series_key,
        series_name: identity.series_name,
        total: items.length,
        items,
      };
    }

    logger.info(`${SERIES_LOG}:context`, {
      series_key: identity.series_key,
      used: 'none',
      entries: 0,
    });
    return null;
  }

  const bookAuthorMap = new Map<string, string>();
  for (const row of authorRows) {
    if (!bookAuthorMap.has(row.book_id)) {
      bookAuthorMap.set(row.book_id, row.author_name);
    }
  }

  const matchByWorkId = new Map<string, SeriesBookMatch>();
  for (const match of matches) {
    if (!match.provider_work_id) continue;
    const existing = matchByWorkId.get(match.provider_work_id);
    if (!existing || (match.match_confidence || 0) > (existing.match_confidence || 0)) {
      matchByWorkId.set(match.provider_work_id, match);
    }
  }

  const items = entries.map((entry) => {
    let matchedBook: Book | null = null;
    let confidence = 0;

    if (entry.provider_work_id && matchByWorkId.has(entry.provider_work_id)) {
      const match = matchByWorkId.get(entry.provider_work_id)!;
      matchedBook = libraryBooks.find((bookItem) => bookItem.id === match.book_id) || null;
      confidence = matchedBook ? Math.max(confidence, match.match_confidence || 0.7) : confidence;
    }

    if (!matchedBook && entry.isbn13) {
      matchedBook = libraryBooks.find((bookItem) => bookItem.isbn_13 === entry.isbn13) || null;
      confidence = matchedBook ? 1.0 : confidence;
    }

    if (!matchedBook && entry.isbn10) {
      matchedBook = libraryBooks.find((bookItem) => bookItem.isbn_10 === entry.isbn10) || null;
      confidence = matchedBook ? 0.9 : confidence;
    }

    if (!matchedBook) {
      const entryTitle = normalize(entry.title);
      const entryAuthor = normalize(entry.authors?.[0]?.name || '');
      matchedBook = libraryBooks.find((bookItem) => {
        const titleMatch = normalize(bookItem.title) === entryTitle;
        if (!titleMatch) return false;
        if (!entryAuthor) return true;
        const bookAuthor = normalize(bookAuthorMap.get(bookItem.id) || '');
        return bookAuthor === entryAuthor;
      }) || null;
      confidence = matchedBook ? 0.6 : confidence;
    }

    if (matchedBook) {
      if (!entry.provider_work_id || !matchByWorkId.has(entry.provider_work_id)) {
        upsertSeriesMatch(identity.series_id!, entry.provider_work_id, matchedBook.id, confidence).catch((error) => {
          logger.warn(`${SERIES_LOG}:match_write_failed`, { error });
        });
      }
    }

    const queryParts = [
      entry.title,
      entry.authors?.[0]?.name,
      identity.series_name,
    ].filter(Boolean) as string[];

    return {
      title: entry.title,
      position: entry.series_index ?? null,
      coverUrl: entry.cover_url ?? null,
      in_library: !!matchedBook,
      library_book_id: matchedBook?.id ?? null,
      acquire: matchedBook
        ? undefined
        : {
            query: queryParts.join(' '),
            isbn13: entry.isbn13 ?? undefined,
          },
    };
  });

  logger.info(`${SERIES_LOG}:context`, {
    series_key: identity.series_key,
    used: 'catalog',
    entries: items.length,
  });

  return {
    series_key: identity.series_key,
    series_name: identity.series_name,
    total: entries.length,
    items,
  };
}

async function ensureSeriesRecord(book: Book, series: Series | null): Promise<Series | null> {
  if (series) {
    if (!series.series_key) {
      const seriesKey = `series:${slugify(series.name)}`;
      await db.none(
        `UPDATE series
         SET series_key = $1
         WHERE id = $2`,
        [seriesKey, series.id]
      );
      return { ...series, series_key: seriesKey };
    }
    return series;
  }

  const name = book.series_name;
  if (!name) {
    return null;
  }

  const seriesKey = book.series_key || `series:${slugify(name)}`;
  const existing = await db.oneOrNone<Series>(
    'SELECT * FROM series WHERE series_key = $1 OR name = $2',
    [seriesKey, name]
  );

  if (existing) {
    return existing;
  }

  return db.one<Series>(
    `INSERT INTO series (name, series_key, provider)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, seriesKey, 'internal']
  );
}

async function upsertSeriesEntries(seriesId: string, entries: SeriesEntry[]): Promise<void> {
  for (const entry of entries) {
    await db.none(
      `INSERT INTO series_entries
       (series_id, provider_work_id, title, series_index, isbn13, isbn10, cover_url, published_date, authors)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (series_id, provider_work_id)
       DO UPDATE SET
         title = EXCLUDED.title,
         series_index = EXCLUDED.series_index,
         isbn13 = EXCLUDED.isbn13,
         isbn10 = EXCLUDED.isbn10,
         cover_url = EXCLUDED.cover_url,
         published_date = EXCLUDED.published_date,
         authors = EXCLUDED.authors`,
      [
        seriesId,
        entry.provider_work_id,
        entry.title,
        entry.series_index,
        entry.isbn13,
        entry.isbn10,
        entry.cover_url,
        entry.published_date,
        entry.authors ? JSON.stringify(entry.authors) : null,
      ]
    );
  }
}

async function fetchProviderSeries(book: Book): Promise<ProviderSeriesResult | null> {
  const isbnSeed = book.isbn_13 || book.isbn_10;
  if (!isbnSeed) {
    logger.info(`${SERIES_LOG}:refresh_skip`, { reason: 'missing_isbn', book_id: book.id });
    return null;
  }

  const useGoogle = config.seriesProvider === 'google' || config.seriesProvider === 'hybrid';
  const useOpenLibrary = config.seriesProvider === 'openlibrary' || config.seriesProvider === 'hybrid';
  let providerResult: ProviderSeriesResult | null = null;

  if (useGoogle) {
    providerResult = await fetchGoogleSeriesByIsbn(isbnSeed, config.googleBooksApiKey);
  }

  if (!providerResult && useOpenLibrary) {
    providerResult = await fetchOpenLibrarySeriesByIsbn(isbnSeed);
  }

  return providerResult;
}

async function createSeriesFromProvider(result: ProviderSeriesResult): Promise<Series> {
  const seriesKey = `series:${slugify(result.series_name)}`;
  return db.one<Series>(
    `INSERT INTO series (name, series_key, provider, provider_series_id, work_count, last_fetched_at, ttl_days, confidence, notes)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7, $8)
     ON CONFLICT (series_key)
     DO UPDATE SET
       name = EXCLUDED.name,
       provider = EXCLUDED.provider,
       provider_series_id = EXCLUDED.provider_series_id,
       work_count = EXCLUDED.work_count,
       last_fetched_at = EXCLUDED.last_fetched_at,
       ttl_days = EXCLUDED.ttl_days,
       confidence = EXCLUDED.confidence,
       notes = EXCLUDED.notes
     RETURNING *`,
    [
      result.series_name,
      seriesKey,
      result.provider,
      result.provider_series_id,
      result.entries.length,
      config.seriesCacheTtlDays,
      result.confidence,
      result.notes || null,
    ]
  );
}

async function refreshSeriesFromProviders(book: Book, seriesRecord: Series): Promise<void> {
  if (config.seriesProvider === 'internal') {
    return;
  }
  const providerResult = await fetchProviderSeries(book);

  if (!providerResult || providerResult.entries.length === 0) {
    logger.info(`${SERIES_LOG}:refresh_empty`, { book_id: book.id, series_key: seriesRecord.series_key });
    return;
  }

  await db.none(
    `UPDATE series
     SET name = $1,
         provider = $2,
         provider_series_id = $3,
         work_count = $4,
         last_fetched_at = CURRENT_TIMESTAMP,
         confidence = $5,
         notes = $6
     WHERE id = $7`,
    [
      providerResult.series_name,
      providerResult.provider,
      providerResult.provider_series_id,
      providerResult.entries.length,
      providerResult.confidence,
      providerResult.notes || null,
      seriesRecord.id,
    ]
  );

  const entries: SeriesEntry[] = providerResult.entries.map((entry) => ({
    id: '',
    series_id: seriesRecord.id,
    provider_work_id: entry.provider_work_id,
    title: entry.title,
    series_index: entry.series_index,
    isbn13: entry.isbn13,
    isbn10: entry.isbn10,
    cover_url: entry.cover_url,
    published_date: entry.published_date ? new Date(entry.published_date) : null,
    authors: entry.authors || null,
    created_at: new Date(),
    updated_at: new Date(),
  }));

  await upsertSeriesEntries(seriesRecord.id, entries);

  logger.info(`${SERIES_LOG}:refresh`, {
    series_id: seriesRecord.id,
    source: providerResult.provider,
    entries: providerResult.entries.length,
  });
}

/**
 * Refresh all series whose cache has gone stale. Intended to be run by the
 * worker (off the request path). For each stale series it picks a representative
 * book that carries an ISBN and refreshes the catalog from the provider.
 */
export async function refreshStaleSeries(limit = 25): Promise<{ refreshed: number }> {
  if (config.seriesProvider === 'internal') {
    return { refreshed: 0 };
  }

  const staleSeries = await db.manyOrNone<Series>(
    `SELECT * FROM series
     WHERE last_fetched_at IS NULL
        OR last_fetched_at < NOW() - (COALESCE(ttl_days, $1) || ' days')::interval
     ORDER BY last_fetched_at ASC NULLS FIRST
     LIMIT $2`,
    [config.seriesCacheTtlDays, limit]
  );

  let refreshed = 0;
  for (const seriesRecord of staleSeries || []) {
    // Find a book in this series that has an ISBN to seed the provider lookup.
    const seedBook = await db.oneOrNone<Book>(
      `SELECT * FROM books
       WHERE series_id = $1
         AND (isbn_13 IS NOT NULL OR isbn_10 IS NOT NULL)
       ORDER BY series_index ASC NULLS LAST
       LIMIT 1`,
      [seriesRecord.id]
    );

    if (!seedBook) {
      // Touch last_fetched_at so we don't re-scan a seedless series every cycle.
      await db.none('UPDATE series SET last_fetched_at = CURRENT_TIMESTAMP WHERE id = $1', [seriesRecord.id]);
      continue;
    }

    try {
      await refreshSeriesFromProviders(seedBook, seriesRecord);
      refreshed++;
    } catch (error) {
      logger.warn(`${SERIES_LOG}:stale_refresh_failed`, { series_id: seriesRecord.id, error });
    }
  }

  if (refreshed > 0) {
    logger.info(`${SERIES_LOG}:stale_refresh`, { refreshed });
  }

  return { refreshed };
}

export async function refreshSeriesFromLibrary(bookId: string): Promise<{ series_id: string; entries: number }> {
  const book = await db.oneOrNone<Book>('SELECT * FROM books WHERE id = $1', [bookId]);
  if (!book) {
    throw new Error('Book not found');
  }

  const series = book.series_id
    ? await db.oneOrNone<Series>('SELECT * FROM series WHERE id = $1', [book.series_id])
    : null;

  let seriesRecord = await ensureSeriesRecord(book, series);
  if (!seriesRecord) {
    const providerResult = await fetchProviderSeries(book);
    if (providerResult) {
      seriesRecord = await createSeriesFromProvider(providerResult);

      const entries: SeriesEntry[] = providerResult.entries.map((entry) => ({
        id: '',
        series_id: seriesRecord!.id,
        provider_work_id: entry.provider_work_id,
        title: entry.title,
        series_index: entry.series_index,
        isbn13: entry.isbn13,
        isbn10: entry.isbn10,
        cover_url: entry.cover_url,
        published_date: entry.published_date ? new Date(entry.published_date) : null,
        authors: entry.authors || null,
        created_at: new Date(),
        updated_at: new Date(),
      }));

      await upsertSeriesEntries(seriesRecord.id, entries);
    }
  }

  if (!seriesRecord) {
    throw new Error('Series not found');
  }

  const booksInSeries = await db.manyOrNone<Book>(
    `SELECT *
     FROM books
     WHERE series_id = $1
        OR series_key = $2
        OR series_name = $3`,
    [seriesRecord.id, seriesRecord.series_key, seriesRecord.name]
  );

  let inserted = 0;
  for (const entry of booksInSeries) {
    const providerWorkId = `internal:${entry.id}`;
    const result = await db.result(
      `INSERT INTO series_entries
       (series_id, provider_work_id, title, series_index, isbn13, isbn10, cover_url, published_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (series_id, provider_work_id)
       DO NOTHING`,
      [
        seriesRecord.id,
        providerWorkId,
        entry.title,
        entry.series_index,
        entry.isbn_13,
        entry.isbn_10,
        null,
        entry.published_date,
      ]
    );
    inserted += result.rowCount || 0;
  }

  await db.none(
    `UPDATE series
     SET work_count = $1, last_fetched_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [booksInSeries.length, seriesRecord.id]
  );

  logger.info(`${SERIES_LOG}:refresh`, {
    series_id: seriesRecord.id,
    inserted,
    source: 'internal',
  });

  return { series_id: seriesRecord.id, entries: booksInSeries.length };
}

export async function refreshSeriesCatalog(bookId: string, source: 'internal' | 'external' = 'external') {
  const book = await db.oneOrNone<Book>('SELECT * FROM books WHERE id = $1', [bookId]);
  if (!book) {
    throw new Error('Book not found');
  }

  const series = book.series_id
    ? await db.oneOrNone<Series>('SELECT * FROM series WHERE id = $1', [book.series_id])
    : null;

  let seriesRecord = await ensureSeriesRecord(book, series);
  if (!seriesRecord && source === 'external') {
    const providerResult = await fetchProviderSeries(book);
    if (providerResult) {
      seriesRecord = await createSeriesFromProvider(providerResult);

      const entries: SeriesEntry[] = providerResult.entries.map((entry) => ({
        id: '',
        series_id: seriesRecord!.id,
        provider_work_id: entry.provider_work_id,
        title: entry.title,
        series_index: entry.series_index,
        isbn13: entry.isbn13,
        isbn10: entry.isbn10,
        cover_url: entry.cover_url,
        published_date: entry.published_date ? new Date(entry.published_date) : null,
        authors: entry.authors || null,
        created_at: new Date(),
        updated_at: new Date(),
      }));

      await upsertSeriesEntries(seriesRecord.id, entries);
    }
  }

  if (!seriesRecord) {
    throw new Error('Series not found');
  }

  if (source === 'internal') {
    return refreshSeriesFromLibrary(bookId);
  }

  await refreshSeriesFromProviders(book, seriesRecord);
  return { series_id: seriesRecord.id };
}
