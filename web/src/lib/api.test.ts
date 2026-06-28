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
    useAuthStore.setState({ user: null, token: null, refreshToken: null, isAuthenticated: false });
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

  it('refreshes the access token on a 401 and retries the original request', async () => {
    useAuthStore.setState({ token: 'jwt-old', refreshToken: 'refresh-1', isAuthenticated: true });
    let retriedAuthHeader: string | undefined;

    stubAdapter(async (config) => {
      if ((config.url || '').includes('/auth/refresh')) {
        return {
          data: { token: 'jwt-new', refresh_token: 'refresh-2' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      }
      // First hit on the protected resource 401s; the retry (carrying the new
      // token) succeeds.
      if (!(config as { _retried?: boolean })._retried) {
        return Promise.reject({ response: { status: 401 }, config });
      }
      retriedAuthHeader = config.headers.Authorization as string;
      return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
    });

    const res = await api.get('/books');
    expect(res.data).toEqual({ ok: true });
    expect(retriedAuthHeader).toBe('Bearer jwt-new');
    // Rotated tokens were stored.
    expect(useAuthStore.getState().token).toBe('jwt-new');
    expect(useAuthStore.getState().refreshToken).toBe('refresh-2');
  });

  it('logs out when the refresh attempt itself fails', async () => {
    useAuthStore.setState({ token: 'jwt-old', refreshToken: 'refresh-1', isAuthenticated: true });
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { href: '' } });

    stubAdapter(async (config) => {
      // Both the resource and the refresh return 401.
      return Promise.reject({ response: { status: 401 }, config });
    });

    await expect(api.get('/books')).rejects.toBeTruthy();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(window.location.href).toBe('/login');

    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });
});
