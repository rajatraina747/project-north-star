// Vitest setup shared by all component/unit tests. Adds jest-dom matchers and
// resets persisted state between tests so localStorage-backed modules (auth
// store, reader progress/settings) don't leak across cases.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
