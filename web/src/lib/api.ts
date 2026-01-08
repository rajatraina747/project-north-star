import axios from 'axios';
import type { Book, BookWithDetails, ReadingProgress, User } from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
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
        localStorage.removeItem('token');
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
};

export const progress = {
  get: (bookId: string, fileId: string) =>
    api.get<ReadingProgress>(`/progress/${bookId}/${fileId}`),
  update: (bookId: string, fileId: string, data: Partial<ReadingProgress>) =>
    api.put(`/progress/${bookId}/${fileId}`, data),
  getAll: () => api.get<ReadingProgress[]>('/progress'),
};

export const search = {
  search: (query: string, filters?: any) =>
    api.post<{ books: Book[]; total: number }>('/search', { query, filters }),
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
