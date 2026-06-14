import axios from 'axios';
import type { Book, BookWithDetails, ReadingProgress, User } from '../types';
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
  getAll: () => api.get<ReadingProgress[]>('/progress'),
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
  authors: () => api.get('/library/authors'),
  series: () => api.get('/library/series'),
  tags: () => api.get('/library/tags'),
};

export const admin = {
  scan: (force = false) => api.post('/admin/scan', { force }),
  getScans: (limit = 20) => api.get('/admin/scans', { params: { limit } }),
  settings: () => api.get('/admin/settings'),
  updateSetting: (key: string, value: any) => api.put(`/admin/settings/${key}`, { value }),
};

export default api;
