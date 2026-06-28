import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component/unit test config for the web package. Mirrors the server's
// vitest.config.ts (globals, include, coverage) but runs in jsdom for React.
// Playwright e2e specs live under e2e/ and are excluded here — they have their
// own runner (playwright.config.ts).
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'e2e'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.test.{ts,tsx}'],
    },
  },
});
