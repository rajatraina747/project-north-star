import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Reader from './Reader';
import { books as booksApi } from '../lib/api';

// The real readers pull in epub.js / pdf.js, which can't run in jsdom. Replace
// them with markers so we only assert the page's format-routing decision.
vi.mock('../components/EpubReader', () => ({
  default: () => <div data-testid="epub-reader" />,
}));
vi.mock('../components/PdfReader', () => ({
  default: () => <div data-testid="pdf-reader" />,
}));
vi.mock('../components/ComicReader', () => ({
  default: () => <div data-testid="comic-reader" />,
}));

vi.mock('../lib/api', () => ({
  books: {
    getById: vi.fn(),
    getFile: vi.fn(() => '/api/books/b1/file/f1'),
    download: vi.fn(),
  },
}));

const mockedGetById = vi.mocked(booksApi.getById);

const renderReader = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/read/b1/f1']}>
        <Routes>
          <Route path="/read/:bookId/:fileId" element={<Reader />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

const bookWithFile = (format: string) =>
  ({
    data: { id: 'b1', title: 'Test Book', files: [{ id: 'f1', format }] },
  }) as any;

describe('Reader page format routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['EPUB', 'epub-reader'],
    ['PDF', 'pdf-reader'],
    ['CBZ', 'comic-reader'],
  ])('renders the %s reader', async (format, testid) => {
    mockedGetById.mockResolvedValue(bookWithFile(format));
    renderReader();
    expect(await screen.findByTestId(testid)).toBeInTheDocument();
  });

  it('shows a download fallback for MOBI/AZW3 instead of a reader', async () => {
    mockedGetById.mockResolvedValue(bookWithFile('MOBI'));
    renderReader();
    expect(await screen.findByText(/isn't readable in-app/i)).toBeInTheDocument();
    expect(screen.queryByTestId('epub-reader')).not.toBeInTheDocument();
  });

  it('shows "File not found" when the file id is missing from the book', async () => {
    mockedGetById.mockResolvedValue({
      data: { id: 'b1', title: 'Test Book', files: [{ id: 'other', format: 'EPUB' }] },
    } as any);
    renderReader();
    await waitFor(() => expect(screen.getByText('File not found')).toBeInTheDocument());
  });
});
