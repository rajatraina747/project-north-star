import axios from 'axios';
import { logger } from '../utils/logger';

export interface ProviderSeriesEntry {
  provider_work_id: string;
  title: string;
  series_index: number | null;
  isbn13: string | null;
  isbn10: string | null;
  cover_url: string | null;
  published_date: string | null;
  authors: Array<{ name: string }> | null;
}

export interface ProviderSeriesResult {
  series_name: string;
  provider: 'google' | 'openlibrary' | 'hybrid';
  provider_series_id: string | null;
  entries: ProviderSeriesEntry[];
  confidence: number;
  notes?: string;
}

function extractIsbn(volumeInfo: any): { isbn13: string | null; isbn10: string | null } {
  const identifiers = volumeInfo?.industryIdentifiers || [];
  const isbn13 = identifiers.find((id: any) => id.type === 'ISBN_13')?.identifier || null;
  const isbn10 = identifiers.find((id: any) => id.type === 'ISBN_10')?.identifier || null;
  return { isbn13, isbn10 };
}

function parseSeriesPattern(text: string): { seriesName: string; position: number | null } | null {
  const parenMatch = text.match(/\(([^,]+),\s*(Book|Volume)\s*([0-9]+)\)/i);
  if (parenMatch) {
    return { seriesName: parenMatch[1].trim(), position: parseInt(parenMatch[3], 10) };
  }

  const hashMatch = text.match(/(.+?)\s*#\s*([0-9]+)\b/i);
  if (hashMatch) {
    return { seriesName: hashMatch[1].trim(), position: parseInt(hashMatch[2], 10) };
  }

  const bookMatch = text.match(/(.+?)\s*(Book|Volume)\s*([0-9]+)\b/i);
  if (bookMatch) {
    return { seriesName: bookMatch[1].trim(), position: parseInt(bookMatch[3], 10) };
  }

  return null;
}

function normalizeSeriesName(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function pickCoverUrl(volumeInfo: any): string | null {
  return volumeInfo?.imageLinks?.thumbnail || volumeInfo?.imageLinks?.smallThumbnail || null;
}

export async function fetchGoogleSeriesByIsbn(isbn: string, apiKey?: string): Promise<ProviderSeriesResult | null> {
  try {
    const params: Record<string, string> = { q: `isbn:${isbn}` };
    if (apiKey) {
      params.key = apiKey;
    }

    const response = await axios.get('https://www.googleapis.com/books/v1/volumes', { params });
    const item = response.data?.items?.[0];
    if (!item) {
      return null;
    }

    const volumeInfo = item.volumeInfo || {};
    const title = volumeInfo.title || '';
    const subtitle = volumeInfo.subtitle || '';
    const description = volumeInfo.description || '';

    let seriesHint =
      parseSeriesPattern(title) ||
      parseSeriesPattern(subtitle) ||
      parseSeriesPattern(description);

    if (!seriesHint && subtitle) {
      const subtitleLooksLikeSeries = /series|book|volume|#/i.test(subtitle) && !/^\(.*\)$/.test(subtitle);
      if (subtitleLooksLikeSeries) {
        const positionHint = parseSeriesPattern(description) || parseSeriesPattern(title);
        seriesHint = { seriesName: subtitle, position: positionHint?.position ?? null };
      }
    }

    if (!seriesHint && title.includes(':')) {
      const [seriesCandidate] = title.split(':');
      const positionHint = parseSeriesPattern(description) || parseSeriesPattern(subtitle);
      seriesHint = { seriesName: seriesCandidate.trim(), position: positionHint?.position ?? null };
    }

    if (!seriesHint) {
      return null;
    }

    const seriesName = normalizeSeriesName(seriesHint.seriesName);
    const author = volumeInfo.authors?.[0] || '';
    const searchQuery = `intitle:"${seriesName}"${author ? `+inauthor:"${author}"` : ''}`;

    const searchResponse = await axios.get('https://www.googleapis.com/books/v1/volumes', {
      params: apiKey ? { q: searchQuery, key: apiKey } : { q: searchQuery },
    });

    const entries: ProviderSeriesEntry[] = (searchResponse.data?.items || []).map((entry: any) => {
      const entryInfo = entry.volumeInfo || {};
      const match = parseSeriesPattern(entryInfo.title || '') || parseSeriesPattern(entryInfo.subtitle || '') || null;
      const { isbn13, isbn10 } = extractIsbn(entryInfo);
      return {
        provider_work_id: entry.id,
        title: entryInfo.title || 'Untitled',
        series_index: match?.position ?? null,
        isbn13,
        isbn10,
        cover_url: pickCoverUrl(entryInfo),
        published_date: entryInfo.publishedDate || null,
        authors: entryInfo.authors?.length ? entryInfo.authors.map((name: string) => ({ name })) : null,
      };
    });

    const sorted = entries.sort((a, b) => {
      if (a.series_index == null && b.series_index != null) return 1;
      if (a.series_index != null && b.series_index == null) return -1;
      if (a.series_index != null && b.series_index != null) return a.series_index - b.series_index;
      return a.title.localeCompare(b.title);
    });

    return {
      series_name: seriesName,
      provider: 'google',
      provider_series_id: null,
      entries: sorted,
      confidence: 0.5,
      notes: 'series inferred from title/subtitle/description',
    };
  } catch (error) {
    logger.warn('series:google_failed', { error });
    return null;
  }
}

export async function fetchOpenLibrarySeriesByIsbn(isbn: string): Promise<ProviderSeriesResult | null> {
  try {
    const bibKey = `ISBN:${isbn}`;
    const response = await axios.get('https://openlibrary.org/api/books', {
      params: { bibkeys: bibKey, format: 'json', jscmd: 'data' },
    });

    const bookData = response.data?.[bibKey];
    if (!bookData) {
      return null;
    }

    const series = bookData.series?.[0];
    const seriesName = series?.name || series;
    if (!seriesName) {
      return null;
    }

    const author = bookData.authors?.[0]?.name || '';
    const searchResponse = await axios.get('https://openlibrary.org/search.json', {
      params: { title: seriesName, author },
    });

    const docs = searchResponse.data?.docs || [];
    const entries: ProviderSeriesEntry[] = docs.map((doc: any) => {
      const seriesIndex = doc.series_position ? parseFloat(doc.series_position) : null;
      const isbn13 = doc.isbn?.find((code: string) => code.length === 13) || null;
      const isbn10 = doc.isbn?.find((code: string) => code.length === 10) || null;
      return {
        provider_work_id: doc.key,
        title: doc.title || 'Untitled',
        series_index: Number.isFinite(seriesIndex as number) ? seriesIndex : null,
        isbn13,
        isbn10,
        cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
        published_date: doc.first_publish_year ? `${doc.first_publish_year}-01-01` : null,
        authors: doc.author_name?.length ? doc.author_name.map((name: string) => ({ name })) : null,
      };
    });

    const sorted = entries.sort((a, b) => {
      if (a.series_index == null && b.series_index != null) return 1;
      if (a.series_index != null && b.series_index == null) return -1;
      if (a.series_index != null && b.series_index != null) return a.series_index - b.series_index;
      return a.title.localeCompare(b.title);
    });

    return {
      series_name: normalizeSeriesName(seriesName),
      provider: 'openlibrary',
      provider_series_id: null,
      entries: sorted,
      confidence: 0.4,
      notes: 'series inferred from Open Library search',
    };
  } catch (error) {
    logger.warn('series:openlibrary_failed', { error });
    return null;
  }
}
