import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { books as booksApi } from '../lib/api';
import EpubReader from '../components/EpubReader';
import PdfReader from '../components/PdfReader';

export default function Reader() {
  const { bookId, fileId } = useParams<{ bookId: string; fileId: string }>();

  const { data: book, isLoading } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => booksApi.getById(bookId!),
    enabled: !!bookId,
  });

  if (isLoading) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
          <p className="text-zinc-400">Loading book...</p>
        </div>
      </div>
    );
  }

  if (!book?.data || !fileId) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400">Book not found</p>
        </div>
      </div>
    );
  }

  const bookFile = book.data.files?.find((f) => f.id === fileId);

  if (!bookFile) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400">File not found</p>
        </div>
      </div>
    );
  }

  const fileUrl = booksApi.getFile(bookId!, fileId);

  return (
    <div className="h-screen bg-zinc-950">
      {bookFile.format === 'EPUB' ? (
        <EpubReader
          bookId={bookId!}
          fileId={fileId}
          fileUrl={fileUrl}
          title={book.data.title}
        />
      ) : (
        <PdfReader
          bookId={bookId!}
          fileId={fileId}
          fileUrl={fileUrl}
          title={book.data.title}
        />
      )}
    </div>
  );
}
