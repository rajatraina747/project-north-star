import { test, expect } from '@playwright/test';
import { mockApi } from './mock-api';

test.describe('authentication', () => {
  test('first-run register creates the admin and enters the app', async ({ page }) => {
    await mockApi(page, { registrationOpen: true });
    await page.goto('/');

    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Email').fill('admin@example.com');
    await page.getByLabel('Password').fill('s3cret-pass');
    await page.getByRole('button', { name: 'Create Admin Account' }).click();

    // Landing in the app renders the primary nav.
    await expect(page.getByRole('link', { name: 'Library' })).toBeVisible();
  });

  test('existing user can log in', async ({ page }) => {
    await mockApi(page, { registrationOpen: false });
    await page.goto('/');

    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('s3cret-pass');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.getByRole('link', { name: 'Library' })).toBeVisible();
  });
});
