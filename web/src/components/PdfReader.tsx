import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
// Bundle the worker locally (self-hosted) rather than loading it from a CDN, so
// the reader works offline / on isolated networks and complies with the CSP.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { progress as progressApi } from '../lib/api';
import { getToken } from '../lib/auth';
import {
  getLocalProgress,
  pickLatestProgress,
  setLocalProgress,
  type ReaderFormat,
} from '../lib/readerProgress';
import ReaderShell from './ReaderShell';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfReaderProps {
  bookId: string;
  fileId: string;
  fileUrl: string;
  title: string;
}

export default function PdfReader({ bookId, fileId, fileUrl, title }: PdfReaderProps) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.4);
  const [isLoading, setIsLoading] = useState(true);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSaveAt, setLastSaveAt] = useState<string | null>(null);
  const lastProgressRef = useRef<{ page: number; percent: number } | null>(null);
  const totalPagesRef = useRef(0);

  useEffect(() => {
    totalPagesRef.current = totalPages;
  }, [totalPages]);

  useEffect(() => {
    const loadPdf = async () => {
      try {
        const token = getToken();
        const response = await fetch(fileUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to load PDF: ${response.statusText}`);
        }

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
        const pdfDoc = await loadingTask.promise;
        setPdf(pdfDoc);
        setTotalPages(pdfDoc.numPages);
        totalPagesRef.current = pdfDoc.numPages;

        try {
          const localProgress = getLocalProgress(bookId, 'PDF');
          const progressResponse = await progressApi.get(bookId, fileId);
          const decision = pickLatestProgress(localProgress, progressResponse.data?.last_read_at);
          const savedPage = decision === 'local'
            ? localProgress?.page
            : progressResponse.data?.pdf_page || localProgress?.page;
          if (savedPage && savedPage > 0 && savedPage <= pdfDoc.numPages) {
            setCurrentPage(savedPage);
          }
        } catch (err) {
          const localProgress = getLocalProgress(bookId, 'PDF');
          if (localProgress?.page && localProgress.page > 0 && localProgress.page <= pdfDoc.numPages) {
            setCurrentPage(localProgress.page);
          } else {
            console.error('Failed to load progress:', err);
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

  useEffect(() => {
    if (!pdf || !canvasRef.current || isRendering) return;

    const renderPage = async () => {
      setIsRendering(true);
      try {
        const page = await pdf.getPage(currentPage);
        const canvas = canvasRef.current!;
        const context = canvas.getContext('2d')!;

        const viewport = page.getViewport({ scale });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise;

        const total = totalPagesRef.current;
        const percent = total > 0 ? Math.round((currentPage / total) * 100) : 0;
        lastProgressRef.current = { page: currentPage, percent };
        commitLocalProgress(currentPage, percent);
        saveProgress(currentPage);
      } catch (err) {
        console.error('Error rendering page:', err);
      } finally {
        setIsRendering(false);
      }
    };

    renderPage();
  }, [pdf, currentPage, scale]);

  const commitLocalProgress = (page: number, percent: number) => {
    const updatedAt = new Date().toISOString();
    setLocalProgress({
      bookId,
      format: 'PDF' as ReaderFormat,
      percent,
      updatedAt,
      page,
    });
    setLastSaveAt(updatedAt);
  };

  const syncProgress = (page: number, percent: number) => {
    const payload = {
      pdf_page: page,
      progress_percent: percent,
    };
    if (import.meta.env.DEV) {
      console.debug('[reader] save progress', {
        endpoint: `/progress/${bookId}/${fileId}`,
        payload,
      });
    }
    progressApi.update(bookId, fileId, payload)
      .then((response) => {
        if (import.meta.env.DEV) {
          console.debug('[reader] save progress response', {
            endpoint: `/progress/${bookId}/${fileId}`,
            status: response.status,
          });
        }
      })
      .catch((err) => {
        console.error('Failed to save progress:', err);
      });
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
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const zoomIn = () => {
    setScale(Math.min(scale + 0.2, 3));
  };

  const zoomOut = () => {
    setScale(Math.max(scale - 0.2, 0.7));
  };

  const progressPercent = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;
  const goToFirst = () => setCurrentPage(1);
  const goToLast = () => {
    if (totalPages > 0) setCurrentPage(totalPages);
  };
  const handleSeek = (percent: number) => {
    if (totalPages === 0) return;
    const page = Math.max(1, Math.min(totalPages, Math.round((percent / 100) * totalPages)));
    setCurrentPage(page);
  };

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
      debugInfo={{
        bookId,
        format: 'PDF',
        percent: progressPercent,
        cfi: null,
        lastSaveAt,
      }}
      rightActions={(
        <div className="flex items-center gap-2 bg-parchment-200 rounded-lg p-1">
          <button
            onClick={zoomOut}
            className="p-2 text-ink-500 hover:text-ink-900"
            title="Zoom out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <span className="text-xs text-ink-500 w-10 text-center">{Math.round(scale * 100)}%</span>
          <button
            onClick={zoomIn}
            className="p-2 text-ink-500 hover:text-ink-900"
            title="Zoom in"
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

        <div className="h-full rounded-2xl bg-[#f5f0e6] shadow-[0_30px_120px_rgba(0,0,0,0.45)] flex items-center justify-center">
          <canvas ref={canvasRef} className="max-h-full max-w-full" />
        </div>
      </div>
    </ReaderShell>
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
