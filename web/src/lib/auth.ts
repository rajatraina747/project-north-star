import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  hasHydrated: boolean;
  login: (token: string, refreshToken: string | null, user: User) => void;
  setTokens: (token: string, refreshToken: string | null) => void;
  logout: () => void;
  setUser: (user: User) => void;
  setHasHydrated: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      hasHydrated: false,
      login: (token, refreshToken, user) => {
        set({ token, refreshToken, user, isAuthenticated: true });
      },
      setTokens: (token, refreshToken) => {
        set({ token, refreshToken });
      },
      logout: () => {
        set({ token: null, refreshToken: null, user: null, isAuthenticated: false });
      },
      setUser: (user) => set({ user }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: 'auth-storage',
      onRehydrateStorage: () => (state) => {
        if (state?.token) {
          useAuthStore.setState({ isAuthenticated: true });
        }
        useAuthStore.setState({ hasHydrated: true });
      },
    }
  )
);

/**
 * Single source of truth for the auth token (persisted by the zustand store
 * under "auth-storage"). Use this from non-React code (axios interceptors,
 * fetch calls) instead of reading a separate localStorage key.
 */
export const getToken = (): string | null => useAuthStore.getState().token;

/** The persisted refresh token, for the access-token renewal flow. */
export const getRefreshToken = (): string | null => useAuthStore.getState().refreshToken;
