import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { stats as statsApi, books as booksApi } from '../lib/api';
import { useAuthenticatedImage } from '../hooks/useAuthenticatedImage';
import type { ReadingStats } from '../types';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function Stats() {
  const { data, isLoading } = useQuery({
    queryKey: ['reading-stats'],
    queryFn: async () => (await statsApi.summary()).data,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ember-500" />
      </div>
    );
  }

  const s: ReadingStats | undefined = data;
  const maxSeconds = Math.max(1, ...(s?.per_day || []).map((d) => d.seconds));

  return (
    <div className="min-h-screen">
      <div className="bg-parchment-100/70 border-b border-parchment-300">
        <div className="max-w-7xl mx-auto px-8 py-6">
          <h1 className="text-3xl font-serif font-bold text-ink-900">Reading Stats</h1>
          <p className="text-ink-500 mt-1">Your reading activity at a glance</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8 space-y-8">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <StatCard label="Total time read" value={formatDuration(s?.total_seconds || 0)} />
          <StatCard label="Current streak" value={`${s?.current_streak || 0} day${s?.current_streak === 1 ? '' : 's'}`} />
          <StatCard label="Books finished" value={String(s?.books_finished || 0)} />
          <StatCard label="Avg pages/day" value={String(s?.avg_pages_per_day || 0)} />
        </div>

        {/* Per-day chart (last 30 days) */}
        <div className="bg-parchment-100/70 rounded-xl border border-parchment-300 p-6">
          <h2 className="text-xl font-serif font-semibold text-ink-900 mb-4">Last 30 days</h2>
          {s && s.per_day.length > 0 ? (
            <div className="flex items-end gap-1 h-40">
              {s.per_day.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center justify-end group" title={`${d.day}: ${formatDuration(d.seconds)}, ${d.pages_read} pages`}>
                  <div
                    className="w-full bg-gradient-to-t from-ember-500 to-ember-400 rounded-t-sm transition-all"
                    style={{ height: `${Math.max(4, (d.seconds / maxSeconds) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-ink-400 text-center py-8">No reading activity recorded yet. Open a book to start tracking.</p>
          )}
        </div>

        {/* Per-book time */}
        <div className="bg-parchment-100/70 rounded-xl border border-parchment-300 p-6">
          <h2 className="text-xl font-serif font-semibold text-ink-900 mb-4">Time per book</h2>
          {s && s.per_book.length > 0 ? (
            <div className="space-y-3">
              {s.per_book.map((b) => (
                <PerBookRow key={b.book_id} bookId={b.book_id} title={b.title} seconds={b.seconds} pages={b.pages_read} />
              ))}
            </div>
          ) : (
            <p className="text-ink-400 text-center py-8">No per-book data yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-parchment-100/70 rounded-xl border border-parchment-300 p-6 shadow-warm">
      <div className="text-3xl font-serif font-bold text-ink-900 mb-1">{value}</div>
      <div className="text-sm text-ink-500">{label}</div>
    </div>
  );
}

function PerBookRow({ bookId, title, seconds, pages }: { bookId: string; title: string; seconds: number; pages: number }) {
  const coverUrl = useAuthenticatedImage(booksApi.getCover(bookId, true));
  return (
    <Link to={`/books/${bookId}`} className="flex items-center gap-4 p-2 rounded-lg hover:bg-parchment-200 transition-colors">
      <div className="w-10 h-14 flex-none rounded overflow-hidden bg-parchment-200 ring-1 ring-parchment-300">
        {coverUrl && <img src={coverUrl} alt={title} className="w-full h-full object-cover" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink-900 truncate">{title}</p>
        <p className="text-xs text-ink-400">{formatDuration(seconds)} · {pages} pages</p>
      </div>
    </Link>
  );
}
