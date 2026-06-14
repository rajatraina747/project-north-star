import { Link } from 'react-router-dom';
import type { Book, ReadingProgress as ReadingProgressType } from '../types';
import { books } from '../lib/api';
import { useAuthenticatedImage } from '../hooks/useAuthenticatedImage';
import ReadingProgress from './ReadingProgress';

interface BookCardProps {
  book: Book;
  progress?: Pick<ReadingProgressType, 'progress_percent' | 'last_read_at'>;
  showProgress?: boolean;
}

export default function BookCard({ book, progress, showProgress = false }: BookCardProps) {
  const coverApiUrl = book.cover_path
    ? books.getCover(book.id, true)
    : null;

  const coverUrl = useAuthenticatedImage(coverApiUrl);

  // Get primary file format
  const primaryFormat = book.files?.[0]?.format;

  return (
    <Link
      to={`/books/${book.id}`}
      className="group block"
    >
      <div className="relative aspect-[2/3] bg-obsidian-800 rounded-xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.4)] transition-all duration-350 ease-soft group-hover:shadow-[0_24px_72px_rgba(0,110,199,0.2),0_0_0_1px_rgba(0,110,199,0.1)] group-hover:-translate-y-3 group-hover:scale-[1.02]">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={book.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-br from-obsidian-700 to-obsidian-800">
            <svg className="w-12 h-12 text-obsidian-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-xs text-obsidian-400 font-medium line-clamp-3">{book.title}</p>
          </div>
        )}

        {/* Format Badge */}
        {primaryFormat && (
          <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md">
            <span className="text-[10px] font-semibold text-white/90 uppercase tracking-wide">
              {primaryFormat}
            </span>
          </div>
        )}

        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-obsidian-950/90 via-obsidian-950/0 to-obsidian-950/0 opacity-0 group-hover:opacity-100 transition-opacity duration-350 ease-soft">
          <div className="absolute bottom-0 left-0 right-0 p-3">
            <div className="flex items-center justify-center text-polaris-400">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Subtle shine effect on hover */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ease-soft bg-gradient-to-tr from-transparent via-polaris-500/5 to-transparent" />
      </div>

      {/* Book Info */}
      <div className="mt-3">
        <h3 className="text-sm font-medium text-white line-clamp-2 group-hover:text-polaris-400 transition-colors duration-250 ease-soft">
          {book.title}
        </h3>
        {book.authors && book.authors.length > 0 && (
          <p className="text-xs text-obsidian-400 line-clamp-1 mt-0.5">
            {book.authors.map((a) => a.name).join(', ')}
          </p>
        )}
        {book.subtitle && (
          <p className="text-xs text-obsidian-500 line-clamp-1 mt-0.5">{book.subtitle}</p>
        )}

        {/* Reading Progress */}
        {showProgress && progress && (
          <div className="mt-3">
            <ReadingProgress
              progress={progress.progress_percent}
              lastRead={progress.last_read_at}
              showPercentage={true}
              showLastRead={true}
              size="sm"
            />
          </div>
        )}
      </div>
    </Link>
  );
}
