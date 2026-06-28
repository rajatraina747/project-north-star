import { describe, it, expect, beforeEach } from 'vitest';
import type { AxiosAdapter } from 'axios';
import api from './api';
import { useAuthStore } from './auth';

// Drive requests through a stub adapter so we can inspect the outgoing config
// (request interceptor) and simulate server responses (response interceptor)
// without any network.
const stubAdapter = (impl: AxiosAdapter) => {
  api.defaults.adapter = impl;
};

describe('api axios interceptors', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  });

  it('attaches the bearer token from the auth store to requests', async () => {
    useAuthStore.setState({ token: 'jwt-xyz', isAuthenticated: true });
    let seen: string | undefined;
    stubAdapter(async (config) => {
      seen = config.headers.Authorization as string;
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    });
    await api.get('/books');
    expect(seen).toBe('Bearer jwt-xyz');
  });

  it('omits the Authorization header when there is no token', async () => {
    let seen: unknown;
    stubAdapter(async (config) => {
      seen = config.headers.Authorization;
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    });
    await api.get('/books');
    expect(seen).toBeUndefined();
  });

  it('logs out and redirects on a 401 from a non-auth endpoint', async () => {
    useAuthStore.setState({ token: 'jwt-xyz', isAuthenticated: true });
    const original = window.location;
    // jsdom won't navigate; replace location with a plain writable stub.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    });

    stubAdapter(async (config) => {
      return Promise.reject({ response: { status: 401 }, config });
    });

    await expect(api.get('/books')).rejects.toBeTruthy();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(window.location.href).toBe('/login');

    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('does NOT log out on a 401 from the login endpoint', async () => {
    useAuthStore.setState({ token: 'jwt-xyz', isAuthenticated: true });
    stubAdapter(async (config) =>
      Promise.reject({ response: { status: 401 }, config: { ...config, url: '/auth/login' } })
    );
    await expect(api.post('/auth/login', {})).rejects.toBeTruthy();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});
