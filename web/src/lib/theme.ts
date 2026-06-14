import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

const prefersDark = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Resolve a mode to the concrete light/dark choice and apply it to <html>. */
function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const dark = mode === 'dark' || (mode === 'system' && prefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'system',
      setMode: (mode) => {
        applyTheme(mode);
        set({ mode });
      },
    }),
    {
      name: 'theme',
      onRehydrateStorage: () => (state) => {
        applyTheme(state?.mode ?? 'system');
      },
    }
  )
);

// Apply immediately on load (covers the case before rehydration completes)…
applyTheme(useThemeStore.getState().mode);

// …and follow the OS setting live while in "system" mode.
if (typeof window !== 'undefined') {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (useThemeStore.getState().mode === 'system') {
        applyTheme('system');
      }
    });
}
