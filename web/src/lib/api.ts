import axios from 'axios';
import type { Book, BookWithDetails, ReadingProgress, ReadingStats, User, Bookmark, AuthorWithBooks, SeriesWithBooks, Tag, Author, Series } from '../types';
import { getToken, useAuthStore } from './auth';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      const isAuthRequest = url.includes('/auth/login') || url.includes('/auth/register');
      if (!isAuthRequest) {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const auth = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  me: () => api.get<User>('/auth/me'),
};

export interface BookWithProgress {
  book: Book;
  progress: ReadingProgress;
}

export const books = {
  getAll: (params?: { limit?: number; offset?: number; sort?: string }) =>
    api.get<{ books: Book[]; total: number }>('/books', { params }),
  getRecent: (limit = 20) => api.get<Book[]>('/books/recent', { params: { limit } }),
  getContinueReading: (limit = 20) => api.get<BookWithProgress[]>('/books/continue', { params: { limit } }),
  getById: (id: string) => api.get<BookWithDetails>(`/books/${id}`),
  getCover: (id: string, thumbnail = false) =>
    `/api/books/${id}/cover?thumbnail=${thumbnail}`,
  getFile: (bookId: string, fileId: string) => `/api/books/${bookId}/file/${fileId}`,
  update: (id: string, data: Partial<Book>) => api.patch(`/books/${id}`, data),
  // The file endpoint requires the JWT in an Authorization header, which a
  // plain <a download> can't send. Fetch the file as a blob and save it.
  download: async (bookId: string, fileId: string, filename: string) => {
    const token = getToken();
    const response = await fetch(`/api/books/${bookId}/file/${fileId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  },
};

export const progress = {
  get: (bookId: string, fileId: string) =>
    api.get<ReadingProgress>(`/progress/${bookId}/${fileId}`),
  update: (bookId: string, fileId: string, data: Partial<ReadingProgress>) =>
    api.put(`/progress/${bookId}/${fileId}`, data),
  setFinished: (bookId: string, fileId: string, finished: boolean) =>
    api.put<ReadingProgress>(`/progress/${bookId}/${fileId}/finish`, { finished }),
  getAll: () => api.get<ReadingProgress[]>('/progress'),
};

export const stats = {
  // Fire-and-forget reading heartbeat (kept off the axios instance's error
  // interceptor concerns — failures here are non-critical).
  heartbeat: (bookId: string, fileId: string, seconds: number, pages: number) =>
    api.post('/stats/heartbeat', { book_id: bookId, file_id: fileId, seconds, pages }),
  summary: () => api.get<ReadingStats>('/stats/summary'),
};

export interface SearchParams {
  query?: string;
  filters?: {
    authors?: string[];
    series?: string[];
    tags?: string[];
    formats?: ('EPUB' | 'PDF')[];
    language?: string;
  };
  sort?: 'title' | 'author' | 'recent' | 'added';
  limit?: number;
  offset?: number;
}

export const search = {
  search: (params: SearchParams) =>
    api.post<{ books: Book[]; total: number }>('/search', { query: '', ...params }),
  quick: (q: string) => api.get<Book[]>('/search/quick', { params: { q } }),
};

export const library = {
  stats: () => api.get('/library/stats'),
  authors: () => api.get<(Author & { book_count: number })[]>('/library/authors'),
  authorById: (id: string) => api.get<AuthorWithBooks>(`/library/authors/${id}`),
  series: () => api.get<(Series & { book_count: number })[]>('/library/series'),
  seriesById: (id: string) => api.get<SeriesWithBooks>(`/library/series/${id}`),
  tags: () => api.get<(Tag & { book_count: number })[]>('/library/tags'),
  createTag: (name: string) => api.post<Tag>('/library/tags', { name }),
  assignTag: (tagId: string, bookId: string) =>
    api.post(`/library/tags/${tagId}/books/${bookId}`),
  removeTag: (tagId: string, bookId: string) =>
    api.delete(`/library/tags/${tagId}/books/${bookId}`),
};

export const admin = {
  scan: (force = false) => api.post('/admin/scan', { force }),
  getScans: (limit = 20) => api.get('/admin/scans', { params: { limit } }),
  settings: () => api.get('/admin/settings'),
  updateSetting: (key: string, value: any) => api.put(`/admin/settings/${key}`, { value }),
  uploadBook: (file: File, onProgress?: (percent: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ message: string; path: string; scan_id: string }>('/books/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
  },
};

export const bookmarks = {
  list: (bookId: string, fileId: string) =>
    api.get<Bookmark[]>(`/bookmarks/${bookId}/${fileId}`),
  create: (bookId: string, fileId: string, data: { epub_cfi?: string; pdf_page?: number; label?: string }) =>
    api.post<Bookmark>(`/bookmarks/${bookId}/${fileId}`, data),
  delete: (bookId: string, fileId: string, bookmarkId: string) =>
    api.delete(`/bookmarks/${bookId}/${fileId}/${bookmarkId}`),
};

export const metadata = {
  refresh: (bookId: string) => api.post<Book>(`/books/${bookId}/refresh-metadata`),
  replaceCover: async (bookId: string, file: File) => {
    const token = getToken();
    const arrayBuffer = await file.arrayBuffer();
    const response = await fetch(`/api/books/${bookId}/cover`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'image/jpeg',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: arrayBuffer,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `Cover upload failed: ${response.status}`);
    }
    return response.json() as Promise<Book>;
  },
};

export default api;
