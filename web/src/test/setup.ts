// Vitest setup shared by all component/unit tests. Adds jest-dom matchers and
// resets persisted state between tests so localStorage-backed modules (auth
// store, reader progress/settings) don't leak across cases.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom doesn't implement matchMedia, which theme.ts reads at import time and
// the reader uses for pointer detection. Provide a minimal no-match stub.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
