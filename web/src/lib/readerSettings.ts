import { useCallback, useEffect, useState } from 'react';

// Typography / display preferences for the reader. Persisted to localStorage so
// they apply across books and sessions. The per-reader theme is intentionally
// independent of the app-wide light/dark theme (theme.ts) — a reader may want a
// sepia page while the rest of the app is dark, or vice versa.

export type ReaderFontFamily = 'serif' | 'sans' | 'dyslexic';
export type ReaderTheme = 'light' | 'sepia' | 'night';

export interface ReaderSettings {
  fontFamily: ReaderFontFamily;
  fontSize: number; // percentage, 80–200
  lineHeight: number; // unitless multiplier, 1.2–2.2
  margin: number; // horizontal page margin in px applied each side, 0–160
  justify: boolean;
  theme: ReaderTheme;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontFamily: 'serif',
  fontSize: 100,
  lineHeight: 1.6,
  margin: 24,
  justify: false,
  theme: 'light',
};

const STORAGE_KEY = 'reader:settings:v1';

// Concrete font stacks. Serif/sans use system fonts (no download, CSP-safe);
// dyslexic uses the self-hosted OpenDyslexic face declared in index.css.
export const FONT_STACKS: Record<ReaderFontFamily, string> = {
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", ui-serif, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  dyslexic: '"OpenDyslexic", Comic Sans MS, sans-serif',
};

// Page colors for each reader theme: [background, text].
export const READER_THEME_COLORS: Record<ReaderTheme, { bg: string; fg: string }> = {
  light: { bg: '#f5f0e6', fg: '#1c1917' },
  sepia: { bg: '#f4ecd8', fg: '#5b4636' },
  night: { bg: '#1a1410', fg: '#d8cbb8' },
};

const getStorage = () => (typeof window === 'undefined' ? null : window.localStorage);

export const loadReaderSettings = (): ReaderSettings => {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_READER_SETTINGS };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_READER_SETTINGS };
    return { ...DEFAULT_READER_SETTINGS, ...(JSON.parse(raw) as Partial<ReaderSettings>) };
  } catch {
    return { ...DEFAULT_READER_SETTINGS };
  }
};

export const saveReaderSettings = (settings: ReaderSettings) => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

/**
 * React hook exposing the persisted reader settings plus a partial updater.
 * Multiple reader components share the same localStorage-backed values.
 */
export function useReaderSettings(): [ReaderSettings, (patch: Partial<ReaderSettings>) => void] {
  const [settings, setSettings] = useState<ReaderSettings>(loadReaderSettings);

  useEffect(() => {
    saveReaderSettings(settings);
  }, [settings]);

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return [settings, update];
}
