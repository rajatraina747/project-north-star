import { useEffect, useRef, useState } from 'react';
import { admin } from '../lib/api';
import type { ScanHistory } from '../types';

/**
 * Live scan progress. Prefers the SSE stream; if the stream fails to open or
 * drops, it transparently falls back to polling GET /admin/scans/:id. Calls
 * onComplete once when the scan leaves the RUNNING state.
 */
export default function ScanProgress({ scanId, onComplete }: { scanId: string; onComplete: () => void }) {
  const [scan, setScan] = useState<ScanHistory | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const completedRef = useRef(false);

  const finish = (s: ScanHistory) => {
    setScan(s);
    if (!completedRef.current && s.status !== 'RUNNING') {
      completedRef.current = true;
      onComplete();
    }
  };

  // Primary: SSE stream.
  useEffect(() => {
    completedRef.current = false;
    let fellBack = false;
    const abort = admin.streamScan(scanId, {
      onProgress: (s) => setScan(s),
      onDone: (s) => finish(s),
      onError: () => {
        if (!fellBack) {
          fellBack = true;
          setUsingFallback(true);
        }
      },
    });
    return () => abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  // Fallback: polling, only active if the stream failed.
  useEffect(() => {
    if (!usingFallback || completedRef.current) return;
    const timer = setInterval(async () => {
      try {
        const res = await admin.getScan(scanId);
        finish(res.data);
        if (res.data.status !== 'RUNNING') clearInterval(timer);
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingFallback, scanId]);

  if (!scan) {
    return (
      <div className="flex items-center gap-3 text-ink-500">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-ember-500" />
        <span className="text-sm">Connecting to scan…</span>
      </div>
    );
  }

  const total = scan.files_total ?? 0;
  const done = scan.files_scanned ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : scan.status === 'RUNNING' ? 0 : 100;
  const running = scan.status === 'RUNNING';

  const phaseLabel: Record<string, string> = {
    SCANNING: 'Scanning files',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-ink-800">
          {phaseLabel[scan.current_phase || ''] || (running ? 'Working…' : scan.status)}
          {usingFallback && running && <span className="text-ink-400"> · polling</span>}
        </span>
        <span className="text-ink-500">
          {total > 0 ? `${done} / ${total} files` : `${done} files`} {total > 0 && `(${pct}%)`}
        </span>
      </div>

      <div className="h-2 w-full bg-parchment-300 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            scan.status === 'FAILED' ? 'bg-red-500' : 'bg-ember-500'
          } ${running && total === 0 ? 'animate-pulse w-1/3' : ''}`}
          style={total > 0 ? { width: `${pct}%` } : undefined}
        />
      </div>

      {running && scan.current_file && (
        <p className="text-xs text-ink-400 truncate" title={scan.current_file}>
          {scan.current_file}
        </p>
      )}
      {scan.status === 'FAILED' && scan.error_message && (
        <p className="text-xs text-red-600">{scan.error_message}</p>
      )}
      {scan.status === 'COMPLETED' && (
        <p className="text-xs text-green-700">
          Added {scan.files_added} · Updated {scan.files_updated} · Removed {scan.files_removed}
        </p>
      )}
    </div>
  );
}
