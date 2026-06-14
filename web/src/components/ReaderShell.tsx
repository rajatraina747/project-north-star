import { ReactNode, useEffect, useRef, useState } from 'react';

export interface TocItem {
  label: string;
  href: string;
  level?: number;
  subitems?: TocItem[];
}

export interface BookmarkItem {
  id: string;
  label: string | null;
  epub_cfi: string | null;
  pdf_page: number | null;
  created_at: string;
}

export interface ReaderSearchResult {
  id: string;
  excerpt: string;
  // EPUB: CFI string; PDF: page number (as string). Opaque to the shell.
  location: string;
  label?: string;
}

interface ReaderShellProps {
  title: string;
  subtitle?: string | null;
  onBack: () => void;
  children: ReactNode;
  progressPercent?: number;
  progressLabel?: string;
  onProgressSeek?: (percent: number) => void;
  leftStatus?: string;
  onPrev?: () => void;
  onNext?: () => void;
  onFirst?: () => void;
  onLast?: () => void;
  rightActions?: ReactNode;
  debugInfo?: {
    bookId: string;
    format: 'EPUB' | 'PDF';
    percent?: number;
    cfi?: string | null;
    lastSaveAt?: string | null;
  };
  // TOC
  toc?: TocItem[];
  currentChapter?: string | null;
  onTocNavigate?: (href: string) => void;
  // Bookmarks
  bookmarks?: BookmarkItem[];
  onAddBookmark?: () => void;
  onJumpToBookmark?: (bookmark: BookmarkItem) => void;
  onDeleteBookmark?: (id: string) => void;
  // In-book search
  onSearch?: (query: string) => Promise<ReaderSearchResult[]>;
  onJumpToSearchResult?: (result: ReaderSearchResult) => void;
  // Mark as finished
  isFinished?: boolean;
  onToggleFinished?: () => void;
}

type SidebarTab = 'toc' | 'bookmarks' | 'search';

