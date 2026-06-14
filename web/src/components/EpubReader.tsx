import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ePub from 'epubjs';
import type { Book, Rendition } from 'epubjs';
import { progress as progressApi } from '../lib/api';
import {
  getLocalProgress,
  pickLatestProgress,
  setLocalProgress,
  type ReaderFormat,
} from '../lib/readerProgress';
import ReaderShell from './ReaderShell';

interface EpubReaderProps {
  bookId: string;
  fileId: string;
  fileUrl: string;
  title: string;
}

export default function EpubReader({ bookId, fileId, fileUrl, title }: EpubReaderProps) {
  const navigate = useNavigate();
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const tocRef = useRef<Array<{ href: string; label: string; subitems?: any[] }>>([]);
  const [chapterTitle, setChapterTitle] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [fontSize, setFontSize] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const lastProgressRef = useRef<{ cfi: string; percent: number; chapter?: string | null } | null>(null);
  const locationsReadyRef = useRef(false);
  const locationsPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!viewerRef.current) return;

    let mounted = true;
    let iframeCleanup: (() => void) | null = null;

    const loadBook = async () => {
      try {
        const token = localStorage.getItem('token');
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
          tocRef.current = nav.toc || [];
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

        rendition.themes.default({
          'body': {
            'background': '#f5f0e6',
            'color': '#1c1917',
            'font-family': 'Georgia, ui-serif, serif',
            'line-height': '1.6',
          },
        });

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

  const goToPrevPage = () => {
    renditionRef.current?.prev();
  };

  const goToNextPage = () => {
    renditionRef.current?.next();
  };

  const changeFontSize = (delta: number) => {
    const newSize = Math.max(80, Math.min(150, fontSize + delta));
    setFontSize(newSize);
    renditionRef.current?.themes.fontSize(`${newSize}%`);
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
      rightActions={(
        <div className="flex items-center gap-2 bg-obsidian-800/60 rounded-lg p-1">
          <button
            onClick={() => changeFontSize(-10)}
            className="p-2 text-obsidian-400 hover:text-white"
            title="Decrease font size"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <span className="text-xs text-obsidian-400 w-10 text-center">{fontSize}%</span>
          <button
            onClick={() => changeFontSize(10)}
            className="p-2 text-obsidian-400 hover:text-white"
            title="Increase font size"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      )}
    >
      <div className="relative h-full">
        {isLoading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-obsidian-950 z-10 rounded-2xl">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-polaris-500 mx-auto mb-3" />
              <p className="text-obsidian-400 text-sm">Opening EPUB...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-obsidian-950 z-10 rounded-2xl">
            <div className="text-center max-w-md">
              <svg className="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="text-xl font-semibold text-white mb-2">Failed to Load Book</h3>
              <p className="text-obsidian-400 mb-4">{error}</p>
              <button
                onClick={() => navigate(`/books/${bookId}`)}
                className="px-6 py-2 bg-polaris-600 text-white rounded-lg hover:bg-polaris-700"
              >
                Go Back
              </button>
            </div>
          </div>
        )}

        <div className="h-full bg-[#f5f0e6] rounded-2xl shadow-[0_30px_120px_rgba(0,0,0,0.45)] overflow-hidden">
          <div ref={viewerRef} className="w-full h-full" style={{ minHeight: '400px' }} />
        </div>
      </div>
    </ReaderShell>
  );
}

function findChapterTitle(
  href: string,
  toc: Array<{ href: string; label: string; subitems?: any[] }>
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
