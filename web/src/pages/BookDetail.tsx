import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { books as booksApi } from '../lib/api';
import { useAuthenticatedImage } from '../hooks/useAuthenticatedImage';
import type { SeriesContextItem } from '../types';

export default function BookDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: book, isLoading } = useQuery({
    queryKey: ['book', id],
    queryFn: () => booksApi.getById(id!),
    enabled: !!id,
  });

  // Prepare cover URL (must be before early returns due to hooks rules)
  const bookData = book?.data;
  const coverApiUrl = bookData?.cover_path ? booksApi.getCover(bookData.id, false) : null;
  const coverUrl = useAuthenticatedImage(coverApiUrl);

  if (isLoading) {
    return <LoadingState />;
  }

  if (!bookData) {
    return <ErrorState />;
  }

  const primaryFile = bookData.files?.[0];
  const seriesEnabled = import.meta.env.VITE_SERIES_SECTION !== 'false';
  const seriesContext = bookData.series_context;
  const seriesName = seriesContext?.series_name || bookData.series_name || bookData.series?.name || null;
  const seriesTotal = seriesContext?.total ?? bookData.series_total ?? null;
  const seriesEntries = seriesContext?.items || [];
  const showSeriesSection = seriesEnabled && seriesName && seriesEntries.length >= 2;

  const handleBack = () => {
    const referrer = document.referrer;
    if (referrer && referrer.includes(window.location.origin)) {
      navigate(-1);
      return;
    }
    navigate('/library');
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Hero Section with Background */}
      <div className="relative">
        {/* Blurred Background */}
        {coverUrl && (
          <div className="absolute inset-0 overflow-hidden">
            <div
              className="absolute inset-0 bg-cover bg-center blur-3xl opacity-20"
              style={{ backgroundImage: `url(${coverUrl})` }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/50 via-zinc-950/80 to-zinc-950" />
          </div>
        )}

        {/* Content */}
        <div className="relative max-w-7xl mx-auto px-8 py-12">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center text-zinc-500 hover:text-zinc-300 transition-all duration-250 ease-soft group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            aria-label="Back"
            title="Back"
          >
            <svg className="w-4 h-4 transition-transform duration-250 group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>

          <div className="flex flex-col md:flex-row gap-8">
            {/* Cover */}
            <div className="flex-shrink-0">
              <div className="relative w-64 aspect-[2/3] bg-zinc-800 rounded-xl overflow-hidden shadow-2xl">
                <div className="absolute -inset-2 bg-blue-500/10 blur-2xl opacity-60" aria-hidden="true" />
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt={bookData.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-800">
                    <svg className="w-24 h-24 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                )}
              </div>
            </div>

            {/* Info */}
            <div className="flex-1">
              <h1 className="text-4xl font-bold text-white mb-2">{bookData.title}</h1>
              {bookData.subtitle && (
                <h2 className="text-xl text-zinc-400 mb-4">{bookData.subtitle}</h2>
              )}

              {/* Authors */}
              {bookData.authors && bookData.authors.length > 0 && (
                <div className="flex items-center space-x-2 mb-4">
                  <span className="text-zinc-400">by</span>
                  <div className="flex items-center space-x-2">
                    {bookData.authors.map((author, index) => (
                      <span key={author.id} className="text-blue-400 hover:text-blue-300">
                        {author.name}
                        {index < bookData.authors.length - 1 && ', '}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="flex flex-wrap gap-4 mb-6">
                {bookData.published_date && (
                  <Metadata
                    icon="📅"
                    label="Published"
                    value={new Date(bookData.published_date).getFullYear().toString()}
                  />
                )}
                {bookData.publisher && (
                  <Metadata icon="🏢" label="Publisher" value={bookData.publisher} />
                )}
                {bookData.page_count && (
                  <Metadata icon="📄" label="Pages" value={bookData.page_count.toString()} />
                )}
                {bookData.language && (
                  <Metadata icon="🌐" label="Language" value={bookData.language.toUpperCase()} />
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3 mb-8">
                {primaryFile && (
                  <Link
                    to={`/read/${bookData.id}/${primaryFile.id}`}
                    className="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-all duration-350 ease-soft hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(37,99,235,0.35)] active:translate-y-0"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    Read Now
                  </Link>
                )}
                {primaryFile && (
                  <button
                    type="button"
                    onClick={() =>
                      booksApi
                        .download(
                          bookData.id,
                          primaryFile.id,
                          `${bookData.title}.${primaryFile.format.toLowerCase()}`
                        )
                        .catch((err) => console.error('Download failed:', err))
                    }
                    className="inline-flex items-center px-6 py-3 bg-zinc-700 hover:bg-zinc-600 text-white font-semibold rounded-lg transition-colors duration-250 group"
                  >
                    <svg className="w-5 h-5 mr-2 transition-transform duration-250 group-hover:translate-y-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </button>
                )}
              </div>

              {/* Description */}
              {bookData.description && (
                <div className="bg-zinc-900/50 rounded-xl p-6 border border-zinc-800">
                  <h3 className="text-lg font-semibold text-white mb-3">Description</h3>
                  <p className="text-zinc-300 leading-relaxed">{bookData.description}</p>
                </div>
              )}

              {/* Additional Info */}
              <div className="mt-6 grid grid-cols-2 gap-4">
                {bookData.isbn_13 && (
                  <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
                    <div className="text-xs text-zinc-500 mb-1">ISBN-13</div>
                    <div className="text-zinc-300 text-sm font-mono">{bookData.isbn_13}</div>
                  </div>
                )}
                {primaryFile && (
                  <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
                    <div className="text-sm text-zinc-400 mb-1">Format</div>
                    <div className="text-white font-semibold">{primaryFile.format}</div>
                  </div>
                )}
              </div>

              {showSeriesSection && (
                <div className="mt-10">
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-zinc-200">{seriesName}</h3>
                    <p className="text-xs text-zinc-500">
                      Series{seriesTotal ? ` • ${seriesTotal} ${seriesTotal === 1 ? 'book' : 'books'}` : ''}
                    </p>
                  </div>

                  <div className="flex overflow-x-auto gap-4 pb-2 scrollbar-hide snap-x snap-mandatory">
                    {seriesEntries.slice(0, 6).map((entry) => (
                      <SeriesBookCard
                        key={`${entry.library_book_id || entry.title}`}
                        entry={entry}
                        currentBookId={bookData.id}
                        onAcquire={(query) => navigate(`/library?query=${encodeURIComponent(query)}`)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SeriesBookCard({
  entry,
  currentBookId,
  onAcquire,
}: {
  entry: SeriesContextItem;
  currentBookId: string;
  onAcquire: (query: string) => void;
}) {
  const isInLibrary = entry.in_library && !!entry.library_book_id;
  const isCurrent = entry.library_book_id === currentBookId;
  const coverApiUrl = isInLibrary
    ? booksApi.getCover(entry.library_book_id!, true)
    : null;
  const libraryCoverUrl = useAuthenticatedImage(coverApiUrl);
  const coverUrl = isInLibrary ? libraryCoverUrl : entry.coverUrl || null;
  const orderLabel = entry.position != null ? `Book ${entry.position}` : 'Book';

  const CardBody = (
    <div className="w-24 flex-none snap-start">
      <div className="aspect-[2/3] rounded-lg overflow-hidden bg-zinc-800 shadow-[0_6px_20px_rgba(0,0,0,0.35)] transition-transform duration-250 ease-soft group-hover:-translate-y-1">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={entry.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-800">
            <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
        )}
      </div>

      <div className="mt-2">
        <p className="text-xs text-zinc-200 line-clamp-2">{entry.title}</p>
        <p className="text-[10px] text-zinc-500 mt-0.5">{orderLabel}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isInLibrary ? 'bg-emerald-500/70' : 'bg-zinc-500/70'
            }`}
            aria-hidden="true"
          />
          <span>{isInLibrary ? 'In library' : 'Not in library'}</span>
        </div>
        {entry.position == null && (
          <p className="text-[10px] text-zinc-600 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-250 ease-soft">
            Unknown order
          </p>
        )}
      </div>
    </div>
  );

  if (!isInLibrary) {
    const query = entry.acquire?.query || entry.title;
    return (
      <button
        type="button"
        onClick={() => onAcquire(query)}
        className="group opacity-70 text-left"
      >
        {CardBody}
      </button>
    );
  }

  if (isCurrent) {
    return <div className="group opacity-90">{CardBody}</div>;
  }

  return (
    <Link to={`/books/${entry.library_book_id}`} className="group">
      {CardBody}
    </Link>
  );
}

function Metadata({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center space-x-2 text-sm">
      <span className="text-xl">{icon}</span>
      <div>
        <span className="text-zinc-500">{label}:</span>
        <span className="text-white ml-1">{value}</span>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
        <p className="text-zinc-400">Loading book...</p>
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="text-center">
        <svg className="w-24 h-24 text-zinc-700 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h2 className="text-2xl font-bold text-white mb-2">Book not found</h2>
        <p className="text-zinc-400 mb-6">The book you're looking for doesn't exist</p>
        <Link
          to="/library"
          className="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
        >
          Back to Library
        </Link>
      </div>
    </div>
  );
}
