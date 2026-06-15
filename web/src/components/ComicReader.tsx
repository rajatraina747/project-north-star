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

/**
 * Image-based reader for CBZ comics. A CBZ is just a ZIP of page images, so we
 * download the file, unzip it client-side (fflate), and page through the images.
 * Progress is tracked by page using the same reading_progress row as the other
 * readers (pdf_page + progress_percent).
 */
export default function ComicReader({ bookId, fileId, fileUrl, title }: ComicReaderProps) {
  const navigate = useNavigate();
  const [pages, setPages] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState<Fit>(() => (localStorage.getItem('comic-fit') as Fit) || 'height');
  const objectUrls = useRef<string[]>([]);
  const initialPageRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || 'Failed to open comic');
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

  const go = useCallback(
    (delta: number) => setIndex((i) => Math.max(0, Math.min(pages.length - 1, i + delta))),
    [pages.length]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { go(1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { go(-1); e.preventDefault(); }
      else if (e.key === 'Escape') navigate(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, navigate]);

  const toggleFit = () => {
    setFit((f) => {
      const next = f === 'width' ? 'height' : 'width';
      localStorage.setItem('comic-fit', next);
      return next;
    });
  };

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
        <div className="flex items-center gap-3">
          <span className="text-xs text-cream/60 tabular-nums">{index + 1} / {pages.length}</span>
          <button onClick={toggleFit} className="px-2.5 py-1 text-xs bg-ink-700 hover:bg-ink-600 rounded-lg" title="Toggle fit">
            Fit {fit === 'width' ? 'Width' : 'Height'}
          </button>
        </div>
      </div>

      {/* Page viewport */}
      <div className="flex-1 overflow-auto flex items-start justify-center relative">
        {/* Click zones for prev/next */}
        <button
          className="absolute left-0 top-0 h-full w-1/3 cursor-w-resize z-10"
          onClick={() => go(-1)}
          aria-label="Previous page"
        />
        <button
          className="absolute right-0 top-0 h-full w-1/3 cursor-e-resize z-10"
          onClick={() => go(1)}
          aria-label="Next page"
        />
        <img
          src={pages[index]}
          alt={`Page ${index + 1}`}
          className={fit === 'width' ? 'w-full max-w-none' : 'h-full max-h-[calc(100vh-3rem)] w-auto mx-auto'}
          style={fit === 'width' ? {} : { objectFit: 'contain' }}
        />
      </div>
    </div>
  );
}
