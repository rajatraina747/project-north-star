import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ePub from 'epubjs';
import type { Book, Rendition } from 'epubjs';
import { progress as progressApi, bookmarks as bookmarksApi } from '../lib/api';
import {
  getLocalProgress,
  pickLatestProgress,
  setLocalProgress,
  type ReaderFormat,
} from '../lib/readerProgress';
import ReaderShell, { type TocItem, type BookmarkItem, type ReaderSearchResult } from './ReaderShell';
import ReaderSettingsPanel from './ReaderSettingsPanel';
import { useReaderSettings, FONT_STACKS, READER_THEME_COLORS, type ReaderSettings } from '../lib/readerSettings';
import { useReadingHeartbeat } from '../lib/readingHeartbeat';
import { getToken } from '../lib/auth';

// Build and apply the live typography/theme overrides to an epub.js rendition.
// Uses !important so book-supplied CSS doesn't win over the reader's choices.
function applyEpubTheme(rendition: Rendition, settings: ReaderSettings) {
  const { bg, fg } = READER_THEME_COLORS[settings.theme];
  const family = FONT_STACKS[settings.fontFamily];
  rendition.themes.register('northstar', {
    html: { background: `${bg} !important` },
    body: {
      background: `${bg} !important`,
      color: `${fg} !important`,
      'font-family': `${family} !important`,
      'line-height': `${settings.lineHeight} !important`,
      'text-align': `${settings.justify ? 'justify' : 'initial'} !important`,
      'padding-left': `${settings.margin}px !important`,
      'padding-right': `${settings.margin}px !important`,
    },
    'p, li, div, span, a': {
      'font-family': `${family} !important`,
      'line-height': `${settings.lineHeight} !important`,
      color: `${fg} !important`,
    },
    p: { 'text-align': `${settings.justify ? 'justify' : 'inherit'} !important` },
  });
  rendition.themes.select('northstar');
  rendition.themes.fontSize(`${settings.fontSize}%`);
}

interface EpubReaderProps {
  bookId: string;
  fileId: string;
  fileUrl: string;
  title: string;
}

