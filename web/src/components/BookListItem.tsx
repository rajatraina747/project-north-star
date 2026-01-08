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
      className="group block bg-zinc-900/50 hover:bg-zinc-800/50 rounded-lg border border-zinc-800 hover:border-zinc-700 transition"
    >
      <div className="flex items-center p-4 gap-4">
        {/* Cover */}
        <div className="flex-shrink-0 w-20 h-30 bg-zinc-800 rounded overflow-hidden">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={book.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-800">
              <svg className="w-8 h-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-white group-hover:text-blue-400 transition line-clamp-1">
            {book.title}
          </h3>
          {book.subtitle && (
            <p className="text-sm text-zinc-500 line-clamp-1 mt-0.5">{book.subtitle}</p>
          )}
          {book.description && (
            <p className="text-sm text-zinc-400 line-clamp-2 mt-2">
              {book.description}
            </p>
          )}
        </div>

        {/* Metadata */}
        <div className="hidden md:flex items-center space-x-8 text-sm text-zinc-400">
          {book.published_date && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">Year</div>
              <div className="text-white">{new Date(book.published_date).getFullYear()}</div>
            </div>
          )}
          {book.page_count && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">Pages</div>
              <div className="text-white">{book.page_count}</div>
            </div>
          )}
        </div>

        {/* Play Icon */}
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
          <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>
    </Link>
  );
}
