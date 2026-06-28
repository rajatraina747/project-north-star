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
