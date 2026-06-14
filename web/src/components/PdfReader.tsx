import { useEffect, useRef, useState, useCallback } from 'react';
import type { RefObject, MutableRefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as pdfjsLib from 'pdfjs-dist';
// Bundle the worker locally (self-hosted) rather than loading it from a CDN, so
// the reader works offline / on isolated networks and complies with the CSP.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { progress as progressApi, bookmarks as bookmarksApi } from '../lib/api';
import { getToken } from '../lib/auth';
import {
  getLocalProgress,
  pickLatestProgress,
  setLocalProgress,
  type ReaderFormat,
} from '../lib/readerProgress';
import ReaderShell, { type TocItem, type BookmarkItem, type ReaderSearchResult } from './ReaderShell';
import ReaderSettingsPanel from './ReaderSettingsPanel';
import { useReaderSettings, READER_THEME_COLORS } from '../lib/readerSettings';
import { useReadingHeartbeat } from '../lib/readingHeartbeat';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const BASE_SCALE = 1.4;

interface PdfReaderProps {
  bookId: string;
  fileId: string;
  fileUrl: string;
  title: string;
}

type ViewMode = 'paged' | 'scroll';

// Recursively convert pdf.js outline items to TocItems.
function convertOutline(items: any[]): TocItem[] {
  return items.map((item) => ({
    label: item.title || 'Untitled',
    href: JSON.stringify(item.dest),
    subitems: item.items?.length ? convertOutline(item.items) : undefined,
  }));
}

/**
 * Render a single PDF page into the given canvas, plus a transparent, selectable
 * text layer overlay. Returns the rendered viewport so callers can size things.
 */
async function renderPageInto(
  pdf: any,
  pageNum: number,
  scale: number,
  canvas: HTMLCanvasElement,
  textLayerDiv: HTMLDivElement | null,
): Promise<void> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext('2d')!;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  await page.render({ canvasContext: context, viewport }).promise;

  if (textLayerDiv) {
    textLayerDiv.innerHTML = '';
    textLayerDiv.style.width = `${viewport.width}px`;
    textLayerDiv.style.height = `${viewport.height}px`;
    try {
      const textContent = await page.getTextContent();
      await (pdfjsLib as any).renderTextLayer({
        textContentSource: textContent,
        textContent,
        container: textLayerDiv,
        viewport,
        textDivs: [],
      }).promise;
    } catch {
      // Text layer is best-effort (selection/search); ignore failures.
    }
  }
}

// Add a highlight class to text-layer spans matching the query (case-insensitive).
function highlightTextLayer(div: HTMLDivElement | null, query: string) {
  if (!div || !query) return;
  const q = query.toLowerCase();
  div.querySelectorAll('span').forEach((span) => {
    if ((span.textContent || '').toLowerCase().includes(q)) {
      span.classList.add('ns-search-hit');
    } else {
      span.classList.remove('ns-search-hit');
    }
  });
}

