import { useEffect, useRef, useCallback } from 'react';
import { stats as statsApi } from './api';

/**
 * Tracks active reading time + pages advanced and flushes them to the stats
 * heartbeat endpoint on a cheap cadence. Time only accrues while the tab is
 * visible. Flushes every 30s, on tab-hide, and on unmount so a reading session
 * is recorded even if the reader is left open.
 *
 * Returns `recordPageTurn()` for the reader to call whenever the user advances
 * a page/location.
 */
export function useReadingHeartbeat(bookId?: string, fileId?: string) {
  const secondsRef = useRef(0);
  const pagesRef = useRef(0);

  useEffect(() => {
    if (!bookId || !fileId) return;

    const tick = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        secondsRef.current += 1;
      }
    }, 1000);

    const flush = () => {
      const seconds = secondsRef.current;
      const pages = pagesRef.current;
      if (seconds === 0 && pages === 0) return;
      secondsRef.current = 0;
      pagesRef.current = 0;
      statsApi.heartbeat(bookId, fileId, seconds, pages).catch(() => undefined);
    };

    const flushTimer = window.setInterval(flush, 30000);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', flush);

    return () => {
      window.clearInterval(tick);
      window.clearInterval(flushTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [bookId, fileId]);

  return useCallback(() => {
    pagesRef.current += 1;
  }, []);
}
