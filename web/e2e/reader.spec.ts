import { test, expect } from '@playwright/test';
import { mockApi, seedAuth, BOOK_ID, FILE_ID } from './mock-api';

const PROGRESS_KEY = 'reader:progress:v1';

// Poll the persisted reader progress until the EPUB has rendered and saved its
// position (epub.js fires `relocated` on first display, which commits progress).
const waitForProgress = (page: import('@playwright/test').Page) =>
  page.waitForFunction(
    (key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return false;
      const entries = JSON.parse(raw);
      return Object.keys(entries).length > 0;
    },
    PROGRESS_KEY,
    { timeout: 30_000 }
  );

test('reading progress persists across a reload', async ({ page }) => {
  await seedAuth(page);
  await mockApi(page);

  await page.goto(`/read/${BOOK_ID}/${FILE_ID}`);

  // The EPUB renders into an iframe inside the reader viewer.
  await expect(page.locator('iframe').first()).toBeAttached({ timeout: 30_000 });
  await waitForProgress(page);

  const before = await page.evaluate((key) => window.localStorage.getItem(key), PROGRESS_KEY);
  expect(before).toBeTruthy();
  const beforeEntry = JSON.parse(before!)[`${BOOK_ID}:EPUB`];
  expect(beforeEntry).toBeTruthy();
  expect(beforeEntry.cfi).toBeTruthy();

  // Reload — progress must survive and the reader must come back up.
  await page.reload();
  await expect(page.locator('iframe').first()).toBeAttached({ timeout: 30_000 });

  const after = await page.evaluate((key) => window.localStorage.getItem(key), PROGRESS_KEY);
  const afterEntry = JSON.parse(after!)[`${BOOK_ID}:EPUB`];
  expect(afterEntry).toBeTruthy();
  expect(afterEntry.cfi).toBe(beforeEntry.cfi);
});
