import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { library } from '../lib/api';

export default function SeriesList() {
  const { data, isLoading } = useQuery({
    queryKey: ['series'],
    queryFn: () => library.series(),
  });

  const seriesList = data?.data || [];

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
              <h1 className="text-2xl font-serif font-bold text-ink-900">Series</h1>
              <p className="text-xs text-ink-400 mt-0.5">{seriesList.length} series</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="animate-pulse bg-parchment-200 rounded-xl h-28" />
            ))}
          </div>
        ) : seriesList.length === 0 ? (
          <div className="text-center py-16 text-ink-400">No series found.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {seriesList.map((s: any) => (
              <Link
                key={s.id}
                to={`/series/${s.id}`}
                className="group bg-parchment-100 border border-parchment-300 rounded-xl px-5 py-4 hover:bg-parchment-200 hover:border-parchment-400 transition-all duration-200 ease-soft"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-ember-400 to-ember-600 rounded-lg flex items-center justify-center text-cream flex-shrink-0">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-900 truncate group-hover:text-ember-700 transition-colors">
                      {s.name}
                    </p>
                    <p className="text-xs text-ink-400 mt-0.5">
                      {s.book_count} {Number(s.book_count) === 1 ? 'book' : 'books'} in library
                    </p>
                    {s.description && (
                      <p className="text-xs text-ink-500 mt-1 line-clamp-2">{s.description}</p>
                    )}
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
