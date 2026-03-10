import { defineConfig } from '@playwright/test';
import { config } from 'dotenv';
config({ path: '.env.e2e' });

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 1,
  reporter: [['html', { outputFolder: 'e2e-results' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://l4.fyi',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
