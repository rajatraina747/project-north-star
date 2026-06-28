import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { unzipSync } from 'fflate';
import { progress as progressApi } from '../lib/api';
import { getToken } from '../lib/auth';

interface ComicReaderProps {
  bookId: string;
  fileId: string;
  fileUrl: string;
  title: string;
}

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
};

type Fit = 'width' | 'height';
type Mode = 'single' | 'double' | 'continuous';
type Dir = 'ltr' | 'rtl';

// How many upcoming pages to decode ahead so turns don't flash.
const PREFETCH_AHEAD = 3;

function persisted<T extends string>(key: string, fallback: T): T {
  return (localStorage.getItem(key) as T) || fallback;
}

/**
 * Image-based reader for CBZ comics. A CBZ is a ZIP of page images: we download
 * the file, unzip it client-side (fflate), and page through the images. Supports
 * single page, double-page spreads, and continuous (webtoon) scrolling, plus
 * left-to-right or right-to-left (manga) reading direction. Progress is tracked
 * by page in the shared reading_progress row (pdf_page + progress_percent).
 */
export default function ComicReader({ bookId, fileId, fileUrl, title }: ComicReaderProps) {
  const navigate = useNavigate();
  const [pages, setPages] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState<Fit>(() => persisted<Fit>('comic-fit', 'height'));
  const [mode, setMode] = useState<Mode>(() => persisted<Mode>('comic-mode', 'single'));
  const [dir, setDir] = useState<Dir>(() => persisted<Dir>('comic-dir', 'ltr'));
  const objectUrls = useRef<string[]>([]);
  const initialPageRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load + unzip the CBZ, and fetch any saved page so we can resume.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Resume position (best-effort).
        try {
          const p = await progressApi.get(bookId, fileId);
          if (p.data?.pdf_page && p.data.pdf_page > 0) initialPageRef.current = p.data.pdf_page - 1;
        } catch { /* no saved progress */ }

        const token = getToken();
        const res = await fetch(fileUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) throw new Error(`Failed to load comic (${res.status})`);
        const buf = new Uint8Array(await res.arrayBuffer());
        if (cancelled) return;

        const entries = unzipSync(buf, {
          filter: (file) => IMAGE_RE.test(file.name) && !file.name.startsWith('__MACOSX'),
        });

        const names = Object.keys(entries).sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
        );
        if (names.length === 0) throw new Error('No images found in this comic archive');

        const urls = names.map((name) => {
          const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
          const blob = new Blob([entries[name]], { type: MIME_BY_EXT[ext] || 'image/jpeg' });
          return URL.createObjectURL(blob);
        });
        objectUrls.current = urls;

        if (cancelled) {
          urls.forEach((u) => URL.revokeObjectURL(u));
          return;
        }
        setPages(urls);
        setIndex(Math.min(initialPageRef.current, urls.length - 1));
        setLoading(false);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to open comic');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
      objectUrls.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, fileId, fileUrl]);

  // Debounced progress save on page change.
  useEffect(() => {
    if (loading || pages.length === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const percent = Math.round(((index + 1) / pages.length) * 100);
      progressApi
        .update(bookId, fileId, { progress_percent: percent, pdf_page: index + 1 })
        .catch(() => undefined);
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [index, pages.length, loading, bookId, fileId]);

  // Decode upcoming pages ahead of time so turns are instant.
  useEffect(() => {
    if (pages.length === 0) return;
    for (let i = 1; i <= PREFETCH_AHEAD; i++) {
      const url = pages[index + i];
      if (url) { const img = new Image(); img.src = url; }
    }
  }, [index, pages]);

  const step = mode === 'double' ? 2 : 1;

  // Semantic navigation (independent of reading direction).
  const goNext = useCallback(
    () => setIndex((i) => Math.min(pages.length - 1, i + step)),
    [pages.length, step]
  );
  const goPrev = useCallback(
    () => setIndex((i) => Math.max(0, i - step)),
    [step]
  );

  // Keyboard: arrows respect reading direction; space/PageDown always advance.
  useEffect(() => {
    if (mode === 'continuous') {
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') navigate(-1); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    const onKey = (e: KeyboardEvent) => {
      const forwardKeys = dir === 'rtl' ? ['ArrowLeft'] : ['ArrowRight'];
      const backKeys = dir === 'rtl' ? ['ArrowRight'] : ['ArrowLeft'];
      if (forwardKeys.includes(e.key) || e.key === 'ArrowDown' || e.key === ' ') { goNext(); e.preventDefault(); }
      else if (backKeys.includes(e.key) || e.key === 'ArrowUp') { goPrev(); e.preventDefault(); }
      else if (e.key === 'Escape') navigate(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, navigate, dir, mode]);

  // Entering continuous mode: jump to the current page so resume/position holds.
  useEffect(() => {
    if (mode !== 'continuous' || loading) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (el) el.scrollIntoView({ block: 'start' });
    // Run only when entering continuous mode, not on every page change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, loading]);

  // Continuous mode: track the most-visible page to keep progress in sync.
  useEffect(() => {
    if (mode !== 'continuous' || loading || pages.length === 0) return;
    const root = scrollRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            const i = Number((entry.target as HTMLElement).dataset.index);
            if (Number.isFinite(i)) setIndex(i);
          }
        }
      },
      { root, threshold: [0.5] }
    );
    root.querySelectorAll('[data-index]').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [mode, loading, pages.length]);

  const cyclePref = <T extends string>(
    value: T, order: readonly T[], setter: (v: T) => void, key: string
  ) => {
    const next = order[(order.indexOf(value) + 1) % order.length];
    localStorage.setItem(key, next);
    setter(next);
  };

  const toggleFit = () => cyclePref(fit, ['height', 'width'] as const, setFit, 'comic-fit');
  const cycleMode = () => {
    const order = ['single', 'double', 'continuous'] as const;
    const next = order[(order.indexOf(mode) + 1) % order.length];
    // Snap to an even page when entering double-page mode so spreads stay aligned.
    if (next === 'double') setIndex((i) => i - (i % 2));
    localStorage.setItem('comic-mode', next);
    setMode(next);
  };
  const toggleDir = () => cyclePref(dir, ['ltr', 'rtl'] as const, setDir, 'comic-dir');

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-ink-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ember-500 mx-auto mb-4" />
          <p className="text-cream/70">Opening comic…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-ink-900">
        <div className="text-center max-w-md px-6">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={() => navigate(-1)} className="px-5 py-2 bg-ember-500 text-cream rounded-lg hover:bg-ember-600">
            Go back
          </button>
        </div>
      </div>
    );
  }

  const modeLabel = mode === 'single' ? 'Single' : mode === 'double' ? 'Double' : 'Scroll';
  const secondIndex = index + 1 < pages.length ? index + 1 : null;

  return (
    <div className="h-screen flex flex-col bg-ink-900">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-ink-900/95 border-b border-ink-700 text-cream">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-ink-700 rounded-lg" aria-label="Back">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <p className="text-sm font-medium truncate px-3">{title}</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-cream/60 tabular-nums">{index + 1} / {pages.length}</span>
          <button onClick={cycleMode} className="px-2.5 py-1 text-xs bg-ink-700 hover:bg-ink-600 rounded-lg" title="Layout (single / double / scroll)">
            {modeLabel}
          </button>
          <button onClick={toggleDir} className="px-2.5 py-1 text-xs bg-ink-700 hover:bg-ink-600 rounded-lg" title="Reading direction">
            {dir === 'rtl' ? 'RTL' : 'LTR'}
          </button>
          {mode !== 'continuous' && (
            <button onClick={toggleFit} className="px-2.5 py-1 text-xs bg-ink-700 hover:bg-ink-600 rounded-lg" title="Toggle fit">
              Fit {fit === 'width' ? 'Width' : 'Height'}
            </button>
          )}
        </div>
      </div>

      {/* Page viewport */}
      {mode === 'continuous' ? (
        <div ref={scrollRef} className="flex-1 overflow-auto flex flex-col items-center gap-2 py-2">
          {pages.map((src, i) => (
            <img
              key={src}
              data-index={i}
              src={src}
              loading="lazy"
              alt={`Page ${i + 1}`}
              className="w-full max-w-[900px]"
            />
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-auto flex items-start justify-center relative">
          {/* Click zones: forward/back swap with reading direction. */}
          <button
            className="absolute left-0 top-0 h-full w-1/3 z-10"
            style={{ cursor: dir === 'rtl' ? 'e-resize' : 'w-resize' }}
            onClick={dir === 'rtl' ? goNext : goPrev}
            aria-label={dir === 'rtl' ? 'Next page' : 'Previous page'}
          />
          <button
            className="absolute right-0 top-0 h-full w-1/3 z-10"
            style={{ cursor: dir === 'rtl' ? 'w-resize' : 'e-resize' }}
            onClick={dir === 'rtl' ? goPrev : goNext}
            aria-label={dir === 'rtl' ? 'Previous page' : 'Next page'}
          />

          {mode === 'double' && secondIndex !== null ? (
            <div className={`flex h-full ${dir === 'rtl' ? 'flex-row-reverse' : 'flex-row'} items-start justify-center`}>
              <img src={pages[index]} alt={`Page ${index + 1}`} className="h-full max-h-[calc(100vh-3rem)] w-auto object-contain" />
              <img src={pages[secondIndex]} alt={`Page ${secondIndex + 1}`} className="h-full max-h-[calc(100vh-3rem)] w-auto object-contain" />
            </div>
          ) : (
            <img
              src={pages[index]}
              alt={`Page ${index + 1}`}
              className={fit === 'width' ? 'w-full max-w-none' : 'h-full max-h-[calc(100vh-3rem)] w-auto mx-auto'}
              style={fit === 'width' ? {} : { objectFit: 'contain' }}
            />
          )}
        </div>
      )}
    </div>
  );
}
