import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi, seedAuth, BOOK_ID, FILE_ID } from './mock-api';

// Automated accessibility checks (axe-core) for the primary pages and the
// reader. We gate on serious/critical violations of WCAG 2 A/AA rules,
// focusing on the structural/semantic concerns this work targets (roles,
// names, labels, focus order). `color-contrast` is intentionally excluded: it
// flags the app's existing parchment/ink color palette, and recoloring the
// design system is out of scope for this accessibility pass.
const analyze = (page: import('@playwright/test').Page) =>
  new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['color-contrast'])
    // The EPUB renders third-party content into an iframe we don't control.
    .exclude('iframe')
    .analyze();

const serious = (violations: Awaited<ReturnType<typeof analyze>>['violations']) =>
  violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');

test.describe('accessibility', () => {
  test('login screen has no serious axe violations', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.getByLabel('Username').waitFor();
    const { violations } = await analyze(page);
    expect(serious(violations)).toEqual([]);
  });

  test('home page has no serious axe violations', async ({ page }) => {
    await seedAuth(page);
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Library' })).toBeVisible();
    const { violations } = await analyze(page);
    expect(serious(violations)).toEqual([]);
  });

  test('skip link is the first tab stop and jumps to main content', async ({ page }) => {
    await seedAuth(page);
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Library' })).toBeVisible();

    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();

    await skip.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('reader has no serious axe violations', async ({ page }) => {
    await seedAuth(page);
    await mockApi(page);
    await page.goto(`/read/${BOOK_ID}/${FILE_ID}`);
    await expect(page.locator('iframe').first()).toBeAttached({ timeout: 30_000 });
    const { violations } = await analyze(page);
    expect(serious(violations)).toEqual([]);
  });
});
