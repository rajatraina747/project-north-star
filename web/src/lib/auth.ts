import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  hasHydrated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  setUser: (user: User) => void;
  setHasHydrated: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      hasHydrated: false,
      login: (token, user) => {
        set({ token, user, isAuthenticated: true });
      },
      logout: () => {
        set({ token: null, user: null, isAuthenticated: false });
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
