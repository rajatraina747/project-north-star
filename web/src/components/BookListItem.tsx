import { Link } from 'react-router-dom';
import type { Book } from '../types';
import { books } from '../lib/api';
import { useAuthenticatedImage } from '../hooks/useAuthenticatedImage';

interface BookListItemProps {
  book: Book;
}

export default function BookListItem({ book }: BookListItemProps) {
  const coverApiUrl = book.cover_path
    ? books.getCover(book.id, true)
    : null;

  const coverUrl = useAuthenticatedImage(coverApiUrl);

  return (
    <Link
      to={`/books/${book.id}`}
      className="group block bg-parchment-100/60 hover:bg-parchment-100 rounded-xl border border-parchment-300 hover:border-parchment-400 hover:shadow-warm transition-all duration-250 ease-soft"
    >
      <div className="flex items-center p-4 gap-4">
        {/* Cover */}
        <div className="flex-shrink-0 w-20 aspect-[2/3] bg-parchment-200 rounded ring-1 ring-parchment-300 overflow-hidden">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={book.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-parchment-200 to-parchment-300">
              <svg className="w-8 h-8 text-ink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-serif font-semibold text-ink-900 group-hover:text-ember-700 transition line-clamp-1">
            {book.title}
          </h3>
          {book.authors && book.authors.length > 0 && (
            <p className="text-sm text-ink-500 line-clamp-1 mt-0.5">
              {book.authors.map((a) => a.name).join(', ')}
            </p>
          )}
          {book.subtitle && (
            <p className="text-sm text-ink-400 line-clamp-1 mt-0.5">{book.subtitle}</p>
          )}
          {book.description && (
            <p className="text-sm text-ink-500 line-clamp-2 mt-2">
              {book.description}
            </p>
          )}
        </div>

        {/* Metadata */}
        <div className="hidden md:flex items-center space-x-8 text-sm text-ink-500">
          {book.published_date && (
            <div>
              <div className="text-xs text-ink-400 mb-1">Year</div>
              <div className="text-ink-900">{new Date(book.published_date).getFullYear()}</div>
            </div>
          )}
          {book.page_count && (
            <div>
              <div className="text-xs text-ink-400 mb-1">Pages</div>
              <div className="text-ink-900">{book.page_count}</div>
            </div>
          )}
        </div>

        {/* Play Icon */}
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
          <div className="w-12 h-12 bg-ember-500 rounded-full flex items-center justify-center shadow-warm">
            <svg className="w-6 h-6 text-cream ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>
    </Link>
  );
}
