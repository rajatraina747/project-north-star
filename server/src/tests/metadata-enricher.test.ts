import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtractedMetadata } from '../types';

// ---------------------------------------------------------------------------
// Mocks. The enricher's whole job is "call external APIs, fall back gracefully,
// merge without clobbering". We mock axios to drive each branch and assert on
// the fallback order, the SSRF cover-host guard, and the non-destructive merge.
// ---------------------------------------------------------------------------

vi.mock('../utils/config', () => ({
  config: { googleBooksApiKey: '' },
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    isAxiosError: vi.fn(() => false),
  },
}));

import axios from 'axios';
import { MetadataEnricher } from '../services/metadata-enricher';

const getMock = (axios as unknown as { get: ReturnType<typeof vi.fn> }).get;

/** Convenience: a Google Books volumes API response with one item. */
function googleResponse(volumeInfo: Record<string, unknown>) {
  return { data: { totalItems: 1, items: [{ volumeInfo }] } };
}

/** Convenience: an Open Library search.json response with one doc. */
function openLibrarySearchResponse(doc: Record<string, unknown>) {
  return { data: { docs: [doc] } };
}

function urlOf(call: unknown[]): string {
  return typeof call[0] === 'string' ? call[0] : '';
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MetadataEnricher.enrich', () => {
  it('uses Google Books and skips Open Library when both description and cover are found', async () => {
    getMock.mockImplementation(async (url: string, opts?: { responseType?: string }) => {
      if (url.includes('googleapis.com')) {
        return googleResponse({
          title: 'Google Title',
          authors: ['G Author'],
          description: 'From Google',
          imageLinks: { thumbnail: 'http://books.google.com/cover.jpg' },
        });
      }
      if (opts?.responseType === 'arraybuffer') {
        return { data: Buffer.from('img') };
      }
      throw new Error(`unexpected url ${url}`);
    });

    // Base title 'q' is kept (non-destructive merge); empty fields get filled.
    const result = await new MetadataEnricher().enrich({ title: 'q' });

    expect(result.title).toBe('q');
    expect(result.authors).toEqual(['G Author']);
    expect(result.description).toBe('From Google');
    expect(Buffer.isBuffer(result.coverImage)).toBe(true);
    // Open Library must not be queried once Google satisfied both gaps.
    expect(getMock.mock.calls.some((c) => urlOf(c).includes('openlibrary.org'))).toBe(false);
  });

  it('falls back to Open Library when Google Books returns no items', async () => {
    getMock.mockImplementation(async (url: string, opts?: { responseType?: string }) => {
      if (url.includes('googleapis.com')) {
        return { data: { totalItems: 0, items: [] } };
      }
      if (url.includes('openlibrary.org/search.json')) {
        return openLibrarySearchResponse({
          title: 'OL Title',
          author_name: ['OL Author'],
          cover_i: 42,
        });
      }
      if (opts?.responseType === 'arraybuffer') {
        return { data: Buffer.from('ol-img') };
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await new MetadataEnricher().enrich({ title: 'q' });

    expect(result.title).toBe('q'); // base kept
    expect(result.authors).toEqual(['OL Author']); // filled from Open Library
    expect(Buffer.isBuffer(result.coverImage)).toBe(true);
    expect(getMock.mock.calls.some((c) => urlOf(c).includes('openlibrary.org'))).toBe(true);
  });

  it('returns the original metadata unchanged when every provider throws', async () => {
    getMock.mockRejectedValue(new Error('network down'));

    const input: ExtractedMetadata = { title: 'Untouched', authors: ['Me'] };
    const result = await new MetadataEnricher().enrich(input);

    expect(result).toEqual(input);
  });

  it('does not overwrite existing base fields (non-destructive merge)', async () => {
    getMock.mockImplementation(async (url: string, opts?: { responseType?: string }) => {
      if (url.includes('googleapis.com')) {
        return googleResponse({
          title: 'Google Title',
          description: 'Google Desc',
          imageLinks: { thumbnail: 'http://books.google.com/cover.jpg' },
        });
      }
      if (opts?.responseType === 'arraybuffer') return { data: Buffer.from('img') };
      throw new Error(`unexpected url ${url}`);
    });

    // Base already complete (incl. a cover) so Open Library is skipped and the
    // merge should keep every base value.
    const input: ExtractedMetadata = {
      title: 'My Title',
      description: 'My Desc',
      coverImage: Buffer.from('mine'),
    };
    const result = await new MetadataEnricher().enrich(input);

    expect(result.title).toBe('My Title');
    expect(result.description).toBe('My Desc');
    expect(result.coverImage?.toString()).toBe('mine');
  });

  it('refuses to download a cover from a disallowed host (SSRF guard)', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url.includes('googleapis.com')) {
        return googleResponse({
          title: 'Google Title',
          description: 'Google Desc',
          imageLinks: { thumbnail: 'http://evil.example.com/cover.jpg' },
        });
      }
      if (url.includes('openlibrary.org/search.json')) {
        return { data: { docs: [] } }; // no OL fallback cover either
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await new MetadataEnricher().enrich({ title: 'q' });

    expect(result.coverImage).toBeUndefined();
    // The evil host must never be fetched.
    expect(getMock.mock.calls.some((c) => urlOf(c).includes('evil.example.com'))).toBe(false);
  });
});
