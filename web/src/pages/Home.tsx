import { useQuery } from '@tanstack/react-query';
import { books as booksApi } from '../lib/api';
import BookCard from '../components/BookCard';
import { Link } from 'react-router-dom';
import { getAllLocalProgress } from '../lib/readerProgress';

export default function Home() {
  const { data: continueReading } = useQuery({
    queryKey: ['continue-reading'],
    queryFn: () => booksApi.getContinueReading(6),
  });

  const { data: recentBooks } = useQuery({
    queryKey: ['recent-books'],
    queryFn: async () => {
      const response = await booksApi.getAll({ limit: 12, offset: 0 });
      return response.data.books;
    },
  });

  const localProgress = getAllLocalProgress();
  const localByBook = new Map<string, typeof localProgress[number]>();
  for (const entry of localProgress) {
    if (entry.percent <= 0 || entry.percent >= 100) continue;
    const existing = localByBook.get(entry.bookId);
    if (!existing) {
      localByBook.set(entry.bookId, entry);
      continue;
    }
    const existingTime = Date.parse(existing.updatedAt) || 0;
    const entryTime = Date.parse(entry.updatedAt) || 0;
    if (entryTime > existingTime) {
      localByBook.set(entry.bookId, entry);
    }
  }

  const serverItems = continueReading?.data ?? [];
  const serverMap = new Map(serverItems.map((item) => [item.book.id, item.progress]));
  const mergedItems = serverItems.map((item) => {
    const local = localByBook.get(item.book.id);
    if (!local) return item;
    const localTime = Date.parse(local.updatedAt) || 0;
    const serverTime = Date.parse(item.progress?.last_read_at || '') || 0;
    if (localTime <= serverTime) return item;
    return {
      book: item.book,
      progress: {
        ...item.progress,
        progress_percent: local.percent,
        last_read_at: local.updatedAt,
      },
    };
  });

  const localOnlyItems = (recentBooks ?? [])
    .filter((book) => localByBook.has(book.id) && !serverMap.has(book.id))
    .map((book) => {
      const local = localByBook.get(book.id)!;
      return {
        book,
        progress: {
          progress_percent: local.percent,
          last_read_at: local.updatedAt,
        },
      };
    });

  const continueItems = [...localOnlyItems, ...mergedItems].sort((a, b) => {
    const aTime = Date.parse(a.progress?.last_read_at || '') || 0;
    const bTime = Date.parse(b.progress?.last_read_at || '') || 0;
    return bTime - aTime;
  }).slice(0, 6);

  const hasProgress = continueItems.length > 0;
  const hasBooks = recentBooks && recentBooks.length > 0;

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-8 py-8 space-y-12">
        {/* Continue Reading - Hero Section */}
        {hasProgress ? (
          <section className="space-y-4">
            <div>
              <h1 className="text-3xl font-serif font-bold text-ink-900 mb-1 tracking-tight">
                Continue Reading
              </h1>
              <p className="text-sm text-ink-500">
                Pick up where you left off
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-5">
              {continueItems.map((item) => (
                <div key={item.book.id} className="animate-fadeIn">
                  <BookCard book={item.book} progress={item.progress} showProgress={true} />
                </div>
              ))}
            </div>
          </section>
        ) : hasBooks ? (
          <section className="space-y-6 pt-4">
            <div className="text-center max-w-md mx-auto">
              <h1 className="text-3xl font-serif font-bold text-ink-900 mb-2 tracking-tight">
                Start something new
              </h1>
              <p className="text-sm text-ink-500">
                Your library awaits
              </p>
            </div>

            {/* Featured Book - First book as hero with warm glow */}
            <div className="relative max-w-[200px] mx-auto">
              {/* Subtle radial glow behind cover */}
              <div className="absolute inset-0 -z-10 scale-110 opacity-40">
                <div className="absolute inset-0 bg-gradient-radial from-ember-500/20 via-ember-500/5 to-transparent blur-2xl" />
              </div>

              <BookCard book={recentBooks[0]} />
              <Link
                to={`/books/${recentBooks[0].id}`}
                className="mt-4 w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-ember-500 to-ember-600 text-cream text-sm font-semibold rounded-lg hover:from-ember-600 hover:to-ember-700 hover:shadow-warm-lg hover:scale-[1.02] transition-all duration-350 ease-soft group active:scale-100 cta-float"
              >
                <span>Start Reading</span>
                <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-250 ease-soft" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </Link>
            </div>
          </section>
        ) : (
          <EmptyLibraryState />
        )}

        {/* Recently Added - Only show if there are books beyond the first */}
        {hasBooks && recentBooks.length > 1 && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-serif font-bold text-ink-900">Recently Added</h2>
                <p className="text-ink-500 mt-1">New to your library</p>
              </div>
              <Link
                to="/library"
                className="text-sm text-ember-600 hover:text-ember-700 transition-colors duration-250 ease-soft flex items-center gap-1 group"
              >
                <span>Browse all</span>
                <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-250 ease-soft" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            <div className="flex overflow-x-auto gap-6 pb-4 scrollbar-hide -mx-8 px-8">
              {recentBooks.slice(hasProgress ? 0 : 1).map((book) => (
                <div key={book.id} className="flex-none w-44">
                  <BookCard book={book} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function EmptyLibraryState() {
  return (
    <div className="text-center py-12 max-w-md mx-auto">
      <svg className="w-20 h-20 text-parchment-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
      <h1 className="text-2xl font-serif font-bold text-ink-900 mb-2">Your library is empty</h1>
      <p className="text-sm text-ink-500 mb-5">
        Add your first book to begin your reading journey
      </p>
      <Link
        to="/admin"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-ember-500 text-cream text-sm rounded-lg hover:bg-ember-600 transition-all duration-350 ease-soft group"
      >
        <span className="font-semibold">Add Books</span>
        <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-250 ease-soft" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  );
}
