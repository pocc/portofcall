import { type Page, expect } from '@playwright/test';

export async function fillField(page: Page, id: string, value: string): Promise<void> {
  const field = page.locator(`#${id}`);
  await field.clear();
  await field.fill(value);
}

export async function clickAction(page: Page, buttonText: string): Promise<void> {
  // Use locator with hasText to match visible button text (aria-labels may differ)
  await page.locator('button', { hasText: buttonText }).first().click();
}

export async function expectSuccess(page: Page, text: string | RegExp, timeout = 15_000): Promise<void> {
  // Try shared ResultDisplay first, then fall back to any region element
  const liveRegion = page.locator('[role="region"][aria-live="polite"]');
  const anyRegion = page.locator('[role="region"]');
  const target = await liveRegion.count() > 0 ? liveRegion : anyRegion;
  await expect(target).toContainText(text, { timeout });
}

export async function expectError(page: Page, text: string | RegExp, timeout = 15_000): Promise<void> {
  const region = page.locator('[role="region"][aria-live="polite"]');
  await expect(region).toContainText(text, { timeout });
}
