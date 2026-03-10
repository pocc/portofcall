import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('app loads and shows header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=L4.FYI')).toBeVisible({ timeout: 15_000 });
  });

  test('command palette search works', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    // Open command palette via keyboard shortcut
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(500);
    const searchInput = page.getByPlaceholder(/Search protocols by name/i);
    await searchInput.fill('Redis');
    await page.waitForTimeout(300);
    // Verify Redis appears in results
    await expect(page.getByRole('button', { name: 'Redis :6379' }).first()).toBeVisible();
  });

  test('can navigate to a protocol via hash and back', async ({ page }) => {
    await page.goto('/#echo');
    await page.waitForTimeout(2000);
    await expect(page.locator('#echo-host')).toBeVisible();
    // Navigate back
    await page.locator('button', { hasText: /Back/i }).click();
    await page.waitForTimeout(1000);
    await expect(page.locator('text=L4.FYI')).toBeVisible();
  });
});
