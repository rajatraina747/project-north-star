import { describe, it, expect } from 'vitest';
import {
  getLocalProgress,
  setLocalProgress,
  getAllLocalProgress,
  pickLatestProgress,
  type LocalReadingProgress,
} from './readerProgress';

const make = (over: Partial<LocalReadingProgress> = {}): LocalReadingProgress => ({
  bookId: 'book-1',
  format: 'EPUB',
  percent: 42,
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

describe('readerProgress', () => {
  it('returns null when nothing is stored', () => {
    expect(getLocalProgress('book-1', 'EPUB')).toBeNull();
  });

  it('round-trips a saved entry by book + format key', () => {
    const entry = make({ cfi: 'epubcfi(/6/4)' });
    setLocalProgress(entry);
    expect(getLocalProgress('book-1', 'EPUB')).toEqual(entry);
    // A different format is a distinct key, so it stays empty.
    expect(getLocalProgress('book-1', 'PDF')).toBeNull();
  });

  it('overwrites the entry for the same key on re-save', () => {
    setLocalProgress(make({ percent: 10 }));
    setLocalProgress(make({ percent: 90 }));
    expect(getLocalProgress('book-1', 'EPUB')?.percent).toBe(90);
  });

  it('lists all entries sorted by most-recently updated', () => {
    setLocalProgress(make({ bookId: 'older', updatedAt: '2026-01-01T00:00:00.000Z' }));
    setLocalProgress(make({ bookId: 'newer', updatedAt: '2026-06-01T00:00:00.000Z' }));
    const all = getAllLocalProgress();
    expect(all.map((p) => p.bookId)).toEqual(['newer', 'older']);
  });

  describe('pickLatestProgress', () => {
    it('reports none/local/server when only one side exists', () => {
      expect(pickLatestProgress(null, null)).toBe('none');
      expect(pickLatestProgress(make(), null)).toBe('local');
      expect(pickLatestProgress(null, '2026-06-01T00:00:00.000Z')).toBe('server');
    });

    it('prefers the newer timestamp, with ties going to local', () => {
      const local = make({ updatedAt: '2026-06-02T00:00:00.000Z' });
      expect(pickLatestProgress(local, '2026-06-01T00:00:00.000Z')).toBe('local');
      expect(pickLatestProgress(local, '2026-06-03T00:00:00.000Z')).toBe('server');
      expect(pickLatestProgress(local, '2026-06-02T00:00:00.000Z')).toBe('local');
    });
  });
});
