import type { ReactNode, ChangeEvent } from 'react';
import { useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { books as booksApi, library, metadata as metadataApi, progress as progressApi } from '../lib/api';
import { useAuthenticatedImage } from '../hooks/useAuthenticatedImage';
import { useAuthStore } from '../lib/auth';
import ShelfControl from '../components/ShelfControl';
import { READABLE_FORMATS } from '../types';
import type { SeriesContextItem, Tag } from '../types';

export default function BookDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = !!user?.is_admin;

  const [editOpen, setEditOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  const { data: book, isLoading } = useQuery({
    queryKey: ['book', id],
    queryFn: () => booksApi.getById(id!),
    enabled: !!id,
  });

  const { data: allTagsRes } = useQuery({
    queryKey: ['tags'],
    queryFn: () => library.tags(),
    enabled: isAdmin && tagPickerOpen,
  });

  const primaryFileId = book?.data?.files?.[0]?.id;
  const { data: progressRes } = useQuery({
    queryKey: ['progress-meta', id, primaryFileId],
    queryFn: () => progressApi.get(id!, primaryFileId!),
    enabled: !!id && !!primaryFileId,
  });
  const isFinished = !!progressRes?.data?.finished;
  const finishMutation = useMutation({
    mutationFn: (finished: boolean) => progressApi.setFinished(id!, primaryFileId!, finished),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['progress-meta', id, primaryFileId] });
      queryClient.invalidateQueries({ queryKey: ['continue-reading'] });
    },
  });

  const bookData = book?.data;
  const coverApiUrl = bookData?.cover_path ? booksApi.getCover(bookData.id, false) : null;
  const coverUrl = useAuthenticatedImage(coverApiUrl);

  // Mutations
  const refreshMetaMutation = useMutation({
    mutationFn: () => metadataApi.refresh(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['book', id] }),
  });

  const assignTagMutation = useMutation({
    mutationFn: (tagId: string) => library.assignTag(tagId, id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['book', id] }),
  });

  const removeTagMutation = useMutation({
    mutationFn: (tagId: string) => library.removeTag(tagId, id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['book', id] }),
  });

  const createTagMutation = useMutation({
    mutationFn: (name: string) => library.createTag(name),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      assignTagMutation.mutate(res.data.id);
      setNewTagName('');
    },
  });

  if (isLoading) return <LoadingState />;
  if (!bookData) return <ErrorState />;

  const primaryFile = bookData.files?.[0];
  const canRead = !!primaryFile && READABLE_FORMATS.includes(primaryFile.format);
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

  const existingTagIds = new Set((bookData.tags || []).map((t) => t.id));
  const allTags: Tag[] = allTagsRes?.data || [];
  const availableTags = allTags.filter((t) => !existingTagIds.has(t.id));

  return (
    <div className="min-h-screen">
      {/* Hero Section with Background */}
      <div className="relative">
        {coverUrl && (
          <div className="absolute inset-0 overflow-hidden">
            <div
              className="absolute inset-0 bg-cover bg-center blur-3xl opacity-25"
              style={{ backgroundImage: `url(${coverUrl})` }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-parchment-50/70 via-parchment-50/90 to-parchment-50" />
          </div>
        )}

        <div className="relative max-w-7xl mx-auto px-8 py-12">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center text-ink-400 hover:text-ink-700 transition-all duration-250 ease-soft group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ember-500/40"
            aria-label="Back"
          >
            <svg className="w-4 h-4 transition-transform duration-250 group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>

          <div className="flex flex-col md:flex-row gap-8">
            {/* Cover */}
            <div className="flex-shrink-0">
              <div className="relative w-64 aspect-[2/3] bg-parchment-200 rounded-xl overflow-hidden shadow-warm-lg ring-1 ring-parchment-300">
                <div className="absolute -inset-2 bg-ember-500/10 blur-2xl opacity-60" aria-hidden="true" />
                {coverUrl ? (
                  <img src={coverUrl} alt={bookData.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-parchment-200 to-parchment-300">
                    <svg className="w-24 h-24 text-ink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Admin cover replace */}
              {isAdmin && (
                <CoverUploader bookId={bookData.id} onSuccess={() => queryClient.invalidateQueries({ queryKey: ['book', id] })} />
              )}
            </div>

            {/* Info */}
            <div className="flex-1">
              {isFinished && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-3 text-xs font-semibold bg-green-600/15 text-green-700 border border-green-600/30 rounded-full">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Finished
                </span>
              )}
              <h1 className="text-4xl font-serif font-bold text-ink-900 mb-2">{bookData.title}</h1>
              {bookData.subtitle && (
                <h2 className="text-xl text-ink-500 mb-4 font-serif">{bookData.subtitle}</h2>
              )}

              {/* Authors */}
              {bookData.authors && bookData.authors.length > 0 && (
                <div className="flex items-center space-x-2 mb-6">
                  <span className="text-ink-400">by</span>
                  <div className="flex items-center space-x-2">
                    {bookData.authors.map((author, index) => (
                      <span key={author.id} className="text-ember-700 font-medium">
                        {author.name}
                        {index < bookData.authors.length - 1 && ', '}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata chips */}
              <div className="flex flex-wrap gap-2.5 mb-6">
                {bookData.published_date && (
                  <Metadata icon={<CalendarIcon />} label="Published" value={new Date(bookData.published_date).getFullYear().toString()} />
                )}
                {bookData.publisher && (
                  <Metadata icon={<BuildingIcon />} label="Publisher" value={bookData.publisher} />
                )}
                {bookData.page_count && (
                  <Metadata icon={<PagesIcon />} label="Pages" value={bookData.page_count.toString()} />
                )}
                {bookData.language && (
                  <Metadata icon={<GlobeIcon />} label="Language" value={bookData.language.toUpperCase()} />
                )}
              </div>

              {/* Tags */}
              <div className="mb-6">
                <div className="flex flex-wrap gap-2 items-center">
                  {(bookData.tags || []).map((tag) => (
                    <span key={tag.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-ink-900/6 text-ink-700 border border-parchment-300 rounded-full">
                      {tag.name}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => removeTagMutation.mutate(tag.id)}
                          className="text-ink-400 hover:text-red-500 transition-colors"
                          title="Remove tag"
                          aria-label={`Remove tag ${tag.name}`}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </span>
                  ))}

                  {/* Link to library filtered by tag */}
                  {(bookData.tags || []).length === 0 && !isAdmin && (
                    <span className="text-xs text-ink-400">No tags</span>
                  )}

                  {/* Admin: add tag */}
                  {isAdmin && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setTagPickerOpen((v) => !v)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-parchment-200 text-ink-600 border border-parchment-300 border-dashed rounded-full hover:bg-parchment-300 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add tag
                      </button>

                      {tagPickerOpen && (
                        <div className="absolute left-0 top-full mt-1 z-50 w-56 border border-parchment-300 rounded-xl shadow-warm-lg p-2" style={{ backgroundColor: 'rgb(var(--p-50))' }}>
                          {/* Existing tags to assign */}
                          {availableTags.length > 0 && (
                            <div className="mb-2">
                              <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide px-2 mb-1">Existing tags</p>
                              <ul className="max-h-36 overflow-y-auto space-y-0.5">
                                {availableTags.map((t) => (
                                  <li key={t.id}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        assignTagMutation.mutate(t.id);
                                        setTagPickerOpen(false);
                                      }}
                                      className="w-full text-left px-2 py-1.5 text-xs text-ink-700 hover:bg-parchment-200 rounded-md transition-colors"
                                    >
                                      {t.name}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {/* Create new tag */}
                          <div className="border-t border-parchment-200 pt-2">
                            <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide px-2 mb-1">Create new</p>
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (newTagName.trim()) {
                                  createTagMutation.mutate(newTagName.trim());
                                  setTagPickerOpen(false);
                                }
                              }}
                              className="flex gap-1 px-1"
                            >
                              <input
                                type="text"
                                value={newTagName}
                                onChange={(e) => setNewTagName(e.target.value)}
                                placeholder="Tag name…"
                                className="flex-1 px-2 py-1 text-xs bg-parchment-100 border border-parchment-300 rounded-md focus:outline-none focus:ring-1 focus:ring-ember-500/60"
                                autoFocus
                              />
                              <button
                                type="submit"
                                className="px-2 py-1 text-xs bg-ember-500 text-cream rounded-md hover:bg-ember-600"
                              >
                                Add
                              </button>
                            </form>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Shelf */}
              <div className="mb-6">
                <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2">Your shelf</p>
                <ShelfControl bookId={bookData.id} />
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3 mb-6">
                {canRead && (
                  <Link
                    to={`/read/${bookData.id}/${primaryFile!.id}`}
                    className="inline-flex items-center px-6 py-3 bg-ember-500 hover:bg-ember-600 text-cream font-semibold rounded-lg transition-all duration-350 ease-soft hover:-translate-y-0.5 hover:shadow-warm-lg active:translate-y-0"
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
                      booksApi.download(bookData.id, primaryFile.id, `${bookData.title}.${primaryFile.format.toLowerCase()}`)
                        .catch((err) => console.error('Download failed:', err))
                    }
                    className="inline-flex items-center px-6 py-3 bg-parchment-200 hover:bg-parchment-300 text-ink-800 font-semibold rounded-lg transition-colors duration-250 group border border-parchment-300"
                  >
                    <svg className="w-5 h-5 mr-2 transition-transform duration-250 group-hover:translate-y-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </button>
                )}
                {primaryFile && (
                  <button
                    type="button"
                    onClick={() => finishMutation.mutate(!isFinished)}
                    disabled={finishMutation.isPending}
                    className={`inline-flex items-center px-4 py-3 font-medium rounded-lg transition-colors border disabled:opacity-50 ${
                      isFinished
                        ? 'bg-green-600/15 text-green-700 border-green-600/30 hover:bg-green-600/25'
                        : 'bg-parchment-200 hover:bg-parchment-300 text-ink-700 border-parchment-300'
                    }`}
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {isFinished ? 'Finished' : 'Mark as Finished'}
                  </button>
                )}
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditOpen((v) => !v)}
                      className="inline-flex items-center px-4 py-3 bg-parchment-200 hover:bg-parchment-300 text-ink-700 font-medium rounded-lg transition-colors border border-parchment-300"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit Metadata
                    </button>
                    <button
                      type="button"
                      onClick={() => refreshMetaMutation.mutate()}
                      disabled={refreshMetaMutation.isPending || bookData.metadata_locked}
                      className="inline-flex items-center px-4 py-3 bg-parchment-200 hover:bg-parchment-300 text-ink-700 font-medium rounded-lg transition-colors border border-parchment-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={bookData.metadata_locked ? 'Metadata is locked' : 'Re-fetch metadata from external sources'}
                    >
                      <svg className={`w-4 h-4 mr-2 ${refreshMetaMutation.isPending ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {refreshMetaMutation.isPending ? 'Refreshing…' : 'Refresh Metadata'}
                    </button>
                  </>
                )}
              </div>

              {/* Refresh metadata result */}
              {refreshMetaMutation.isSuccess && (
                <div className="mb-4 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                  Metadata refreshed successfully.
                </div>
              )}
              {refreshMetaMutation.isError && (
                <div className="mb-4 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {(refreshMetaMutation.error as any)?.response?.data?.error || 'Failed to refresh metadata.'}
                </div>
              )}

              {/* Edit Metadata Form */}
              {isAdmin && editOpen && (
                <MetadataEditForm
                  book={bookData}
                  onSuccess={() => {
                    queryClient.invalidateQueries({ queryKey: ['book', id] });
                    setEditOpen(false);
                  }}
                  onCancel={() => setEditOpen(false)}
                />
              )}

              {/* Description */}
              {bookData.description && !editOpen && (
                <div className="bg-parchment-100/70 rounded-xl p-6 border border-parchment-300">
                  <h3 className="text-lg font-serif font-semibold text-ink-900 mb-3">Description</h3>
                  <p className="text-ink-600 leading-relaxed">{bookData.description}</p>
                </div>
              )}

              {/* Additional Info */}
              {!editOpen && (
                <div className="mt-6 grid grid-cols-2 gap-4">
                  {bookData.isbn_13 && (
                    <div className="bg-parchment-100/70 rounded-lg p-4 border border-parchment-300">
                      <div className="text-xs text-ink-400 mb-1">ISBN-13</div>
                      <div className="text-ink-700 text-sm font-mono">{bookData.isbn_13}</div>
                    </div>
                  )}
                  {primaryFile && (
                    <div className="bg-parchment-100/70 rounded-lg p-4 border border-parchment-300">
                      <div className="text-sm text-ink-400 mb-1">Format</div>
                      <div className="text-ink-900 font-semibold">{primaryFile.format}</div>
                    </div>
                  )}
                </div>
              )}

              {showSeriesSection && (
                <div className="mt-10">
                  <div className="mb-4">
                    <h3 className="text-lg font-serif font-semibold text-ink-900">{seriesName}</h3>
                    <p className="text-xs text-ink-400">
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

// ---------------------------------------------------------------------------
// Cover uploader
// ---------------------------------------------------------------------------
function CoverUploader({ bookId, onSuccess }: { bookId: string; onSuccess: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (JPEG, PNG, etc.)');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      await metadataApi.replaceCover(bookId, file);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="mt-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-parchment-200 hover:bg-parchment-300 text-ink-600 border border-parchment-300 rounded-lg transition-colors disabled:opacity-50"
      >
        {uploading ? (
          <>
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Uploading…
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Replace Cover
          </>
        )}
      </button>
      {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata edit form
// ---------------------------------------------------------------------------
interface EditFormState {
  title: string;
  subtitle: string;
  description: string;
  publisher: string;
  published_date: string;
  language: string;
  isbn_10: string;
  isbn_13: string;
  page_count: string;
  metadata_locked: boolean;
}

function MetadataEditForm({
  book,
  onSuccess,
  onCancel,
}: {
  book: any;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<EditFormState>({
    title: book.title || '',
    subtitle: book.subtitle || '',
    description: book.description || '',
    publisher: book.publisher || '',
    published_date: book.published_date ? book.published_date.slice(0, 10) : '',
    language: book.language || '',
    isbn_10: book.isbn_10 || '',
    isbn_13: book.isbn_13 || '',
    page_count: book.page_count?.toString() || '',
    metadata_locked: book.metadata_locked || false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof EditFormState) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = e.target.type === 'checkbox'
      ? (e.target as HTMLInputElement).checked
      : e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        title: form.title.trim() || undefined,
        subtitle: form.subtitle.trim() || undefined,
        description: form.description.trim() || undefined,
        publisher: form.publisher.trim() || undefined,
        published_date: form.published_date || undefined,
        language: form.language.trim() || undefined,
        isbn_10: form.isbn_10.trim() || undefined,
        isbn_13: form.isbn_13.trim() || undefined,
        page_count: form.page_count ? parseInt(form.page_count, 10) : undefined,
        metadata_locked: form.metadata_locked,
      };
      // Remove undefined keys
      Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

      await booksApi.update(book.id, payload);
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = 'w-full px-3 py-2 text-sm bg-parchment-100 border border-parchment-300 rounded-lg text-ink-900 focus:outline-none focus:ring-1 focus:ring-ember-500/60 focus:border-ember-500/60 transition-all';
  const labelClass = 'block text-xs font-semibold text-ink-500 mb-1';

  return (
    <form onSubmit={handleSubmit} className="mb-6 bg-parchment-100/70 rounded-xl p-6 border border-parchment-300">
      <h3 className="text-base font-serif font-semibold text-ink-900 mb-4">Edit Metadata</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className={labelClass}>Title</label>
          <input type="text" className={fieldClass} value={form.title} onChange={set('title')} required />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Subtitle</label>
          <input type="text" className={fieldClass} value={form.subtitle} onChange={set('subtitle')} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Description</label>
          <textarea className={fieldClass} value={form.description} onChange={set('description')} rows={4} />
        </div>
        <div>
          <label className={labelClass}>Publisher</label>
          <input type="text" className={fieldClass} value={form.publisher} onChange={set('publisher')} />
        </div>
        <div>
          <label className={labelClass}>Published Date</label>
          <input type="date" className={fieldClass} value={form.published_date} onChange={set('published_date')} />
        </div>
        <div>
          <label className={labelClass}>Language</label>
          <input type="text" className={fieldClass} value={form.language} onChange={set('language')} placeholder="en" maxLength={10} />
        </div>
        <div>
          <label className={labelClass}>Page Count</label>
          <input type="number" className={fieldClass} value={form.page_count} onChange={set('page_count')} min={1} />
        </div>
        <div>
          <label className={labelClass}>ISBN-10</label>
          <input type="text" className={fieldClass} value={form.isbn_10} onChange={set('isbn_10')} maxLength={13} />
        </div>
        <div>
          <label className={labelClass}>ISBN-13</label>
          <input type="text" className={fieldClass} value={form.isbn_13} onChange={set('isbn_13')} maxLength={17} />
        </div>
        <div className="sm:col-span-2 flex items-center gap-2">
          <input
            type="checkbox"
            id="metadata_locked"
            checked={form.metadata_locked}
            onChange={(e) => setForm((prev) => ({ ...prev, metadata_locked: e.target.checked }))}
            className="w-4 h-4 accent-ember-500"
          />
          <label htmlFor="metadata_locked" className="text-sm text-ink-700">
            Lock metadata (prevents automatic overwriting by scanner)
          </label>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-500">{error}</p>
      )}

      <div className="mt-5 flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2 bg-ember-500 hover:bg-ember-600 text-cream text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2 bg-parchment-200 hover:bg-parchment-300 text-ink-700 text-sm font-medium rounded-lg transition-colors border border-parchment-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Series book card
// ---------------------------------------------------------------------------
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
  const coverApiUrl = isInLibrary ? booksApi.getCover(entry.library_book_id!, true) : null;
  const libraryCoverUrl = useAuthenticatedImage(coverApiUrl);
  const coverUrl = isInLibrary ? libraryCoverUrl : entry.coverUrl || null;
  const orderLabel = entry.position != null ? `Book ${entry.position}` : 'Book';

  const CardBody = (
    <div className="w-24 flex-none snap-start">
      <div className="aspect-[2/3] rounded-lg overflow-hidden bg-parchment-200 ring-1 ring-parchment-300 shadow-warm transition-transform duration-250 ease-soft group-hover:-translate-y-1">
        {coverUrl ? (
          <img src={coverUrl} alt={entry.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-parchment-200 to-parchment-300">
            <svg className="w-8 h-8 text-ink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
        )}
      </div>
      <div className="mt-2">
        <p className="text-xs text-ink-800 line-clamp-2">{entry.title}</p>
        <p className="text-[10px] text-ink-400 mt-0.5">{orderLabel}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${isInLibrary ? 'bg-ember-500' : 'bg-parchment-400'}`} aria-hidden="true" />
          <span>{isInLibrary ? 'In library' : 'Not in library'}</span>
        </div>
      </div>
    </div>
  );

  if (!isInLibrary) {
    const query = entry.acquire?.query || entry.title;
    return (
      <button type="button" onClick={() => onAcquire(query)} className="group opacity-70 text-left">
        {CardBody}
      </button>
    );
  }
  if (isCurrent) return <div className="group opacity-90">{CardBody}</div>;
  return <Link to={`/books/${entry.library_book_id}`} className="group">{CardBody}</Link>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function Metadata({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-sm bg-parchment-100 border border-parchment-300 rounded-full px-3 py-1.5">
      <span className="text-ember-600">{icon}</span>
      <span className="text-ink-400">{label}</span>
      <span className="text-ink-800 font-medium">{value}</span>
    </div>
  );
}

const iconClass = 'w-4 h-4';
function CalendarIcon() {
  return <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
}
function BuildingIcon() {
  return <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2M5 21H3m4-14h2m-2 4h2m6-4h2m-2 4h2M9 21v-4a2 2 0 012-2h2a2 2 0 012 2v4" /></svg>;
}
function PagesIcon() {
  return <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
}
function GlobeIcon() {
  return <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>;
}

function LoadingState() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ember-500" />
    </div>
  );
}

function ErrorState() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-serif font-bold text-ink-900 mb-2">Book not found</h2>
        <Link to="/library" className="inline-flex items-center px-6 py-3 bg-ember-500 hover:bg-ember-600 text-cream rounded-lg transition">
          Back to Library
        </Link>
      </div>
    </div>
  );
}
