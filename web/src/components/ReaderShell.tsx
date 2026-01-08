import { ReactNode, useEffect, useRef, useState } from 'react';

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
}

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
}: ReaderShellProps) {
  const [hudVisible, setHudVisible] = useState(true);
  const [hoverZone, setHoverZone] = useState<'left' | 'right' | null>(null);
  const [showTip, setShowTip] = useState(false);
  const [scrubPercent, setScrubPercent] = useState<number | null>(null);
  const [isProgressHover, setIsProgressHover] = useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [hudHeight, setHudHeight] = useState(0);
  const hideTimer = useRef<number | null>(null);
  const lastWheelTime = useRef(0);
  const progressRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const scrubActive = useRef(false);
  const wheelDelta = useRef({ x: 0, y: 0, lastAt: 0 });
  const leftZoneRef = useRef<HTMLButtonElement>(null);
  const rightZoneRef = useRef<HTMLButtonElement>(null);

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
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHudVisible((prev) => !prev);
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onPrev?.();
        return;
      }
      if (event.key === 'ArrowRight') {
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
  }, [onPrev, onNext, onFirst, onLast]);

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

  return (
    <div className="h-screen bg-obsidian-950 text-white relative overflow-hidden">
      {/* Top bar */}
      <div className="sticky top-0 z-20 backdrop-blur-sm bg-obsidian-900/60 border-b border-obsidian-800/40">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="p-2 text-obsidian-400 hover:text-white transition-colors duration-250 ease-soft"
              aria-label="Back"
              title="Back"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{title}</div>
              {subtitle && (
                <div className="text-xs text-obsidian-500 truncate">{subtitle}</div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 text-obsidian-400">
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
                <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-obsidian-900/70 to-transparent" />
              </div>

              <div
                className={`pointer-events-none absolute inset-y-0 right-0 w-[15%] transition-opacity duration-250 ease-soft ${
                  hoverZone === 'right' ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-obsidian-900/70 to-transparent" />
              </div>

              <div
                className={`pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 transition-opacity duration-250 ease-soft ${
                  hoverZone === 'left' ? 'opacity-80' : 'opacity-0'
                }`}
              >
                <div className="flex items-center justify-center h-10 w-10 rounded-full bg-obsidian-900/70 border border-obsidian-700/60 text-obsidian-200">
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
                <div className="flex items-center justify-center h-10 w-10 rounded-full bg-obsidian-900/70 border border-obsidian-700/60 text-obsidian-200">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>

              {showTip && hoverZone && (
                <div
                  className={`pointer-events-none absolute ${
                    hoverZone === 'left' ? 'left-20' : 'right-20'
                  } top-1/2 -translate-y-1/2 text-xs text-obsidian-200 bg-obsidian-900/80 border border-obsidian-700/60 rounded-full px-3 py-1`}
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
          className="backdrop-blur-sm bg-obsidian-900/60 border-t border-obsidian-800/40 z-30 relative"
        >
          {progressPercent !== undefined && (
            <div className="px-6 pt-2">
              <div
                ref={progressRef}
                className={`relative h-1.5 w-full rounded-full bg-obsidian-800/60 touch-none ${
                  onProgressSeek ? 'cursor-pointer' : ''
                }`}
                onPointerDown={handleProgressPointerDown}
                onPointerEnter={() => setIsProgressHover(true)}
                onPointerLeave={() => setIsProgressHover(false)}
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-polaris-600 to-polaris-500 transition-all duration-250 ease-soft"
                  style={{ width: `${Math.min(100, Math.max(0, scrubPercent ?? progressPercent))}%` }}
                />
                {onProgressSeek && (
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white shadow-[0_0_0_4px_rgba(0,110,199,0.18)] transition-opacity duration-200 ease-soft ${
                      scrubActive.current || isProgressHover || isCoarsePointer ? 'opacity-100' : 'opacity-0'
                    }`}
                    style={{ left: `calc(${Math.min(100, Math.max(0, scrubPercent ?? progressPercent))}% - 6px)` }}
                  />
                )}
                {scrubPercent !== null && (
                  <div
                    className="absolute -translate-y-7 text-[10px] text-obsidian-200 bg-obsidian-900/80 border border-obsidian-700/60 rounded-full px-2 py-0.5"
                    style={{ left: `calc(${scrubPercent}% - 12px)` }}
                  >
                    {scrubPercent}%
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between text-xs text-obsidian-400">
            <div className="flex items-center gap-3">
              {leftStatus && <span>{leftStatus}</span>}
              {progressLabel && (
                <>
                  <span className="text-obsidian-600">•</span>
                  <span>{progressLabel}</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {onPrev && (
                <button
                  type="button"
                  onClick={onPrev}
                  className="px-3 py-1.5 rounded-md bg-obsidian-800/70 text-obsidian-200 hover:text-white hover:bg-obsidian-700/70 transition-colors duration-250 ease-soft"
                >
                  Prev
                </button>
              )}
              {onNext && (
                <button
                  type="button"
                  onClick={onNext}
                  className="px-3 py-1.5 rounded-md bg-obsidian-800/70 text-obsidian-200 hover:text-white hover:bg-obsidian-700/70 transition-colors duration-250 ease-soft"
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