export default function ReaderShell({
  title,
  subtitle,
  onBack,
  children,
  progressPercent,
  progressLabel,
  onProgressSeek,
  leftStatus,
  onPrev,
  onNext,
  onFirst,
  onLast,
  rightActions,
  toc,
  currentChapter,
  onTocNavigate,
  bookmarks,
  onAddBookmark,
  onJumpToBookmark,
  onDeleteBookmark,
  onSearch,
  onJumpToSearchResult,
  isFinished,
  onToggleFinished,
}: ReaderShellProps) {
  const [hudVisible, setHudVisible] = useState(true);
  const [hoverZone, setHoverZone] = useState<'left' | 'right' | null>(null);
  const [showTip, setShowTip] = useState(false);
  const [scrubPercent, setScrubPercent] = useState<number | null>(null);
  const [isProgressHover, setIsProgressHover] = useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [hudHeight, setHudHeight] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('toc');
  const hideTimer = useRef<number | null>(null);
  const lastWheelTime = useRef(0);
  const progressRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const scrubActive = useRef(false);
  const wheelDelta = useRef({ x: 0, y: 0, lastAt: 0 });
  const leftZoneRef = useRef<HTMLButtonElement>(null);
  const rightZoneRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // In-book search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ReaderSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchedOnce, setSearchedOnce] = useState(false);

  const hasSidebar = (toc && toc.length > 0) || onAddBookmark !== undefined || onSearch !== undefined;

  const runSearch = async (query: string) => {
    if (!onSearch || !query.trim()) {
      setSearchResults([]);
      setSearchedOnce(false);
      return;
    }
    setSearchBusy(true);
    setSearchedOnce(true);
    try {
      const results = await onSearch(query.trim());
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchBusy(false);
    }
  };

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => undefined);
    } else {
      document.exitFullscreen?.().catch(() => undefined);
    }
  };

  const showHud = () => {
    setHudVisible(true);
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
    }
    hideTimer.current = window.setTimeout(() => {
      setHudVisible(false);
    }, 2000);
  };

  useEffect(() => {
    showHud();
    setShowTip(!localStorage.getItem('reader-click-tip'));

    const handleActivity = () => showHud();
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const handleKey = (event: KeyboardEvent) => {
      // Escape exits fullscreen / closes the sidebar even from inputs.
      if (event.key === 'Escape') {
        if (document.fullscreenElement) {
          document.exitFullscreen?.().catch(() => undefined);
          return;
        }
        if (sidebarOpen) {
          setSidebarOpen(false);
        } else {
          setHudVisible((prev) => !prev);
        }
        return;
      }
      // Never hijack keys while the user is typing (e.g. the search box).
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'ArrowLeft' || event.key === 'k') {
        event.preventDefault();
        onPrev?.();
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'j') {
        event.preventDefault();
        onNext?.();
        return;
      }
      if (event.key === ' ' && event.shiftKey) {
        event.preventDefault();
        onPrev?.();
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        onNext?.();
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        onFirst?.();
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        onLast?.();
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggleFullscreen();
        return;
      }
      if ((event.key === 'b' || event.key === 'B') && onAddBookmark) {
        event.preventDefault();
        onAddBookmark();
        showHud();
        return;
      }
      showHud();
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('scroll', handleActivity, { passive: true });
    window.addEventListener('keydown', handleKey);
    window.addEventListener('touchstart', handleActivity, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('touchstart', handleActivity);
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
      }
    };
  }, [onPrev, onNext, onFirst, onLast, onAddBookmark, sidebarOpen]);

  useEffect(() => {
    const updateHudHeight = () => {
      setHudHeight(hudRef.current?.offsetHeight ?? 0);
    };
    updateHudHeight();
    window.addEventListener('resize', updateHudHeight);
    return () => window.removeEventListener('resize', updateHudHeight);
  }, [hudVisible, progressPercent, progressLabel, leftStatus, onProgressSeek]);

  useEffect(() => {
    const media = window.matchMedia?.('(pointer: coarse)');
    if (!media) return;
    const updatePointer = () => setIsCoarsePointer(media.matches);
    updatePointer();
    media.addEventListener('change', updatePointer);
    return () => media.removeEventListener('change', updatePointer);
  }, []);


  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!onPrev || !onNext) return;
    const now = Date.now();

    if (now - wheelDelta.current.lastAt > 220) {
      wheelDelta.current.x = 0;
      wheelDelta.current.y = 0;
    }
    wheelDelta.current.lastAt = now;
    wheelDelta.current.x += event.deltaX;
    wheelDelta.current.y += event.deltaY;

    const useHorizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const primary = useHorizontal ? wheelDelta.current.x : wheelDelta.current.y;
    const threshold = 60;

    if (Math.abs(primary) < threshold) return;

    if (now - lastWheelTime.current < 160) return;
    lastWheelTime.current = now;
    wheelDelta.current.x = 0;
    wheelDelta.current.y = 0;

    event.preventDefault();
    if (primary > 0) {
      onNext();
    } else {
      onPrev();
    }
  };

  const calculatePercent = (clientX: number) => {
    if (!progressRef.current) return 0;
    const rect = progressRef.current.getBoundingClientRect();
    const raw = (clientX - rect.left) / rect.width;
    return Math.min(100, Math.max(0, Math.round(raw * 100)));
  };

  const handleProgressPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onProgressSeek) return;
    if (event.pointerType === 'touch') {
      setIsCoarsePointer(true);
    }
    scrubActive.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const percent = calculatePercent(event.clientX);
    setScrubPercent(percent);
  };

  useEffect(() => {
    if (!onProgressSeek) return;
    const handleMove = (event: PointerEvent) => {
      if (!scrubActive.current) return;
      const percent = calculatePercent(event.clientX);
      setScrubPercent(percent);
    };
    const handleUp = (event: PointerEvent) => {
      if (scrubActive.current) {
        scrubActive.current = false;
        if (scrubPercent !== null) {
          onProgressSeek(scrubPercent);
        }
        setScrubPercent(null);
        try {
          progressRef.current?.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [onProgressSeek, scrubPercent]);

  const handleZoneClick = (side: 'left' | 'right') => {
    const selection = window.getSelection()?.toString();
    if (selection) return;

    if (side === 'left') {
      onPrev?.();
    } else {
      onNext?.();
    }

    if (showTip) {
      localStorage.setItem('reader-click-tip', 'true');
      setShowTip(false);
    }
  };

  const openSidebar = (tab: SidebarTab) => {
    setSidebarTab(tab);
    setSidebarOpen(true);
  };

  return (
    <div ref={rootRef} className="h-screen bg-parchment-50 text-ink-900 relative overflow-hidden flex">
      {/* Sidebar Panel */}
      {hasSidebar && (
        <>
          {/* Dim overlay behind sidebar (click to close) */}
          {sidebarOpen && (
            <div
              className="absolute inset-0 z-30 bg-ink-900/30"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          {/* Sidebar — absolute so it stays within the reader container, not the viewport */}
          <aside
            className={`absolute left-0 top-0 h-full z-40 flex flex-col transition-transform duration-300 ease-soft shadow-warm-lg ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
            style={{ width: '280px', backgroundColor: 'rgb(var(--p-50))', borderRight: '1px solid rgb(var(--p-300))' }}
          >
            {/* Sidebar header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-parchment-300">
              <div className="flex gap-1">
                {toc && toc.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSidebarTab('toc')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-200 ${
                      sidebarTab === 'toc'
                        ? 'bg-ember-500 text-cream'
                        : 'text-ink-500 hover:bg-parchment-200'
                    }`}
                  >
                    Contents
                  </button>
                )}
                {onAddBookmark !== undefined && (
                  <button
                    type="button"
                    onClick={() => setSidebarTab('bookmarks')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-200 ${
                      sidebarTab === 'bookmarks'
                        ? 'bg-ember-500 text-cream'
                        : 'text-ink-500 hover:bg-parchment-200'
                    }`}
                  >
                    Bookmarks {bookmarks && bookmarks.length > 0 ? `(${bookmarks.length})` : ''}
                  </button>
                )}
                {onSearch !== undefined && (
                  <button
                    type="button"
                    onClick={() => setSidebarTab('search')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-200 ${
                      sidebarTab === 'search'
                        ? 'bg-ember-500 text-cream'
                        : 'text-ink-500 hover:bg-parchment-200'
                    }`}
                  >
                    Search
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-1.5 text-ink-400 hover:text-ink-700 rounded-md hover:bg-parchment-200 transition-colors"
                aria-label="Close panel"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* TOC tab */}
            {sidebarTab === 'toc' && toc && (
              <div className="flex-1 overflow-y-auto py-2">
                {toc.length === 0 ? (
                  <p className="text-xs text-ink-400 px-4 py-3">No table of contents available.</p>
                ) : (
                  <TocList
                    items={toc}
                    currentChapter={currentChapter}
                    onNavigate={(href) => {
                      onTocNavigate?.(href);
                      setSidebarOpen(false);
                    }}
                    depth={0}
                  />
                )}
              </div>
            )}

            {/* Bookmarks tab */}
            {sidebarTab === 'bookmarks' && onAddBookmark !== undefined && (
              <div className="flex-1 overflow-y-auto flex flex-col">
                <div className="px-3 py-2 border-b border-parchment-200">
                  <button
                    type="button"
                    onClick={onAddBookmark}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-ember-500 hover:bg-ember-600 text-cream text-xs font-medium rounded-lg transition-colors duration-200"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                    Add Bookmark Here
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto py-2">
                  {!bookmarks || bookmarks.length === 0 ? (
                    <p className="text-xs text-ink-400 px-4 py-3">No bookmarks yet. Click above to add one.</p>
                  ) : (
                    <ul className="space-y-0.5 px-2">
                      {bookmarks.map((bm) => (
                        <li key={bm.id} className="flex items-start gap-1 group rounded-md hover:bg-parchment-200 transition-colors">
                          <button
                            type="button"
                            onClick={() => {
                              onJumpToBookmark?.(bm);
                              setSidebarOpen(false);
                            }}
                            className="flex-1 text-left px-2 py-2"
                          >
                            <p className="text-xs text-ink-800 font-medium line-clamp-2">
                              {bm.label || (bm.pdf_page ? `Page ${bm.pdf_page}` : 'Bookmark')}
                            </p>
                            <p className="text-[10px] text-ink-400 mt-0.5">
                              {new Date(bm.created_at).toLocaleDateString()}
                              {bm.pdf_page ? ` · p.${bm.pdf_page}` : ''}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteBookmark?.(bm.id)}
                            className="p-1.5 mt-1 text-ink-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded"
                            aria-label="Delete bookmark"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* Search tab */}
            {sidebarTab === 'search' && onSearch !== undefined && (
              <div className="flex-1 overflow-y-auto flex flex-col">
                <div className="px-3 py-2 border-b border-parchment-200">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      runSearch(searchQuery);
                    }}
                    className="flex gap-1"
                  >
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search in book…"
                      className="flex-1 px-2 py-1.5 text-xs bg-parchment-100 border border-parchment-300 rounded-md text-ink-900 focus:outline-none focus:ring-1 focus:ring-ember-500/60"
                    />
                    <button
                      type="submit"
                      className="px-2.5 py-1.5 text-xs bg-ember-500 text-cream rounded-md hover:bg-ember-600"
                    >
                      Go
                    </button>
                  </form>
                </div>
                <div className="flex-1 overflow-y-auto py-2">
                  {searchBusy ? (
                    <p className="text-xs text-ink-400 px-4 py-3">Searching…</p>
                  ) : searchedOnce && searchResults.length === 0 ? (
                    <p className="text-xs text-ink-400 px-4 py-3">No matches found.</p>
                  ) : (
                    <ul className="space-y-0.5 px-2">
                      {searchResults.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => {
                              onJumpToSearchResult?.(r);
                              setSidebarOpen(false);
                            }}
                            className="w-full text-left px-2 py-2 rounded-md hover:bg-parchment-200 transition-colors"
                          >
                            {r.label && (
                              <p className="text-[10px] text-ember-700 font-semibold mb-0.5">{r.label}</p>
                            )}
                            <p className="text-xs text-ink-700 line-clamp-3">{r.excerpt}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {searchResults.length > 0 && (
                    <p className="text-[10px] text-ink-400 px-4 pt-2">{searchResults.length} match{searchResults.length === 1 ? '' : 'es'}</p>
                  )}
                </div>
              </div>
            )}
          </aside>
        </>
      )}

      {/* Main reading area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="sticky top-0 z-20 backdrop-blur-sm bg-parchment-100/80 border-b border-parchment-300">
          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={onBack}
                className="p-2 text-ink-500 hover:text-ink-900 transition-colors duration-250 ease-soft"
                aria-label="Back"
                title="Back"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>

              {hasSidebar && (
                <button
                  type="button"
                  onClick={() => sidebarOpen ? setSidebarOpen(false) : openSidebar(toc && toc.length > 0 ? 'toc' : 'bookmarks')}
                  className="p-2 text-ink-500 hover:text-ink-900 transition-colors duration-250 ease-soft"
                  aria-label="Toggle contents"
                  title="Table of contents / Bookmarks"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              )}

              {onAddBookmark !== undefined && (
                <button
                  type="button"
                  onClick={() => openSidebar('bookmarks')}
                  className="p-2 text-ink-500 hover:text-ink-900 transition-colors duration-250 ease-soft"
                  aria-label="Bookmarks"
                  title="Bookmarks"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </button>
              )}

              {onSearch !== undefined && (
                <button
                  type="button"
                  onClick={() => openSidebar('search')}
                  className="p-2 text-ink-500 hover:text-ink-900 transition-colors duration-250 ease-soft"
                  aria-label="Search in book"
                  title="Search in book"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              )}

              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink-900 truncate">{title}</div>
                {subtitle && (
                  <div className="text-xs text-ink-400 truncate">{subtitle}</div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 text-ink-500">
              {onToggleFinished && (
                <button
                  type="button"
                  onClick={onToggleFinished}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    isFinished
                      ? 'bg-green-600/15 text-green-700 border border-green-600/30'
                      : 'bg-parchment-200 text-ink-500 hover:text-ink-900 border border-parchment-300'
                  }`}
                  title={isFinished ? 'Finished — click to mark unread' : 'Mark as finished'}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {isFinished ? 'Finished' : 'Finish'}
                </button>
              )}
              {rightActions}
            </div>
          </div>
        </div>

        {/* Reading stage */}
        <div className="h-[calc(100vh-112px)] px-6 py-6">
          <div
            className="max-w-4xl mx-auto h-full relative"
            onWheel={handleWheel}
          >
            {children}

            {onPrev && onNext && (
              <>
                <div
                  className="absolute inset-x-0 top-0 flex pointer-events-none z-10"
                  style={{ bottom: hudVisible ? `${hudHeight}px` : 0 }}
                >
                  <button
                    type="button"
                    ref={leftZoneRef}
                    className="w-[15%] cursor-w-resize pointer-events-auto"
                    onMouseEnter={() => setHoverZone('left')}
                    onMouseLeave={() => setHoverZone(null)}
                    onClick={() => handleZoneClick('left')}
                    aria-label="Previous page"
                  />
                  <button
                    type="button"
                    className="flex-1 cursor-pointer pointer-events-auto"
                    onMouseEnter={() => setHoverZone(null)}
                    onClick={() => setHudVisible((prev) => !prev)}
                    aria-label="Toggle controls"
                  />
                  <button
                    type="button"
                    ref={rightZoneRef}
                    className="w-[15%] cursor-e-resize pointer-events-auto"
                    onMouseEnter={() => setHoverZone('right')}
                    onMouseLeave={() => setHoverZone(null)}
                    onClick={() => handleZoneClick('right')}
                    aria-label="Next page"
                  />
                </div>

                <div
                  className={`pointer-events-none absolute inset-y-0 left-0 w-[15%] transition-opacity duration-250 ease-soft ${
                    hoverZone === 'left' ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-ink-900/15 to-transparent" />
                </div>

                <div
                  className={`pointer-events-none absolute inset-y-0 right-0 w-[15%] transition-opacity duration-250 ease-soft ${
                    hoverZone === 'right' ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-ink-900/15 to-transparent" />
                </div>

                <div
                  className={`pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 transition-opacity duration-250 ease-soft ${
                    hoverZone === 'left' ? 'opacity-80' : 'opacity-0'
                  }`}
                >
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-parchment-100/90 border border-parchment-300 text-ink-700">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </div>
                </div>

                <div
                  className={`pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 transition-opacity duration-250 ease-soft ${
                    hoverZone === 'right' ? 'opacity-80' : 'opacity-0'
                  }`}
                >
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-parchment-100/90 border border-parchment-300 text-ink-700">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>

                {showTip && hoverZone && (
                  <div
                    className={`pointer-events-none absolute ${
                      hoverZone === 'left' ? 'left-20' : 'right-20'
                    } top-1/2 -translate-y-1/2 text-xs text-ink-700 bg-parchment-100/95 border border-parchment-300 rounded-full px-3 py-1`}
                  >
                    Click to turn page
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Bottom HUD */}
        <div
          className={`absolute bottom-0 left-0 right-0 transition-all duration-350 ease-soft ${
            hudVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div
            ref={hudRef}
            className="backdrop-blur-sm bg-parchment-100/80 border-t border-parchment-300 z-30 relative"
          >
            {progressPercent !== undefined && (
              <div className="px-6 pt-2">
                <div
                  ref={progressRef}
                  className={`relative h-1.5 w-full rounded-full bg-parchment-300 touch-none ${
                    onProgressSeek ? 'cursor-pointer' : ''
                  }`}
                  onPointerDown={handleProgressPointerDown}
                  onPointerEnter={() => setIsProgressHover(true)}
                  onPointerLeave={() => setIsProgressHover(false)}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-ember-500 to-ember-400 transition-all duration-250 ease-soft"
                    style={{ width: `${Math.min(100, Math.max(0, scrubPercent ?? progressPercent))}%` }}
                  />
                  {onProgressSeek && (
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-cream shadow-[0_0_0_4px_rgba(201,101,38,0.22)] transition-opacity duration-200 ease-soft ${
                        scrubActive.current || isProgressHover || isCoarsePointer ? 'opacity-100' : 'opacity-0'
                      }`}
                      style={{ left: `calc(${Math.min(100, Math.max(0, scrubPercent ?? progressPercent))}% - 6px)` }}
                    />
                  )}
                  {scrubPercent !== null && (
                    <div
                      className="absolute -translate-y-7 text-[10px] text-ink-700 bg-parchment-100/95 border border-parchment-300 rounded-full px-2 py-0.5"
                      style={{ left: `calc(${scrubPercent}% - 12px)` }}
                    >
                      {scrubPercent}%
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between text-xs text-ink-500">
              <div className="flex items-center gap-3">
                {leftStatus && <span>{leftStatus}</span>}
                {progressLabel && (
                  <>
                    <span className="text-ink-400">•</span>
                    <span>{progressLabel}</span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                {onPrev && (
                  <button
                    type="button"
                    onClick={onPrev}
                    className="px-3 py-1.5 rounded-md bg-parchment-200 text-ink-700 hover:text-ink-900 hover:bg-parchment-300 transition-colors duration-250 ease-soft"
                  >
                    Prev
                  </button>
                )}
                {onNext && (
                  <button
                    type="button"
                    onClick={onNext}
                    className="px-3 py-1.5 rounded-md bg-parchment-200 text-ink-700 hover:text-ink-900 hover:bg-parchment-300 transition-colors duration-250 ease-soft"
                  >
                    Next
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TocList({
  items,
  currentChapter,
  onNavigate,
  depth,
}: {
  items: TocItem[];
  currentChapter?: string | null;
  onNavigate: (href: string) => void;
  depth: number;
}) {
  return (
    <ul className={depth > 0 ? 'pl-3' : ''}>
      {items.map((item, i) => {
        const isActive = currentChapter === item.label;
        return (
          <li key={`${item.href}-${i}`}>
            <button
              type="button"
              onClick={() => onNavigate(item.href)}
              className={`w-full text-left px-4 py-1.5 text-xs transition-colors duration-150 rounded-md mx-1 ${
                isActive
                  ? 'bg-ember-500/12 text-ember-700 font-semibold'
                  : 'text-ink-600 hover:bg-parchment-200 hover:text-ink-900'
              } ${depth > 0 ? 'text-[11px]' : ''}`}
            >
              {item.label}
            </button>
            {item.subitems && item.subitems.length > 0 && (
              <TocList
                items={item.subitems}
                currentChapter={currentChapter}
                onNavigate={onNavigate}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