export default function PdfReader({ bookId, fileId, fileUrl, title }: PdfReaderProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<any>(null);
  const pdfRef = useRef<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSaveAt, setLastSaveAt] = useState<string | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('paged');
  const [showThumbnails, setShowThumbnails] = useState(false);
  const lastProgressRef = useRef<{ page: number; percent: number } | null>(null);
  const totalPagesRef = useRef(0);
  const prevPageRef = useRef(0);
  const renderTaskRef = useRef(0);
  const pendingSearchHit = useRef<{ page: number; query: string } | null>(null);

  const [settings, updateSettings] = useReaderSettings();
  const scale = BASE_SCALE * (settings.fontSize / 100);
  const themeColors = READER_THEME_COLORS[settings.theme];
  const isNight = settings.theme === 'night';
  const recordPageTurn = useReadingHeartbeat(bookId, fileId);

  useEffect(() => {
    totalPagesRef.current = totalPages;
  }, [totalPages]);

  // Finished state
  const { data: progressMeta } = useQuery({
    queryKey: ['progress-meta', bookId, fileId],
    queryFn: () => progressApi.get(bookId, fileId),
  });
  const isFinished = !!progressMeta?.data?.finished;
  const finishMutation = useMutation({
    mutationFn: (finished: boolean) => progressApi.setFinished(bookId, fileId, finished),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress-meta', bookId, fileId] }),
  });

  // Bookmarks
  const { data: bookmarksData } = useQuery({
    queryKey: ['bookmarks', bookId, fileId],
    queryFn: () => bookmarksApi.list(bookId, fileId),
  });
  const bookmarks: BookmarkItem[] = (bookmarksData?.data || []).map((bm: any) => ({
    id: bm.id,
    label: bm.label,
    epub_cfi: bm.epub_cfi,
    pdf_page: bm.pdf_page,
    created_at: bm.created_at,
  }));

  const addBookmarkMutation = useMutation({
    mutationFn: (page: number) =>
      bookmarksApi.create(bookId, fileId, { pdf_page: page, label: `Page ${page}` }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookmarks', bookId, fileId] }),
  });

  const deleteBookmarkMutation = useMutation({
    mutationFn: (id: string) => bookmarksApi.delete(bookId, fileId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookmarks', bookId, fileId] }),
  });

  // Load the document
  useEffect(() => {
    const loadPdf = async () => {
      try {
        const token = getToken();
        const response = await fetch(fileUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error(`Failed to load PDF: ${response.statusText}`);

        const arrayBuffer = await (await response.blob()).arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
        const pdfDoc = await loadingTask.promise;
        setPdf(pdfDoc);
        pdfRef.current = pdfDoc;
        setTotalPages(pdfDoc.numPages);
        totalPagesRef.current = pdfDoc.numPages;

        try {
          const outline = await pdfDoc.getOutline();
          if (outline && outline.length > 0) setToc(convertOutline(outline));
        } catch { /* outline optional */ }

        try {
          const localProgress = getLocalProgress(bookId, 'PDF');
          const progressResponse = await progressApi.get(bookId, fileId);
          const decision = pickLatestProgress(localProgress, progressResponse.data?.last_read_at);
          const savedPage = decision === 'local'
            ? localProgress?.page
            : progressResponse.data?.pdf_page || localProgress?.page;
          if (savedPage && savedPage > 0 && savedPage <= pdfDoc.numPages) {
            setCurrentPage(savedPage);
            prevPageRef.current = savedPage;
          }
        } catch {
          const localProgress = getLocalProgress(bookId, 'PDF');
          if (localProgress?.page && localProgress.page > 0 && localProgress.page <= pdfDoc.numPages) {
            setCurrentPage(localProgress.page);
            prevPageRef.current = localProgress.page;
          }
        }

        setIsLoading(false);
      } catch (err: any) {
        console.error('Error loading PDF:', err);
        setError(err.message || 'Failed to load PDF');
        setIsLoading(false);
      }
    };

    loadPdf();
  }, [bookId, fileId, fileUrl]);

  // Paged-mode render: render currentPage into the single canvas + text layer.
  useEffect(() => {
    if (!pdf || viewMode !== 'paged' || !canvasRef.current) return;
    const token = ++renderTaskRef.current;
    (async () => {
      try {
        await renderPageInto(pdf, currentPage, scale, canvasRef.current!, textLayerRef.current);
        if (token !== renderTaskRef.current) return;
        // Apply a pending search highlight once the target page is rendered.
        if (pendingSearchHit.current && pendingSearchHit.current.page === currentPage) {
          highlightTextLayer(textLayerRef.current, pendingSearchHit.current.query);
          pendingSearchHit.current = null;
        }
      } catch (err) {
        console.error('Error rendering page:', err);
      }
    })();
  }, [pdf, currentPage, scale, viewMode]);

  // Persist progress + record reading activity whenever the page changes.
  useEffect(() => {
    if (!pdf || totalPages === 0) return;
    const percent = Math.round((currentPage / totalPages) * 100);
    lastProgressRef.current = { page: currentPage, percent };
    commitLocalProgress(currentPage, percent);
    saveProgress(currentPage);
    if (prevPageRef.current && prevPageRef.current !== currentPage) {
      recordPageTurn();
    }
    prevPageRef.current = currentPage;
  }, [currentPage, totalPages, pdf]);

  const commitLocalProgress = (page: number, percent: number) => {
    const updatedAt = new Date().toISOString();
    setLocalProgress({ bookId, format: 'PDF' as ReaderFormat, percent, updatedAt, page });
    setLastSaveAt(updatedAt);
  };

  const syncProgress = (page: number, percent: number) => {
    progressApi.update(bookId, fileId, { pdf_page: page, progress_percent: percent })
      .catch((err) => console.error('Failed to save progress:', err));
  };

  const saveProgress = useRef(
    debounce((page: number) => {
      const total = totalPagesRef.current;
      const percent = total > 0 ? Math.round((page / total) * 100) : 0;
      syncProgress(page, percent);
    }, 2000)
  ).current;

  useEffect(() => {
    const flushProgress = () => {
      if (!lastProgressRef.current) return;
      const { page, percent } = lastProgressRef.current;
      commitLocalProgress(page, percent);
      syncProgress(page, percent);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushProgress();
    };
    window.addEventListener('beforeunload', flushProgress);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('beforeunload', flushProgress);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [bookId, fileId]);

  // Continuous mode: report the most-visible page as the current page.
  const handleVisiblePage = useCallback((page: number) => {
    setCurrentPage((prev) => (prev === page ? prev : page));
  }, []);

  // When entering scroll mode (or jumping), scroll the target page into view.
  const scrollToPage = useCallback((page: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, []);

  useEffect(() => {
    if (viewMode === 'scroll') {
      // Defer until pages are laid out.
      const t = setTimeout(() => scrollToPage(currentPage), 50);
      return () => clearTimeout(t);
    }
  }, [viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToPage = (page: number) => {
    const clamped = Math.max(1, Math.min(totalPages || 1, page));
    setCurrentPage(clamped);
    if (viewMode === 'scroll') scrollToPage(clamped);
  };

  const goToPrevPage = () => goToPage(currentPage - 1);
  const goToNextPage = () => goToPage(currentPage + 1);
  const goToFirst = () => goToPage(1);
  const goToLast = () => goToPage(totalPages);

  const progressPercent = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;

  const handleSeek = (percent: number) => {
    if (totalPages === 0) return;
    goToPage(Math.round((percent / 100) * totalPages));
  };

  // Resolve a pdf.js outline destination to a page number.
  const resolveDestToPage = async (destJson: string): Promise<number | null> => {
    const docPdf = pdfRef.current;
    if (!docPdf) return null;
    try {
      let dest = JSON.parse(destJson);
      if (typeof dest === 'string') dest = await docPdf.getDestination(dest);
      if (!Array.isArray(dest)) return null;
      const pageIndex = await docPdf.getPageIndex(dest[0]);
      return pageIndex + 1;
    } catch {
      return null;
    }
  };

  const handleTocNavigate = async (href: string) => {
    const pageNum = await resolveDestToPage(href);
    if (pageNum !== null) goToPage(pageNum);
  };

  // In-book search across the text layer of every page.
  const handleSearch = async (query: string): Promise<ReaderSearchResult[]> => {
    const docPdf = pdfRef.current;
    if (!docPdf) return [];
    const q = query.toLowerCase();
    const results: ReaderSearchResult[] = [];
    for (let p = 1; p <= docPdf.numPages; p++) {
      try {
        const page = await docPdf.getPage(p);
        const text = (await page.getTextContent()).items.map((it: any) => it.str).join(' ');
        const lower = text.toLowerCase();
        let idx = lower.indexOf(q);
        if (idx === -1) continue;
        // One result per page, with a snippet around the first match.
        const start = Math.max(0, idx - 40);
        const excerpt = (start > 0 ? '…' : '') + text.slice(start, idx + query.length + 60).trim() + '…';
        results.push({ id: `p${p}`, location: String(p), excerpt, label: `Page ${p}` });
        if (results.length >= 300) break;
      } catch {
        // skip unreadable pages
      }
    }
    return results;
  };

  const handleJumpToSearchResult = (result: ReaderSearchResult) => {
    const page = parseInt(result.location, 10);
    if (!Number.isFinite(page)) return;
    // Derive the query from the excerpt isn't reliable; store it for highlight.
    pendingSearchHit.current = { page, query: lastSearchQuery.current };
    goToPage(page);
    if (viewMode === 'scroll') {
      setTimeout(() => scrollToPage(page), 60);
    }
  };

  // Remember the last query so jumping can highlight it.
  const lastSearchQuery = useRef('');
  const searchWrapper = async (query: string) => {
    lastSearchQuery.current = query;
    return handleSearch(query);
  };

  const handleAddBookmark = () => addBookmarkMutation.mutate(currentPage);
  const handleJumpToBookmark = (bookmark: BookmarkItem) => {
    if (bookmark.pdf_page) goToPage(bookmark.pdf_page);
  };
  const handleDeleteBookmark = (id: string) => deleteBookmarkMutation.mutate(id);

  const canvasFilter = isNight ? 'invert(1) hue-rotate(180deg)' : 'none';

  return (
    <ReaderShell
      title={title}
      subtitle={`Page ${currentPage} of ${totalPages || '–'}`}
      onBack={() => navigate(`/books/${bookId}`)}
      progressPercent={progressPercent}
      progressLabel={`${progressPercent}% read`}
      leftStatus="PDF"
      onPrev={goToPrevPage}
      onNext={goToNextPage}
      onFirst={goToFirst}
      onLast={goToLast}
      onProgressSeek={handleSeek}
      debugInfo={{ bookId, format: 'PDF', percent: progressPercent, cfi: null, lastSaveAt }}
      toc={toc}
      onTocNavigate={handleTocNavigate}
      bookmarks={bookmarks}
      onAddBookmark={handleAddBookmark}
      onJumpToBookmark={handleJumpToBookmark}
      onDeleteBookmark={handleDeleteBookmark}
      onSearch={searchWrapper}
      onJumpToSearchResult={handleJumpToSearchResult}
      isFinished={isFinished}
      onToggleFinished={() => finishMutation.mutate(!isFinished)}
      rightActions={(
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowThumbnails((v) => !v)}
            className={`p-2 rounded-lg transition-colors ${showThumbnails ? 'bg-parchment-300 text-ink-900' : 'bg-parchment-200 text-ink-500 hover:text-ink-900'}`}
            title="Page thumbnails"
            aria-label="Page thumbnails"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM13 5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-5a1 1 0 01-1-1V5zM4 14a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1v-5zM13 14a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-5a1 1 0 01-1-1v-5z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setViewMode((m) => (m === 'paged' ? 'scroll' : 'paged'))}
            className="p-2 rounded-lg bg-parchment-200 text-ink-500 hover:text-ink-900 transition-colors"
            title={viewMode === 'paged' ? 'Switch to continuous scroll' : 'Switch to single page'}
            aria-label="Toggle view mode"
          >
            {viewMode === 'paged' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5h16v14H4z" />
              </svg>
            )}
          </button>
          <ReaderSettingsPanel settings={settings} onChange={updateSettings} pdf />
        </div>
      )}
    >
      <div className="relative h-full">
        {isLoading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-parchment-50 z-10 rounded-2xl">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ember-500 mx-auto mb-3" />
              <p className="text-ink-500 text-sm">Opening PDF...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-parchment-50 z-10 rounded-2xl">
            <div className="text-center max-w-md">
              <svg className="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="text-xl font-semibold text-ink-900 mb-2">Failed to Load PDF</h3>
              <p className="text-ink-500 mb-4">{error}</p>
              <button
                onClick={() => navigate(`/books/${bookId}`)}
                className="px-6 py-2 bg-ember-500 text-cream rounded-lg hover:bg-ember-600"
              >
                Go Back
              </button>
            </div>
          </div>
        )}

        {/* Thumbnail navigator */}
        {showThumbnails && pdf && (
          <ThumbnailGrid
            pdf={pdf}
            totalPages={totalPages}
            currentPage={currentPage}
            onJump={(p) => { goToPage(p); setShowThumbnails(false); }}
            onClose={() => setShowThumbnails(false)}
          />
        )}

        <div
          className="h-full rounded-2xl shadow-[0_30px_120px_rgba(0,0,0,0.45)] overflow-hidden"
          style={{ backgroundColor: themeColors.bg }}
        >
          {viewMode === 'paged' ? (
            <div className="h-full w-full overflow-auto flex items-start justify-center" style={{ padding: `24px ${settings.margin}px` }}>
              <div className="relative" style={{ filter: canvasFilter }}>
                <canvas ref={canvasRef} />
                <div ref={textLayerRef} className="textLayer" />
              </div>
            </div>
          ) : (
            <div ref={scrollContainerRef} className="h-full w-full overflow-auto flex flex-col items-center gap-4 py-6" style={{ paddingLeft: settings.margin, paddingRight: settings.margin }}>
              {pdf && totalPages > 0 && Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <PdfPageView
                  key={p}
                  pdf={pdf}
                  pageNum={p}
                  scale={scale}
                  filter={canvasFilter}
                  onVisible={handleVisiblePage}
                  scrollRoot={scrollContainerRef}
                  searchHit={pendingSearchHit}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </ReaderShell>
  );
}

/**
 * A single page in continuous-scroll mode. Renders its canvas + text layer only
 * once scrolled near the viewport (IntersectionObserver), and reports itself as
 * the "current" page when it occupies the most of the viewport.
 */
function PdfPageView({
  pdf,
  pageNum,
  scale,
  filter,
  onVisible,
  scrollRoot,
  searchHit,
}: {
  pdf: any;
  pageNum: number;
  scale: number;
  filter: string;
  onVisible: (page: number) => void;
  scrollRoot: RefObject<HTMLDivElement>;
  searchHit: MutableRefObject<{ page: number; query: string } | null>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // Estimate page size before render so the scrollbar has a stable height.
  useEffect(() => {
    let cancelled = false;
    pdf.getPage(pageNum).then((page: any) => {
      if (cancelled) return;
      const vp = page.getViewport({ scale });
      setSize({ w: vp.width, h: vp.height });
    });
    return () => { cancelled = true; };
  }, [pdf, pageNum, scale]);

  // Render when near viewport.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const root = scrollRoot.current || undefined;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!rendered && canvasRef.current) {
              setRendered(true);
              renderPageInto(pdf, pageNum, scale, canvasRef.current, textLayerRef.current)
                .then(() => {
                  if (searchHit.current && searchHit.current.page === pageNum) {
                    highlightTextLayer(textLayerRef.current, searchHit.current.query);
                  }
                })
                .catch(() => undefined);
            }
            if (entry.intersectionRatio > 0.5) onVisible(pageNum);
          }
        }
      },
      { root, rootMargin: '200px 0px', threshold: [0, 0.5, 1] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [pdf, pageNum, scale, rendered, onVisible, scrollRoot, searchHit]);

  // Re-render on scale change if already rendered.
  useEffect(() => {
    if (rendered && canvasRef.current) {
      renderPageInto(pdf, pageNum, scale, canvasRef.current, textLayerRef.current).catch(() => undefined);
    }
  }, [scale]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={wrapRef}
      data-page={pageNum}
      className="relative shadow-warm"
      style={size ? { width: size.w, minHeight: size.h } : { minHeight: 600 }}
    >
      <div className="relative" style={{ filter }}>
        <canvas ref={canvasRef} />
        <div ref={textLayerRef} className="textLayer" />
      </div>
      <span className="absolute -top-3 right-0 text-[10px] text-ink-400">{pageNum}</span>
    </div>
  );
}

/**
 * A grid of lazily-rendered page thumbnails for quick navigation.
 */
function ThumbnailGrid({
  pdf,
  totalPages,
  currentPage,
  onJump,
  onClose,
}: {
  pdf: any;
  totalPages: number;
  currentPage: number;
  onJump: (page: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex">
      <div className="absolute inset-0 bg-ink-900/40" onClick={onClose} />
      <div
        className="relative w-80 h-full overflow-y-auto p-3 shadow-warm-lg"
        style={{ backgroundColor: 'rgb(var(--p-50))', borderRight: '1px solid rgb(var(--p-300))' }}
      >
        <div className="flex items-center justify-between mb-3 px-1">
          <span className="text-sm font-semibold text-ink-900">Pages</span>
          <button type="button" onClick={onClose} className="p-1.5 text-ink-400 hover:text-ink-700 rounded-md hover:bg-parchment-200" aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Thumbnail key={p} pdf={pdf} pageNum={p} active={p === currentPage} onClick={() => onJump(p)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Thumbnail({ pdf, pageNum, active, onClick }: { pdf: any; pageNum: number; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLButtonElement>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !done && ref.current) {
          setDone(true);
          (async () => {
            const page = await pdf.getPage(pageNum);
            const vp = page.getViewport({ scale: 1 });
            const targetW = 130;
            const s = targetW / vp.width;
            const v = page.getViewport({ scale: s });
            const canvas = ref.current!;
            canvas.width = v.width;
            canvas.height = v.height;
            await page.render({ canvasContext: canvas.getContext('2d')!, viewport: v }).promise;
          })().catch(() => undefined);
        }
      }
    }, { rootMargin: '150px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [pdf, pageNum, done]);

  return (
    <button
      ref={wrapRef}
      type="button"
      onClick={onClick}
      className={`block rounded-lg overflow-hidden border transition-all ${active ? 'border-ember-500 ring-2 ring-ember-500/40' : 'border-parchment-300 hover:border-ember-400'}`}
    >
      <canvas ref={ref} className="w-full block bg-white" style={{ minHeight: 80 }} />
      <span className="block text-[10px] text-ink-500 py-1">{pageNum}</span>
    </button>
  );
}

function debounce<T extends (...args: any[]) => any>(func: T, wait: number) {
  let timeout: ReturnType<typeof setTimeout>;
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
