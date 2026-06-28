import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore, getToken, getRefreshToken } from './auth';
import type { User } from '../types';

const user: User = {
  id: 'u1',
  username: 'reader',
  email: 'reader@example.com',
  display_name: 'Reader',
  is_admin: false,
} as User;

describe('auth store', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: null, refreshToken: null, isAuthenticated: false });
  });

  it('starts logged out', () => {
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('login sets token, refresh token, user and authenticated flag', () => {
    useAuthStore.getState().login('jwt-123', 'refresh-abc', user);
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.user).toEqual(user);
    expect(getToken()).toBe('jwt-123');
    expect(getRefreshToken()).toBe('refresh-abc');
  });

  it('setTokens rotates both tokens without touching the user', () => {
    useAuthStore.getState().login('jwt-123', 'refresh-abc', user);
    useAuthStore.getState().setTokens('jwt-456', 'refresh-def');
    expect(getToken()).toBe('jwt-456');
    expect(getRefreshToken()).toBe('refresh-def');
    expect(useAuthStore.getState().user).toEqual(user);
  });

  it('logout clears everything', () => {
    useAuthStore.getState().login('jwt-123', 'refresh-abc', user);
    useAuthStore.getState().logout();
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('setUser updates the profile without touching the token', () => {
    useAuthStore.getState().login('jwt-123', 'refresh-abc', user);
    useAuthStore.getState().setUser({ ...user, display_name: 'Renamed' });
    expect(useAuthStore.getState().user?.display_name).toBe('Renamed');
    expect(getToken()).toBe('jwt-123');
  });
});
