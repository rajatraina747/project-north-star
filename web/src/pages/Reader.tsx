import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { books as booksApi } from '../lib/api';
import EpubReader from '../components/EpubReader';
import PdfReader from '../components/PdfReader';
import ComicReader from '../components/ComicReader';

export default function Reader() {
  const { bookId, fileId } = useParams<{ bookId: string; fileId: string }>();
  const navigate = useNavigate();

  const { data: book, isLoading } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => booksApi.getById(bookId!),
    enabled: !!bookId,
  });

  if (isLoading) {
    return (
      <div className="h-screen bg-parchment-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ember-500 mx-auto mb-4" />
          <p className="text-ink-500">Loading book...</p>
        </div>
      </div>
    );
  }

  if (!book?.data || !fileId) {
    return (
      <div className="h-screen bg-parchment-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-700">Book not found</p>
        </div>
      </div>
    );
  }

  const bookFile = book.data.files?.find((f) => f.id === fileId);

  if (!bookFile) {
    return (
      <div className="h-screen bg-parchment-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-700">File not found</p>
        </div>
      </div>
    );
  }

  const fileUrl = booksApi.getFile(bookId!, fileId);

  // MOBI/AZW3 have no in-app reader — offer download / conversion guidance.
  if (bookFile.format === 'MOBI' || bookFile.format === 'AZW3') {
    return (
      <div className="h-screen bg-parchment-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center bg-parchment-100/70 border border-parchment-300 rounded-2xl p-8 shadow-warm">
          <h2 className="text-2xl font-serif font-bold text-ink-900 mb-2">{bookFile.format} isn't readable in-app</h2>
          <p className="text-ink-500 mb-6">
            North Star doesn't render {bookFile.format} files in the browser. Download the
            file to read it in a Kindle app or device, or convert it to EPUB
            (e.g. with Calibre) and re-add it to your library.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() =>
                booksApi
                  .download(bookId!, fileId, `${book.data.title}.${bookFile.format.toLowerCase()}`)
                  .catch((err) => console.error('Download failed:', err))
              }
              className="px-5 py-2.5 bg-ember-500 hover:bg-ember-600 text-cream font-semibold rounded-lg transition-colors"
            >
              Download {bookFile.format}
            </button>
            <button
              onClick={() => navigate(-1)}
              className="px-5 py-2.5 bg-parchment-200 hover:bg-parchment-300 text-ink-700 font-medium rounded-lg border border-parchment-300 transition-colors"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-parchment-50">
      {bookFile.format === 'EPUB' ? (
        <EpubReader
          bookId={bookId!}
          fileId={fileId}
          fileUrl={fileUrl}
          title={book.data.title}
        />
      ) : bookFile.format === 'CBZ' ? (
        <ComicReader
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
