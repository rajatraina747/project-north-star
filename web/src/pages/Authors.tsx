import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { library } from '../lib/api';

export default function Authors() {
  const { data, isLoading } = useQuery({
    queryKey: ['authors'],
    queryFn: () => library.authors(),
  });

  const authors = data?.data || [];

  return (
    <div className="min-h-screen">
      <div className="bg-parchment-50/80 border-b border-parchment-300 sticky top-0 z-10 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex items-center gap-3">
            <Link to="/library" className="text-ink-400 hover:text-ink-700 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl font-serif font-bold text-ink-900">Authors</h1>
              <p className="text-xs text-ink-400 mt-0.5">{authors.length} authors</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="animate-pulse bg-parchment-200 rounded-xl h-24" />
            ))}
          </div>
        ) : authors.length === 0 ? (
          <div className="text-center py-16 text-ink-400">No authors found.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {authors.map((author: any) => (
              <Link
                key={author.id}
                to={`/authors/${author.id}`}
                className="group bg-parchment-100 border border-parchment-300 rounded-xl px-5 py-4 hover:bg-parchment-200 hover:border-parchment-400 transition-all duration-200 ease-soft"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-ember-400 to-ember-600 rounded-full flex items-center justify-center text-cream text-sm font-bold flex-shrink-0">
                    {(author.sort_name || author.name).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900 truncate group-hover:text-ember-700 transition-colors">
                      {author.name}
                    </p>
                    <p className="text-xs text-ink-400">
                      {author.book_count} {Number(author.book_count) === 1 ? 'book' : 'books'}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