export default function EpubReader({ bookId, fileId, fileUrl, title }: EpubReaderProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const tocRef = useRef<TocItem[]>([]);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [chapterTitle, setChapterTitle] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentCfi, setCurrentCfi] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastProgressRef = useRef<{ cfi: string; percent: number; chapter?: string | null } | null>(null);
  const locationsReadyRef = useRef(false);
  const locationsPromiseRef = useRef<Promise<void> | null>(null);
  const lastHighlightRef = useRef<string | null>(null);

  const [settings, updateSettings] = useReaderSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const recordPageTurn = useReadingHeartbeat(bookId, fileId);

  // Finished state (lightweight query independent of the imperative CFI load).
  const { data: progressMeta } = useQuery({
    queryKey: ['progress-meta', bookId, fileId],
    queryFn: () => progressApi.get(bookId, fileId),
  });
  const isFinished = !!progressMeta?.data?.finished;
  const finishMutation = useMutation({
    mutationFn: (finished: boolean) => progressApi.setFinished(bookId, fileId, finished),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress-meta', bookId, fileId] }),
  });

  const { bg: stageBg } = READER_THEME_COLORS[settings.theme];

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
    mutationFn: ({ cfi, label }: { cfi: string; label?: string }) =>
      bookmarksApi.create(bookId, fileId, { epub_cfi: cfi, label: label || chapterTitle || undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookmarks', bookId, fileId] }),
  });

  const deleteBookmarkMutation = useMutation({
    mutationFn: (id: string) => bookmarksApi.delete(bookId, fileId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookmarks', bookId, fileId] }),
  });

  useEffect(() => {
    if (!viewerRef.current) return;

    let mounted = true;
    let iframeCleanup: (() => void) | null = null;

    const loadBook = async () => {
      try {
        const token = getToken();
        const response = await fetch(fileUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to load book: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();

        if (!mounted) return;

        const book = ePub(arrayBuffer);
        bookRef.current = book;

        const rendition = book.renderTo(viewerRef.current!, {
          width: '100%',
          height: '100%',
          spread: 'none',
          allowScriptedContent: true,
        });

        renditionRef.current = rendition;

        book.loaded.navigation.then((nav) => {
          const items = (nav.toc || []) as TocItem[];
          tocRef.current = items;
          if (mounted) setToc(items);
        });

        // Generate locations after book is ready
        const storedLocations = localStorage.getItem(`reader:epub:locations:${bookId}`);

        rendition.on('displayed', () => {
          if (locationsReadyRef.current) return; // Already generated

          locationsPromiseRef.current = (async () => {
            try {
              if (storedLocations) {
                try {
                  book.locations.load(storedLocations);

                  // Verify cache is valid (total should be > 0)
                  // `total` exists at runtime but is missing from epubjs types.
                  const total = (book.locations as any).total;
                  if (!total || total <= 0) {
                    await book.locations.generate(1200);
                  }
                } catch {
                  await book.locations.generate(1200);
                }
              } else {
                await book.locations.generate(1200);
              }

              // Save to cache
              const serialized = book.locations?.save();
              if (serialized) {
                localStorage.setItem(`reader:epub:locations:${bookId}`, serialized);
              }
            } finally {
              locationsReadyRef.current = true;

              // Trigger progress update now that locations are ready.
              // currentLocation()'s runtime shape (with `.start`) isn't in the types.
              const currentLoc = rendition.currentLocation() as any;
              if (currentLoc?.start?.cfi) {
                const percent = book.locations?.percentageFromCfi(currentLoc.start.cfi);
                if (typeof percent === 'number') {
                  setProgressPercent(Math.round(percent * 100));
                }
              }
            }
          })();
        });

        rendition.on('relocated', async (location: any) => {
          const cfi = location.start.cfi;
          if (mounted) setCurrentCfi(cfi);

          const computePercent = async () => {
            // Wait for locations to be ready
            if (!locationsReadyRef.current && locationsPromiseRef.current) {
              await locationsPromiseRef.current.catch(() => undefined);
            }

            // Make sure locations are actually available
            if (!book.locations || !book.locations.percentageFromCfi) {
              return null;
            }

            const percentValue = book.locations.percentageFromCfi(cfi);
            if (typeof percentValue === 'number') {
              const roundedPercent = Math.round(percentValue * 100);
              setProgressPercent(roundedPercent);
              return percentValue;
            }
            return null;
          };

          const href = location.start.href || location.start?.section?.href;
          const chapter = href ? findChapterTitle(href, tocRef.current) : null;
          if (chapter) {
            setChapterTitle(chapter);
          }

          const resolvedPercent = await computePercent();
          const roundedPercent = typeof resolvedPercent === 'number'
            ? Math.round(resolvedPercent * 100)
            : 0;
          lastProgressRef.current = { cfi, percent: roundedPercent, chapter };
          commitLocalProgress(cfi, roundedPercent, chapter);
          saveProgressDebounced(cfi, roundedPercent);
          recordPageTurn();
        });

        const attachIframeHandlers = () => {
          iframeCleanup?.();
          const iframe = viewerRef.current?.querySelector('iframe');
          if (!iframe?.contentWindow) return;

          let wheelX = 0;
          let wheelY = 0;
          let lastWheelAt = 0;
          const handleWheel = (event: WheelEvent) => {
            const now = Date.now();

            if (now - lastWheelAt > 220) {
              wheelX = 0;
              wheelY = 0;
            }
            lastWheelAt = now;
            wheelX += event.deltaX;
            wheelY += event.deltaY;

            const useHorizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
            const primary = useHorizontal ? wheelX : wheelY;
            const threshold = 60;
            if (Math.abs(primary) < threshold) return;

            event.preventDefault();
            if (primary > 0) {
              rendition.next();
            } else {
              rendition.prev();
            }

            wheelX = 0;
            wheelY = 0;
          };

          let touchStartX = 0;
          let touchStartY = 0;
          const handleTouchStart = (event: TouchEvent) => {
            const touch = event.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
          };
          const handleTouchEnd = (event: TouchEvent) => {
            const touch = event.changedTouches[0];
            const deltaX = touch.clientX - touchStartX;
            const deltaY = touch.clientY - touchStartY;
            if (Math.abs(deltaX) < 40 || Math.abs(deltaX) < Math.abs(deltaY)) return;
            if (deltaX < 0) {
              rendition.next();
            } else {
              rendition.prev();
            }
          };

          const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              rendition.prev();
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              rendition.next();
            }
          };

          iframe.contentWindow.addEventListener('wheel', handleWheel, { passive: false });
          iframe.contentWindow.addEventListener('touchstart', handleTouchStart, { passive: true });
          iframe.contentWindow.addEventListener('touchend', handleTouchEnd);
          iframe.contentWindow.addEventListener('keydown', handleKey);

          iframeCleanup = () => {
            iframe.contentWindow?.removeEventListener('wheel', handleWheel);
            iframe.contentWindow?.removeEventListener('touchstart', handleTouchStart);
            iframe.contentWindow?.removeEventListener('touchend', handleTouchEnd);
            iframe.contentWindow?.removeEventListener('keydown', handleKey);
          };
        };

        rendition.on('rendered', attachIframeHandlers);

        try {
          const localProgress = getLocalProgress(bookId, 'EPUB');
          const progressResponse = await progressApi.get(bookId, fileId);
          const decision = pickLatestProgress(localProgress, progressResponse.data?.last_read_at);
          const savedCfi = decision === 'local'
            ? localProgress?.cfi
            : progressResponse.data?.epub_cfi || localProgress?.cfi;
          if (savedCfi && mounted) {
            rendition.display(savedCfi);
          } else if (mounted) {
            rendition.display();
          }
        } catch {
          const localProgress = getLocalProgress(bookId, 'EPUB');
          if (localProgress?.cfi && mounted) {
            rendition.display(localProgress.cfi);
          } else if (mounted) {
            rendition.display();
          }
        }

        applyEpubTheme(rendition, settingsRef.current);

        setTimeout(() => {
          if (mounted) {
            setIsLoading(false);
          }
        }, 500);
      } catch (err: any) {
        console.error('Error loading EPUB:', err);
        if (mounted) {
          setError(err.message || 'Failed to load book');
          setIsLoading(false);
        }
      }
    };

    loadBook();

    return () => {
      mounted = false;
      iframeCleanup?.();
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
    };
  }, [bookId, fileId, fileUrl]);

  const commitLocalProgress = (cfi: string, percent: number, chapter?: string | null) => {
    const updatedAt = new Date().toISOString();
    setLocalProgress({
      bookId,
      format: 'EPUB' as ReaderFormat,
      percent,
      updatedAt,
      cfi,
      chapter: chapter ?? null,
    });
  };

  const syncProgress = (cfi: string, percent: number) => {
    const payload = {
      epub_cfi: cfi,
      progress_percent: percent,
    };
    progressApi.update(bookId, fileId, payload)
      .catch((err) => {
        console.error('Failed to save progress:', err);
      });
  };

  const saveProgressDebounced = useRef(
    debounce((cfi: string, percent: number) => {
      syncProgress(cfi, percent);
    }, 2000)
  ).current;

  useEffect(() => {
    const flushProgress = () => {
      if (!lastProgressRef.current) return;
      const { cfi, percent, chapter } = lastProgressRef.current;
      commitLocalProgress(cfi, percent, chapter);
      syncProgress(cfi, percent);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress();
      }
    };
    window.addEventListener('beforeunload', flushProgress);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('beforeunload', flushProgress);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [bookId, fileId]);

  // Re-apply typography/theme live whenever settings change.
  useEffect(() => {
    if (renditionRef.current) {
      applyEpubTheme(renditionRef.current, settings);
    }
  }, [settings]);

  const goToPrevPage = () => {
    renditionRef.current?.prev();
  };

  const goToNextPage = () => {
    renditionRef.current?.next();
  };

  // Full-text search across spine items. Returns CFI-located hits with excerpts.
  const handleSearch = async (query: string): Promise<ReaderSearchResult[]> => {
    const book = bookRef.current;
    if (!book) return [];
    await book.ready;
    const results: ReaderSearchResult[] = [];
    const spineItems: any[] = (book.spine as any)?.spineItems || [];
    for (const item of spineItems) {
      try {
        await item.load(book.load.bind(book));
        const matches: { cfi: string; excerpt: string }[] = item.find(query) || [];
        const chapter = findChapterTitle(item.href, tocRef.current);
        for (const m of matches) {
          results.push({
            id: m.cfi,
            location: m.cfi,
            excerpt: m.excerpt?.trim() || '',
            label: chapter || undefined,
          });
          if (results.length >= 300) break;
        }
      } catch {
        // skip unreadable spine items
      } finally {
        try { item.unload(); } catch { /* ignore */ }
      }
      if (results.length >= 300) break;
    }
    return results;
  };

  const handleJumpToSearchResult = (result: ReaderSearchResult) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const cfi = result.location;
    rendition.display(cfi).then(() => {
      // Replace any prior highlight with the new match.
      if (lastHighlightRef.current) {
        try { rendition.annotations.remove(lastHighlightRef.current, 'highlight'); } catch { /* ignore */ }
      }
      try {
        rendition.annotations.add(
          'highlight', cfi, {}, undefined, 'ns-search-hit',
          { fill: 'rgba(201,101,38,0.4)' }
        );
        lastHighlightRef.current = cfi;
      } catch { /* ignore */ }
    }).catch(() => undefined);
  };

  const goToFirst = () => {
    renditionRef.current?.display();
  };

  const goToLast = () => {
    const book = bookRef.current;
    const lastCfi = book?.locations?.cfiFromPercentage(1);
    if (lastCfi) {
      renditionRef.current?.display(lastCfi);
    }
  };

  const handleSeek = async (percent: number) => {
    const book = bookRef.current;

    // Wait for locations to be ready
    if (!locationsReadyRef.current && locationsPromiseRef.current) {
      await locationsPromiseRef.current.catch(() => undefined);
    }

    // Make sure locations are available
    if (!book || !book.locations || !book.locations.cfiFromPercentage) {
      return;
    }

    const cfi = book.locations.cfiFromPercentage(percent / 100);
    if (cfi) {
      renditionRef.current?.display(cfi);
    }
  };

  const handleTocNavigate = (href: string) => {
    renditionRef.current?.display(href);
  };

  const handleAddBookmark = () => {
    if (!currentCfi) return;
    addBookmarkMutation.mutate({ cfi: currentCfi });
  };

  const handleJumpToBookmark = (bookmark: BookmarkItem) => {
    if (bookmark.epub_cfi) {
      renditionRef.current?.display(bookmark.epub_cfi);
    }
  };

  const handleDeleteBookmark = (id: string) => {
    deleteBookmarkMutation.mutate(id);
  };

  return (
    <ReaderShell
      title={title}
      subtitle={chapterTitle}
      onBack={() => navigate(`/books/${bookId}`)}
      progressPercent={progressPercent}
      progressLabel={`${progressPercent}% read`}
      leftStatus="EPUB"
      onPrev={goToPrevPage}
      onNext={goToNextPage}
      onFirst={goToFirst}
      onLast={goToLast}
      onProgressSeek={handleSeek}
      toc={toc}
      currentChapter={chapterTitle}
      onTocNavigate={handleTocNavigate}
      bookmarks={bookmarks}
      onAddBookmark={handleAddBookmark}
      onJumpToBookmark={handleJumpToBookmark}
      onDeleteBookmark={handleDeleteBookmark}
      onSearch={handleSearch}
      onJumpToSearchResult={handleJumpToSearchResult}
      isFinished={isFinished}
      onToggleFinished={() => finishMutation.mutate(!isFinished)}
      rightActions={<ReaderSettingsPanel settings={settings} onChange={updateSettings} />}
    >
      <div className="relative h-full">
        {isLoading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-parchment-50 z-10 rounded-2xl">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ember-500 mx-auto mb-3" />
              <p className="text-ink-500 text-sm">Opening EPUB...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-parchment-50 z-10 rounded-2xl">
            <div className="text-center max-w-md">
              <svg className="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="text-xl font-semibold text-ink-900 mb-2">Failed to Load Book</h3>
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

        <div className="h-full rounded-2xl shadow-[0_30px_120px_rgba(0,0,0,0.45)] overflow-hidden" style={{ backgroundColor: stageBg }}>
          <div ref={viewerRef} className="w-full h-full" style={{ minHeight: '400px' }} />
        </div>
      </div>
    </ReaderShell>
  );
}

function findChapterTitle(
  href: string,
  toc: TocItem[]
): string | null {
  const cleanHref = href.split('#')[0];
  for (const item of toc) {
    if (item.href?.split('#')[0] === cleanHref) {
      return item.label || null;
    }
    if (item.subitems?.length) {
      const child = findChapterTitle(href, item.subitems);
      if (child) return child;
    }
  }
  return null;
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
