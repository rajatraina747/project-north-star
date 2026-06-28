import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import type { Book, BookWithDetails, ReadingProgress, ReadingStats, User, Bookmark, AuthorWithBooks, SeriesWithBooks, Tag, Author, Series, ShelfStatus, ShelfBook, ScanHistory, BookFormat } from '../types';
import { getToken, getRefreshToken, useAuthStore } from './auth';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Marker so a request that already triggered a refresh isn't retried in a loop.
interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Single-flight access-token renewal: many requests may 401 at once when the
// access token expires; they all await the same refresh call rather than each
// firing their own.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  if (!refreshPromise) {
    refreshPromise = api
      .post('/auth/refresh', { refresh_token: refreshToken })
      .then((res) => {
        const { token, refresh_token: rotated } = res.data as { token: string; refresh_token: string | null };
        useAuthStore.getState().setTokens(token, rotated ?? null);
        return token;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = (error.config || {}) as RetryableConfig;
    const url = original.url || '';
    const isAuthRequest =
      url.includes('/auth/login') ||
      url.includes('/auth/register') ||
      url.includes('/auth/refresh');

    if (error.response?.status === 401 && !isAuthRequest) {
      // Try once to renew the session before giving up.
      if (!original._retried) {
        original._retried = true;
        const newToken = await refreshAccessToken();
        if (newToken) {
          original.headers = original.headers ?? {};
          original.headers.Authorization = `Bearer ${newToken}`;
          return api(original);
        }
      }
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const auth = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  me: () => api.get<User>('/auth/me'),
  registrationStatus: () => api.get<{ open: boolean }>('/auth/registration-status'),
  register: (data: { username: string; email: string; password: string; display_name?: string }) =>
    api.post('/auth/register', data),
  // Revoke the refresh token server-side on sign-out (best-effort).
  logout: (refreshToken: string) => api.post('/auth/logout', { refresh_token: refreshToken }),
  // Self-service password reset. forgotPassword returns a generic message; the
  // reset link is logged server-side (and only echoed when the server is
  // configured to return it for headless/no-email setups).
  forgotPassword: (identifier: string) =>
    api.post<{ message: string; reset_token?: string; reset_link?: string }>(
      '/auth/forgot-password',
      { identifier }
    ),
  resetPassword: (token: string, password: string) =>
    api.post<{ message: string }>('/auth/reset-password', { token, password }),
};

export interface AdminUser extends User {
  is_active: boolean;
  disabled_at: string | null;
  created_at: string;
  updated_at?: string;
}

export const users = {
  list: () => api.get<AdminUser[]>('/users'),
  create: (data: { username: string; email: string; display_name?: string; is_admin?: boolean; password: string }) =>
    api.post<AdminUser>('/users', data),
  update: (id: string, data: { display_name?: string; is_admin?: boolean; is_active?: boolean }) =>
    api.patch<AdminUser>(`/users/${id}`, data),
  resetPassword: (id: string, password: string) =>
    api.post(`/users/${id}/reset-password`, { password }),
  remove: (id: string) => api.delete(`/users/${id}`),
};

export const shelf = {
  list: (status?: ShelfStatus) =>
    api.get<ShelfBook[]>('/shelf', { params: status ? { status } : undefined }),
  get: (bookId: string) => api.get<{ status: ShelfStatus | null }>(`/shelf/${bookId}`),
  set: (bookId: string, status: ShelfStatus) => api.put(`/shelf/${bookId}`, { status }),
  remove: (bookId: string) => api.delete(`/shelf/${bookId}`),
};

export interface BookWithProgress {
  book: Book;
  progress: ReadingProgress;
}

export const books = {
  getAll: (params?: { limit?: number; offset?: number; sort?: string; cursor?: string }) =>
    api.get<PageResponse<Book>>('/books', { params }),
  getRecent: (limit = 20) => api.get<Book[]>('/books/recent', { params: { limit } }),
  getContinueReading: (limit = 20) => api.get<BookWithProgress[]>('/books/continue', { params: { limit } }),
  getById: (id: string) => api.get<BookWithDetails>(`/books/${id}`),
  getCover: (id: string, thumbnail = false) =>
    `/api/books/${id}/cover?thumbnail=${thumbnail}`,
  getFile: (bookId: string, fileId: string) => `/api/books/${bookId}/file/${fileId}`,
  // Obtain a short-lived streaming URL for a file. The returned URL carries a
  // signed ticket in the query string so reader libraries (pdf.js/epub.js) can
  // issue byte-range requests directly, without an Authorization header — which
  // is what enables true streaming instead of buffering the whole file.
  getStreamUrl: async (bookId: string, fileId: string): Promise<string> => {
    const { data } = await api.get<{ token: string }>(`/books/${bookId}/file/${fileId}/ticket`);
    return `/api/books/${bookId}/file/${fileId}?token=${encodeURIComponent(data.token)}`;
  },
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
    formats?: BookFormat[];
    language?: string;
  };
  sort?: 'title' | 'author' | 'recent' | 'added';
  limit?: number;
  offset?: number;
  // Opaque keyset cursor from a previous response's `nextCursor`.
  cursor?: string;
}

export interface PageResponse<T> {
  books: T[];
  total: number;
  nextCursor: string | null;
}

export const search = {
  search: (params: SearchParams) =>
    api.post<PageResponse<Book>>('/search', { query: '', ...params }),
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

export interface DuplicateBookSummary {
  id: string;
  title: string;
  primary_author: string | null;
  formats: string[];
  paths: string[];
  total_size: number;
}

export interface DuplicateReport {
  exactHash: { file_hash: string; files: { book_id: string; title: string; file_path: string; format: string; file_size: number }[] }[];
  byTitleAuthor: { title: string; author: string | null; books: DuplicateBookSummary[] }[];
  byIsbn: { isbn: string; books: DuplicateBookSummary[] }[];
  counts: { exactHash: number; titleAuthor: number; isbn: number };
}

export interface ScanStreamHandlers {
  onProgress?: (scan: ScanHistory) => void;
  onDone?: (scan: ScanHistory) => void;
  onError?: (err?: unknown) => void;
}

export const admin = {
  scan: (force = false) => api.post('/admin/scan', { force }),
  getScans: (limit = 20) => api.get<ScanHistory[]>('/admin/scans', { params: { limit } }),
  getScan: (id: string) => api.get<ScanHistory>(`/admin/scans/${id}`),
  duplicates: () => api.get<DuplicateReport>('/admin/duplicates'),
  // Consume the SSE progress stream via fetch() so we can send the JWT in an
  // Authorization header (EventSource can't set headers). Returns an abort fn.
  streamScan: (scanId: string, handlers: ScanStreamHandlers): (() => void) => {
    const token = getToken();
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/admin/scans/${scanId}/stream`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          handlers.onError?.();
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() || '';
          for (const block of blocks) {
            let event = 'message';
            let data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!data) continue;
            try {
              const parsed = JSON.parse(data) as ScanHistory;
              if (event === 'done') handlers.onDone?.(parsed);
              else if (event === 'error') handlers.onError?.(parsed);
              else handlers.onProgress?.(parsed);
            } catch {
              /* ignore malformed frame */
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) handlers.onError?.(err);
      }
    })();

    return () => controller.abort();
  },
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
