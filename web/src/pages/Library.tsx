import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { books as booksApi, search as searchApi, library } from '../lib/api';
import BookCard from '../components/BookCard';
import BookListItem from '../components/BookListItem';

export default function Library() {
  const [searchParams] = useSearchParams();
  const queryParam = searchParams.get('query') || '';
  const [searchQuery, setSearchQuery] = useState(queryParam);
  const [sortBy, setSortBy] = useState('title');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    const saved = localStorage.getItem('library-view');
    return saved === 'list' ? 'list' : 'grid';
  });
  const [selectedAuthor, setSelectedAuthor] = useState<string>('');

  const { data: authorsData } = useQuery({
    queryKey: ['authors'],
    queryFn: () => library.authors(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['books', searchQuery, sortBy, selectedAuthor],
    queryFn: async () => {
      if (searchQuery) {
        const response = await searchApi.quick(searchQuery);
        return { books: response.data, total: response.data.length };
      }
      const response = await booksApi.getAll({ limit: 100, offset: 0 });
      return response.data;
    },
  });

  const books = (data?.books || []).filter(() => {
    if (!selectedAuthor) return true;
    // This will be filtered on backend ideally, but for now filter client-side
    return true; // Backend doesn't support author filter yet
  });

  const total = books.length;
  const authors = authorsData?.data || [];

  useEffect(() => {
    localStorage.setItem('library-view', viewMode);
  }, [viewMode]);

  useEffect(() => {
    setSearchQuery(queryParam);
  }, [queryParam]);

  return (
    <div className="min-h-screen bg-obsidian-950">
      {/* Header */}
      <div className="bg-obsidian-900/50 border-b border-obsidian-800/30 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-serif font-bold text-white">Library</h1>
              <p className="text-xs text-obsidian-500 mt-0.5">
                {total} {total === 1 ? 'book' : 'books'}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Search - Compact */}
              <div className="relative w-48">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-obsidian-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-obsidian-900/50 border border-obsidian-700/50 rounded-lg text-sm text-white placeholder-obsidian-600 focus:outline-none focus:ring-1 focus:ring-polaris-600/50 focus:border-polaris-600/50 focus:bg-obsidian-900/80 transition-all duration-250 ease-soft"
                />
              </div>

              {/* Filters - Compact */}
              {authors.length > 0 && (
                <select
                  value={selectedAuthor}
                  onChange={(e) => setSelectedAuthor(e.target.value)}
                  className="px-3 py-1.5 bg-obsidian-900/50 border border-obsidian-700/50 rounded-lg text-sm text-obsidian-300 focus:outline-none focus:ring-1 focus:ring-polaris-600/50 transition-all duration-250 ease-soft"
                >
                  <option value="">All Authors</option>
                  {authors.map((author: any) => (
                    <option key={author.id} value={author.id}>
                      {author.name}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-1.5 bg-obsidian-900/50 border border-obsidian-700/50 rounded-lg text-sm text-obsidian-300 focus:outline-none focus:ring-1 focus:ring-polaris-600/50 transition-all duration-250 ease-soft"
              >
                <option value="title">Title</option>
                <option value="created_at">Recently Added</option>
                <option value="published_date">Publication Date</option>
              </select>

              {/* View Mode Toggle */}
              <div className="flex items-center gap-1 bg-obsidian-900/50 rounded-lg p-0.5 border border-obsidian-700/50">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded transition-all duration-250 ease-soft ${
                    viewMode === 'grid'
                      ? 'bg-polaris-600 text-white'
                      : 'text-obsidian-500 hover:text-obsidian-300'
                  }`}
                  title="Grid view"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded transition-all duration-250 ease-soft ${
                    viewMode === 'list'
                      ? 'bg-polaris-600 text-white'
                      : 'text-obsidian-500 hover:text-obsidian-300'
                  }`}
                  title="List view"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        {isLoading ? (
          <LoadingState viewMode={viewMode} />
        ) : books.length === 0 ? (
          <EmptyState searchQuery={searchQuery} />
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {books.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {books.map((book) => (
              <BookListItem key={book.id} book={book} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingState({ viewMode }: { viewMode: 'grid' | 'list' }) {
  if (viewMode === 'list') {
    return (
      <div className="space-y-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="animate-pulse bg-zinc-800 rounded-lg p-4 h-32" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
      {[...Array(12)].map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-[2/3] bg-zinc-800 rounded-lg" />
          <div className="mt-2 h-4 bg-zinc-800 rounded" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ searchQuery }: { searchQuery: string }) {
  return (
    <div className="text-center py-16">
      <svg className="w-24 h-24 text-zinc-700 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <h3 className="text-xl font-semibold text-white mb-2">
        {searchQuery ? 'No books found' : 'No books yet'}
      </h3>
      <p className="text-zinc-400">
        {searchQuery ? `No results for "${searchQuery}"` : 'Start adding books to your library'}
      </p>
      {searchQuery && (
        <div className="mt-6">
          <Link
            to="/admin"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-polaris-600 text-white text-sm rounded-lg hover:bg-polaris-700 transition-all duration-350 ease-soft group"
          >
            <span className="font-semibold">Add books</span>
            <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-250 ease-soft" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}
    </div>
  );
}
