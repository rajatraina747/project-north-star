import { describe, it, expect, vi } from 'vitest';
import type { Series } from '../types';

// series.ts pulls in db + providers at import time; stub them so importing the
// pure isSeriesFresh helper doesn't open real connections.
vi.mock('../db', () => ({ default: {} }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/config', () => ({ config: { seriesCacheTtlDays: 30, seriesProvider: 'google', googleBooksApiKey: '' } }));
vi.mock('../services/series-providers', () => ({
  fetchGoogleSeriesByIsbn: vi.fn(),
  fetchOpenLibrarySeriesByIsbn: vi.fn(),
}));

import { isSeriesFresh } from '../services/series';

function series(over: Partial<Series>): Series {
  return { id: 's1', name: 'X', ttl_days: null, last_fetched_at: null, ...over } as Series;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe('isSeriesFresh', () => {
  it('is stale when never fetched', () => {
    expect(isSeriesFresh(series({ last_fetched_at: null }))).toBe(false);
  });

  it('is fresh within the default TTL', () => {
    expect(isSeriesFresh(series({ last_fetched_at: daysAgo(5) }))).toBe(true);
  });

  it('is stale beyond the default TTL', () => {
    expect(isSeriesFresh(series({ last_fetched_at: daysAgo(31) }))).toBe(false);
  });

  it('honors a per-series ttl_days override', () => {
    expect(isSeriesFresh(series({ ttl_days: 3, last_fetched_at: daysAgo(5) }))).toBe(false);
    expect(isSeriesFresh(series({ ttl_days: 90, last_fetched_at: daysAgo(40) }))).toBe(true);
  });
});
