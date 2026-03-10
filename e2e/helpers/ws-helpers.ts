import { type Page, expect } from '@playwright/test';

export async function waitForWsConnected(page: Page, timeout = 15_000): Promise<void> {
  await expect(
    page.locator('.bg-green-400.animate-pulse').first()
  ).toBeVisible({ timeout });
}

export async function sendReplCommand(page: Page, command: string): Promise<void> {
  // Find the REPL input (placeholder varies: "PING" for Redis, etc.)
  const input = page.locator('input[type="text"]').last();
  await input.fill(command);
  await input.press('Enter');
  // Small delay to let the response come back
  await page.waitForTimeout(500);
}

export async function waitForReplOutput(page: Page, text: string | RegExp, timeout = 10_000): Promise<void> {
  // REPL output is in a scrollable div with .font-mono
  const output = page.locator('.overflow-y-auto.font-mono').first();
  await expect(output).toContainText(text, { timeout });
}
