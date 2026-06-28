import { test, expect } from '@playwright/test';
import { mockApi, seedAuth } from './mock-api';

test('triggering a library scan posts to the scan endpoint', async ({ page }) => {
  await seedAuth(page);
  await mockApi(page);
  await page.goto('/admin');

  const scanRequest = page.waitForRequest(
    (req) => req.url().endsWith('/api/admin/scan') && req.method() === 'POST'
  );
  await page.getByRole('button', { name: 'Start Scan' }).click();
  await scanRequest;

  // After the scan kicks off (and the mocked progress stream completes), the
  // page surfaces the success notice.
  await expect(page.getByText('Scan started successfully!')).toBeVisible();
});

test('reindexing the full-text search index reports how many books were indexed', async ({ page }) => {
  await seedAuth(page);
  await mockApi(page);
  await page.goto('/admin');

  await page.getByRole('button', { name: 'Reindex full text' }).click();
  await expect(page.getByText(/Indexed 3 book\(s\) for in-book search\./)).toBeVisible();
});
