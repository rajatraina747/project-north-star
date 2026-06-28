import { describe, it, expect } from 'vitest';
import {
  DEFAULT_READER_SETTINGS,
  loadReaderSettings,
  saveReaderSettings,
} from './readerSettings';

describe('readerSettings', () => {
  it('returns defaults when nothing is persisted', () => {
    expect(loadReaderSettings()).toEqual(DEFAULT_READER_SETTINGS);
  });

  it('round-trips saved settings', () => {
    const next = { ...DEFAULT_READER_SETTINGS, fontSize: 140, theme: 'night' as const };
    saveReaderSettings(next);
    expect(loadReaderSettings()).toEqual(next);
  });

  it('merges partial stored settings over defaults (forward-compatible)', () => {
    window.localStorage.setItem('reader:settings:v1', JSON.stringify({ fontSize: 120 }));
    const loaded = loadReaderSettings();
    expect(loaded.fontSize).toBe(120);
    expect(loaded.fontFamily).toBe(DEFAULT_READER_SETTINGS.fontFamily);
  });

  it('falls back to defaults on corrupt JSON', () => {
    window.localStorage.setItem('reader:settings:v1', '{not json');
    expect(loadReaderSettings()).toEqual(DEFAULT_READER_SETTINGS);
  });
});
