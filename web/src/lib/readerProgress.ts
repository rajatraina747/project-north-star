export type ReaderFormat = 'EPUB' | 'PDF';

export interface LocalReadingProgress {
  bookId: string;
  format: ReaderFormat;
  percent: number;
  updatedAt: string;
  cfi?: string | null;
  chapter?: string | null;
  page?: number | null;
}

const STORAGE_KEY = 'reader:progress:v1';

const getStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

const makeKey = (bookId: string, format: ReaderFormat) => `${bookId}:${format}`;

const loadAll = (): Record<string, LocalReadingProgress> => {
  const storage = getStorage();
  if (!storage) return {};
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, LocalReadingProgress>;
  } catch {
    return {};
  }
};

const saveAll = (entries: Record<string, LocalReadingProgress>) => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(entries));
};

export const getLocalProgress = (bookId: string, format: ReaderFormat) => {
  const entries = loadAll();
  return entries[makeKey(bookId, format)] ?? null;
};

export const setLocalProgress = (progress: LocalReadingProgress) => {
  const entries = loadAll();
  entries[makeKey(progress.bookId, progress.format)] = progress;
  saveAll(entries);
  if (import.meta.env.DEV) {
    console.debug('[reader] local progress saved', {
      key: makeKey(progress.bookId, progress.format),
      percent: progress.percent,
      updatedAt: progress.updatedAt,
      locator: progress.cfi || progress.page || null,
    });
  }
};

export const getAllLocalProgress = () => {
  const entries = loadAll();
  return Object.values(entries).sort((a, b) => {
    const aTime = Date.parse(a.updatedAt) || 0;
    const bTime = Date.parse(b.updatedAt) || 0;
    return bTime - aTime;
  });
};

export const pickLatestProgress = (
  local: LocalReadingProgress | null,
  serverUpdatedAt?: string | null
) => {
  if (!local && !serverUpdatedAt) return 'none';
  if (local && !serverUpdatedAt) return 'local';
  if (!local && serverUpdatedAt) return 'server';
  const localTime = Date.parse(local!.updatedAt) || 0;
  const serverTime = serverUpdatedAt ? Date.parse(serverUpdatedAt) || 0 : 0;
  return localTime >= serverTime ? 'local' : 'server';
};
