import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { library } from '../lib/api';
import BookCard from '../components/BookCard';

export default function AuthorDetail() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['author', id],
    queryFn: () => library.authorById(id!),
    enabled: !!id,
  });

  const author = data?.data;
  const books = author?.books || [];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ember-500" />
      </div>
    );
  }

  if (!author) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-ink-500 mb-4">Author not found.</p>
          <Link to="/authors" className="text-ember-600 hover:underline">Back to Authors</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="bg-parchment-50/80 border-b border-parchment-300 sticky top-0 z-10 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex items-center gap-3">
            <Link to="/authors" className="text-ink-400 hover:text-ink-700 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl font-serif font-bold text-ink-900">{author.name}</h1>
              <p className="text-xs text-ink-400 mt-0.5">
                {books.length} {books.length === 1 ? 'book' : 'books'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {author.bio && (
          <p className="text-ink-600 mb-8 max-w-2xl leading-relaxed">{author.bio}</p>
        )}

        {books.length === 0 ? (
          <p className="text-ink-400">No books found for this author.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {books.map((book: any) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
