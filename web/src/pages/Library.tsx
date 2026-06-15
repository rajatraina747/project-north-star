import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { search as searchApi, library, shelf as shelfApi } from '../lib/api';
import type { SearchParams } from '../lib/api';
import type { ShelfStatus, BookFormat } from '../types';
import BookCard from '../components/BookCard';
import BookListItem from '../components/BookListItem';

const FORMAT_OPTIONS: BookFormat[] = ['EPUB', 'PDF', 'CBZ', 'MOBI', 'AZW3'];
const SHELF_OPTIONS: { value: ShelfStatus; label: string }[] = [
  { value: 'WANT_TO_READ', label: 'Want to Read' },
  { value: 'READING', label: 'Reading' },
  { value: 'FINISHED', label: 'Finished' },
];

export default function Library() {
  const [searchParams] = useSearchParams();
  const queryParam = searchParams.get('query') || '';
  const tagParam = searchParams.get('tag') || '';
  const shelfParam = (searchParams.get('shelf') || '') as ShelfStatus | '';

  const [searchQuery, setSearchQuery] = useState(queryParam);
  const [sortBy, setSortBy] = useState<NonNullable<SearchParams['sort']>>('title');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    const saved = localStorage.getItem('library-view');
    return saved === 'list' ? 'list' : 'grid';
  });

  // Filters
  const [selectedAuthor, setSelectedAuthor] = useState<string>('');
  const [selectedSeries, setSelectedSeries] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>(tagParam ? [tagParam] : []);
  const [selectedFormats, setSelectedFormats] = useState<BookFormat[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [selectedShelf, setSelectedShelf] = useState<ShelfStatus | ''>(shelfParam);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    setSelectedShelf(shelfParam);
  }, [shelfParam]);

  const hasActiveFilters =
    !!selectedAuthor || !!selectedSeries || selectedTags.length > 0 ||
    selectedFormats.length > 0 || !!selectedLanguage || !!selectedShelf;

  const clearFilters = () => {
    setSelectedAuthor('');
    setSelectedSeries('');
    setSelectedTags([]);
    setSelectedFormats([]);
    setSelectedLanguage('');
    setSelectedShelf('');
  };

  const { data: authorsData } = useQuery({
    queryKey: ['authors'],
    queryFn: () => library.authors(),
  });
  const { data: seriesData } = useQuery({
    queryKey: ['series'],
    queryFn: () => library.series(),
  });
  const { data: tagsData } = useQuery({
    queryKey: ['tags'],
    queryFn: () => library.tags(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['books', searchQuery, sortBy, selectedAuthor, selectedSeries, selectedTags, selectedFormats, selectedLanguage],
    queryFn: async () => {
      const filters: SearchParams['filters'] = {};
      if (selectedAuthor) filters.authors = [selectedAuthor];
      if (selectedSeries) filters.series = [selectedSeries];
      if (selectedTags.length > 0) filters.tags = selectedTags;
      if (selectedFormats.length > 0) filters.formats = selectedFormats;
      if (selectedLanguage) filters.language = selectedLanguage;

      const response = await searchApi.search({
        query: searchQuery || '',
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        sort: sortBy,
        limit: 100,
        offset: 0,
      });
      return response.data;
    },
  });

  // Shelf filtering is per-user and served by a dedicated endpoint, so when a
  // shelf is selected we source the list from there and apply the text search
  // client-side (other column filters don't apply to shelves).
  const { data: shelfData, isLoading: shelfLoading } = useQuery({
    queryKey: ['shelf', selectedShelf],
    queryFn: async () => (await shelfApi.list(selectedShelf as ShelfStatus)).data,
    enabled: !!selectedShelf,
  });

  let books = data?.books || [];
  if (selectedShelf) {
    const q = searchQuery.trim().toLowerCase();
    books = (shelfData || []).filter(
      (b) => !q || b.title.toLowerCase().includes(q) || (b.authors || []).some((a) => a.name.toLowerCase().includes(q))
    );
  }
  const total = selectedShelf ? books.length : (data?.total ?? books.length);
  const authors = authorsData?.data || [];
  const seriesList = seriesData?.data || [];
  const tags = tagsData?.data || [];

  useEffect(() => {
    localStorage.setItem('library-view', viewMode);
  }, [viewMode]);

  useEffect(() => {
    setSearchQuery(queryParam);
  }, [queryParam]);

  useEffect(() => {
    if (tagParam) setSelectedTags([tagParam]);
  }, [tagParam]);

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  };

  const toggleFormat = (fmt: BookFormat) => {
    setSelectedFormats((prev) =>
      prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt]
    );
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="bg-parchment-50/80 border-b border-parchment-300 sticky top-0 z-10 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-serif font-bold text-ink-900">Library</h1>
              <p className="text-xs text-ink-400 mt-0.5">
                {total} {total === 1 ? 'book' : 'books'}
                {hasActiveFilters && <span className="text-ember-500"> · filtered</span>}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative w-48">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-ink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-parchment-100 border border-parchment-300 rounded-lg text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-1 focus:ring-ember-500/60 focus:border-ember-500/60 transition-all duration-250 ease-soft"
                />
              </div>

              {/* Filter toggle */}
              <button
                type="button"
                onClick={() => setFilterOpen((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all duration-200 ${
                  filterOpen || hasActiveFilters
                    ? 'bg-ember-500 text-cream border-ember-500'
                    : 'bg-parchment-100 border-parchment-300 text-ink-600 hover:bg-parchment-200'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
                </svg>
                Filters
                {hasActiveFilters && (
                  <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold bg-cream text-ember-600 rounded-full">
                    {[selectedAuthor, selectedSeries, selectedLanguage, selectedShelf].filter(Boolean).length + selectedTags.length + selectedFormats.length}
                  </span>
                )}
              </button>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as NonNullable<SearchParams['sort']>)}
                className="px-3 py-1.5 bg-parchment-100 border border-parchment-300 rounded-lg text-sm text-ink-600 focus:outline-none focus:ring-1 focus:ring-ember-500/60 transition-all duration-250 ease-soft"
              >
                <option value="title">Title</option>
                <option value="author">Author</option>
                <option value="added">Recently Added</option>
              </select>

              {/* View Mode Toggle */}
              <div className="flex items-center gap-1 bg-parchment-100 rounded-lg p-0.5 border border-parchment-300">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded transition-all duration-250 ease-soft ${
                    viewMode === 'grid'
                      ? 'bg-ember-500 text-cream'
                      : 'text-ink-400 hover:text-ink-700'
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
                      ? 'bg-ember-500 text-cream'
                      : 'text-ink-400 hover:text-ink-700'
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

          {/* Filter Panel */}
          {filterOpen && (
            <div className="mt-4 pt-4 border-t border-parchment-300 space-y-4">
              <div className="flex flex-wrap gap-4">
                {/* Shelf */}
                <div className="flex-shrink-0">
                  <p className="text-xs font-semibold text-ink-500 mb-2 uppercase tracking-wide">Shelf</p>
                  <div className="flex gap-2">
                    {SHELF_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSelectedShelf((prev) => (prev === opt.value ? '' : opt.value))}
                        className={`px-3 py-1 text-xs font-medium rounded-full border transition-all duration-150 ${
                          selectedShelf === opt.value
                            ? 'bg-ember-500 text-cream border-ember-500'
                            : 'bg-parchment-100 text-ink-600 border-parchment-300 hover:bg-parchment-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Format */}
                <div className="flex-shrink-0">
                  <p className="text-xs font-semibold text-ink-500 mb-2 uppercase tracking-wide">Format</p>
                  <div className="flex gap-2">
                    {FORMAT_OPTIONS.map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => toggleFormat(fmt)}
                        className={`px-3 py-1 text-xs font-medium rounded-full border transition-all duration-150 ${
                          selectedFormats.includes(fmt)
                            ? 'bg-ember-500 text-cream border-ember-500'
                            : 'bg-parchment-100 text-ink-600 border-parchment-300 hover:bg-parchment-200'
                        }`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Author */}
                {authors.length > 0 && (
                  <div className="flex-shrink-0">
                    <p className="text-xs font-semibold text-ink-500 mb-2 uppercase tracking-wide">Author</p>
                    <select
                      value={selectedAuthor}
                      onChange={(e) => setSelectedAuthor(e.target.value)}
                      className="px-3 py-1.5 bg-parchment-100 border border-parchment-300 rounded-lg text-sm text-ink-600 focus:outline-none focus:ring-1 focus:ring-ember-500/60 transition-all"
                    >
                      <option value="">All Authors</option>
                      {authors.map((a: any) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Series */}
                {seriesList.length > 0 && (
                  <div className="flex-shrink-0">
                    <p className="text-xs font-semibold text-ink-500 mb-2 uppercase tracking-wide">Series</p>
                    <select
                      value={selectedSeries}
                      onChange={(e) => setSelectedSeries(e.target.value)}
                      className="px-3 py-1.5 bg-parchment-100 border border-parchment-300 rounded-lg text-sm text-ink-600 focus:outline-none focus:ring-1 focus:ring-ember-500/60 transition-all"
                    >
                      <option value="">All Series</option>
                      {seriesList.map((s: any) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Language */}
                <div className="flex-shrink-0">
                  <p className="text-xs font-semibold text-ink-500 mb-2 uppercase tracking-wide">Language</p>
                  <select
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value)}
                    className="px-3 py-1.5 bg-parchment-100 border border-parchment-300 rounded-lg text-sm text-ink-600 focus:outline-none focus:ring-1 focus:ring-ember-500/60 transition-all"
                  >
                    <option value="">Any Language</option>
                    <option value="en">English</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="es">Spanish</option>
                    <option value="it">Italian</option>
                    <option value="pt">Portuguese</option>
                    <option value="ja">Japanese</option>
                    <option value="zh">Chinese</option>
                  </select>
                </div>
              </div>

              {/* Tags */}
              {tags.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ink-500 mb-2 uppercase tracking-wide">Tags</p>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag: any) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className={`px-3 py-1 text-xs font-medium rounded-full border transition-all duration-150 ${
                          selectedTags.includes(tag.id)
                            ? 'bg-ember-500 text-cream border-ember-500'
                            : 'bg-parchment-100 text-ink-600 border-parchment-300 hover:bg-parchment-200'
                        }`}
                      >
                        {tag.name}
                        {tag.book_count != null && (
                          <span className="ml-1 opacity-60">({tag.book_count})</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs text-ember-600 hover:text-ember-700 underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Active filter chips (when panel is closed) */}
      {!filterOpen && hasActiveFilters && (
        <div className="max-w-7xl mx-auto px-8 pt-4 flex flex-wrap gap-2 items-center">
          {selectedShelf && (
            <FilterChip
              label={SHELF_OPTIONS.find((o) => o.value === selectedShelf)?.label || 'Shelf'}
              onRemove={() => setSelectedShelf('')}
            />
          )}
          {selectedFormats.map((fmt) => (
            <FilterChip key={fmt} label={fmt} onRemove={() => toggleFormat(fmt)} />
          ))}
          {selectedAuthor && (
            <FilterChip
              label={authors.find((a: any) => a.id === selectedAuthor)?.name || 'Author'}
              onRemove={() => setSelectedAuthor('')}
            />
          )}
          {selectedSeries && (
            <FilterChip
              label={seriesList.find((s: any) => s.id === selectedSeries)?.name || 'Series'}
              onRemove={() => setSelectedSeries('')}
            />
          )}
          {selectedTags.map((tid) => {
            const t = tags.find((t: any) => t.id === tid);
            return <FilterChip key={tid} label={t?.name || 'Tag'} onRemove={() => toggleTag(tid)} />;
          })}
          {selectedLanguage && (
            <FilterChip label={selectedLanguage.toUpperCase()} onRemove={() => setSelectedLanguage('')} />
          )}
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-ink-400 hover:text-ember-600 ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        {(selectedShelf ? shelfLoading : isLoading) ? (
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

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-ember-500/10 text-ember-700 border border-ember-500/30 rounded-full">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 text-ember-500 hover:text-ember-700"
        aria-label={`Remove ${label} filter`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

function LoadingState({ viewMode }: { viewMode: 'grid' | 'list' }) {
  if (viewMode === 'list') {
    return (
      <div className="space-y-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="animate-pulse bg-parchment-200 rounded-lg p-4 h-32" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
      {[...Array(12)].map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-[2/3] bg-parchment-200 rounded-xl" />
          <div className="mt-2 h-4 bg-parchment-200 rounded" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ searchQuery }: { searchQuery: string }) {
  return (
    <div className="text-center py-16">
      <svg className="w-24 h-24 text-parchment-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <h3 className="text-xl font-serif font-semibold text-ink-900 mb-2">
        {searchQuery ? 'No books found' : 'No books yet'}
      </h3>
      <p className="text-ink-500">
        {searchQuery ? `No results for "${searchQuery}"` : 'Start adding books to your library'}
      </p>
      {searchQuery && (
        <div className="mt-6">
          <Link
            to="/admin"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-ember-500 text-cream text-sm rounded-lg hover:bg-ember-600 transition-all duration-350 ease-soft group"
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
