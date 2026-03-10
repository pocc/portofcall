import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('portofcall-view', 'cards');
      localStorage.setItem('portofcall-theme', 'modern');
    });
    await page.reload();
    await page.waitForTimeout(500);
  });

  test('app loads and shows protocol selector', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('PORT OF CALL');
  });

  test('search filters protocols', async ({ page }) => {
    const search = page.getByPlaceholder(/Search protocols/i);
    await search.fill('Redis');
    const card = page.locator('button[aria-label^="Connect to Redis on port"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
  });

  test('can navigate to a protocol and back', async ({ page }) => {
    const search = page.getByPlaceholder(/Search protocols/i);
    await search.fill('Echo');
    await page.waitForTimeout(300);
    const card = page.locator('button[aria-label^="Connect to ECHO on port"]').first();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('#echo-host')).toBeVisible();
    await page.locator('button', { hasText: '← Back' }).click();
    await expect(page.locator('h1')).toContainText('PORT OF CALL');
  });
});
