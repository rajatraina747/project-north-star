import { defineConfig, devices } from '@playwright/test';

// End-to-end tests for the web app. The backend is stubbed at the network
// boundary (see e2e/mock-api.ts) so the suite runs with no Postgres/server and
// stays deterministic — matching the project's "no cloud dependencies" rule.
// The Vite dev server serves the real app; its /api proxy is never hit because
// every /api request is fulfilled by Playwright route handlers.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
