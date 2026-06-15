import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { admin, type DuplicateBookSummary } from '../lib/api';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

export default function Duplicates() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['duplicates'],
    queryFn: async () => (await admin.duplicates()).data,
  });

  const total = data ? data.counts.exactHash + data.counts.titleAuthor + data.counts.isbn : 0;

  return (
    <div className="min-h-screen">
      <div className="bg-parchment-100/70 border-b border-parchment-300">
        <div className="max-w-5xl mx-auto px-8 py-6">
          <Link to="/admin" className="text-sm text-ink-400 hover:text-ember-700">← Back to Admin</Link>
          <h1 className="text-3xl font-serif font-bold text-ink-900 mt-2">Duplicate Report</h1>
          <p className="text-ink-500 mt-1">
            Likely duplicates by content hash, title + author, and ISBN. This report is read-only.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-8 space-y-8">
        {isLoading && <p className="text-ink-400 text-center py-10">Analyzing library…</p>}
        {isError && <p className="text-red-700 text-center py-10">Failed to load duplicate report.</p>}

        {data && total === 0 && (
          <div className="text-center py-16">
            <svg className="w-16 h-16 text-green-600/60 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-xl font-serif font-semibold text-ink-900">No duplicates found</h2>
            <p className="text-ink-500 mt-1">Your library looks clean.</p>
          </div>
        )}

        {data && (
          <>
            <Section
              title="Exact file duplicates"
              subtitle="Files with identical content (same hash)"
              count={data.counts.exactHash}
            >
              {data.exactHash.map((g) => (
                <Group key={g.file_hash} heading={<span className="font-mono text-xs">{g.file_hash.slice(0, 16)}…</span>}>
                  {g.files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1">
                      <Link to={`/books/${f.book_id}`} className="text-ember-700 hover:underline truncate">{f.title}</Link>
                      <span className="text-ink-400 text-xs truncate ml-3">{f.format} · {f.file_path}</span>
                    </div>
                  ))}
                </Group>
              ))}
            </Section>

            <Section
              title="Same title & author"
              subtitle="Different book records that share a normalized title and primary author"
              count={data.counts.titleAuthor}
            >
              {data.byTitleAuthor.map((g, i) => (
                <Group key={i} heading={<><span className="font-medium">{g.title}</span>{g.author && <span className="text-ink-400"> · {g.author}</span>}</>}>
                  {g.books.map((b) => <BookLine key={b.id} b={b} />)}
                </Group>
              ))}
            </Section>

            <Section
              title="Same ISBN"
              subtitle="Different book records that share an ISBN-10 or ISBN-13"
              count={data.counts.isbn}
            >
              {data.byIsbn.map((g) => (
                <Group key={g.isbn} heading={<span className="font-mono text-xs">ISBN {g.isbn}</span>}>
                  {g.books.map((b) => <BookLine key={b.id} b={b} />)}
                </Group>
              ))}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, subtitle, count, children }: { title: string; subtitle: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-parchment-100/70 rounded-xl border border-parchment-300 p-6">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-xl font-serif font-semibold text-ink-900">{title}</h2>
        <span className="text-sm text-ink-400">{count} {count === 1 ? 'group' : 'groups'}</span>
      </div>
      <p className="text-sm text-ink-500 mb-4">{subtitle}</p>
      {count === 0 ? (
        <p className="text-sm text-ink-400 italic">None</p>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </div>
  );
}

function Group({ heading, children }: { heading: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="p-3 bg-parchment-50 rounded-lg border border-parchment-300">
      <div className="text-sm text-ink-700 mb-2">{heading}</div>
      <div className="divide-y divide-parchment-200">{children}</div>
    </div>
  );
}

function BookLine({ b }: { b: DuplicateBookSummary }) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5">
      <Link to={`/books/${b.id}`} className="text-ember-700 hover:underline truncate">{b.title}</Link>
      <span className="text-ink-400 text-xs ml-3 flex-shrink-0">
        {b.formats.join(', ') || '—'} · {formatBytes(b.total_size)}
      </span>
    </div>
  );
}
