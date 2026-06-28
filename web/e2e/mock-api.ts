import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Page, Route } from '@playwright/test';

// Network-level backend stub for the e2e suite. Registers route handlers for
// every /api/** call the exercised flows make, so the tests need no running
// server or database. Keep responses minimal — just enough shape for the UI.

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_EPUB = readFileSync(join(here, 'fixtures', 'sample.epub'));

export const TEST_USER = {
  id: 'u-test',
  username: 'admin',
  email: 'admin@example.com',
  display_name: 'Admin',
  is_admin: true,
  is_active: true,
};

export const TEST_TOKEN = 'e2e-test-jwt';

export const BOOK_ID = 'book-1';
export const FILE_ID = 'file-1';

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const sampleBook = {
  id: BOOK_ID,
  title: 'North Star E2E Sample',
  primary_author: 'Test Author',
  files: [{ id: FILE_ID, format: 'EPUB', file_size: SAMPLE_EPUB.length }],
};

interface MockOptions {
  // First-run register flow vs. normal login screen.
  registrationOpen?: boolean;
}

/**
 * Install the API stub on a page. Specific routes are matched first; a catch-all
 * keeps any unanticipated GET from failing the page.
 */
export async function mockApi(page: Page, opts: MockOptions = {}) {
  const registrationOpen = opts.registrationOpen ?? false;

  // NOTE: Playwright matches routes in reverse registration order (the most
  // recently registered handler wins). So register the broad catch-all FIRST
  // and progressively more specific routes AFTER, so specifics take priority.

  // Catch-all so any unlisted GET resolves rather than erroring the page.
  await page.route('**/api/**', (r) => json(r, {}));

  // Generic books list (PageResponse) + shelves. Registered early so the more
  // specific /books/recent, /books/continue and /books/:id routes below win.
  await page.route('**/api/books**', (r) =>
    json(r, { books: [sampleBook], total: 1, nextCursor: null })
  );
  await page.route('**/api/shelf**', (r) => json(r, []));

  await page.route('**/api/auth/registration-status', (r) => json(r, { open: registrationOpen }));
  await page.route('**/api/auth/login', (r) =>
    json(r, { token: TEST_TOKEN, refresh_token: 'e2e-refresh', user: TEST_USER })
  );
  await page.route('**/api/auth/register', (r) =>
    json(r, { token: TEST_TOKEN, refresh_token: 'e2e-refresh', user: TEST_USER })
  );
  await page.route('**/api/auth/refresh', (r) =>
    json(r, { token: TEST_TOKEN, refresh_token: 'e2e-refresh', user: TEST_USER })
  );
  await page.route('**/api/auth/logout', (r) => json(r, { message: 'Logged out' }));
  await page.route('**/api/auth/me', (r) => json(r, TEST_USER));

  // Library / home data.
  await page.route('**/api/library/stats', (r) =>
    json(r, { books: 1, authors: 1, series: 0, formatCounts: [{ format: 'EPUB', count: 1 }] })
  );
  await page.route('**/api/books/recent**', (r) => json(r, [sampleBook]));
  await page.route('**/api/books/continue**', (r) => json(r, []));

  // Scan trigger + history + SSE progress stream (one-shot "done" frame).
  await page.route('**/api/admin/scans**', (r) => json(r, []));
  await page.route('**/api/admin/scan', (r) => json(r, { scan_id: 'scan-1' }));
  await page.route('**/api/admin/reindex-fulltext', (r) =>
    json(r, { message: 'Full-text reindex complete', indexed: 3, skipped: 0, total: 3 })
  );
  await page.route('**/api/admin/scans/scan-1/stream', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `event: done\ndata: ${JSON.stringify({ id: 'scan-1', status: 'COMPLETED', files_scanned: 1, files_added: 1, files_updated: 0, files_removed: 0, started_at: new Date().toISOString() })}\n\n`,
    })
  );

  // Reader side-channels.
  await page.route('**/api/bookmarks/**', (r) => json(r, []));
  await page.route('**/api/stats/heartbeat', (r) => json(r, { ok: true }));
  await page.route(`**/api/progress/${BOOK_ID}/${FILE_ID}`, (r) => {
    if (r.request().method() === 'PUT') return json(r, { ok: true });
    return json(r, { progress_percent: 0, finished: false, last_read_at: null });
  });
  await page.route(`**/api/progress/${BOOK_ID}/${FILE_ID}/finish`, (r) =>
    json(r, { finished: false })
  );

  // Book detail + the EPUB bytes the reader fetches.
  await page.route(`**/api/books/${BOOK_ID}`, (r) => json(r, sampleBook));
  await page.route(`**/api/books/${BOOK_ID}/file/${FILE_ID}**`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/epub+zip', body: SAMPLE_EPUB })
  );
  await page.route(`**/api/books/${BOOK_ID}/file/${FILE_ID}/ticket`, (r) =>
    json(r, { token: 'file-ticket' })
  );
}

/** Seed the persisted zustand auth store so the SPA boots authenticated. */
export async function seedAuth(page: Page) {
  await page.addInitScript(
    ([token, user]) => {
      window.localStorage.setItem(
        'auth-storage',
        JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 })
      );
    },
    [TEST_TOKEN, TEST_USER] as const
  );
}
