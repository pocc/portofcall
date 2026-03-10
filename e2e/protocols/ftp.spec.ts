import { test, expect } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField } from '../helpers/form-helpers';
import { waitForWsConnected } from '../helpers/ws-helpers';

const testDir = `e2e_testdir_${Date.now()}`;

async function connectFtp(page: import('@playwright/test').Page) {
  await navigateToProtocol(page, 'FTP');
  await fillField(page, 'ftp-host', services.ftp.host);
  await fillField(page, 'ftp-port', services.ftp.port);
  await fillField(page, 'ftp-username', services.ftp.username);
  await fillField(page, 'ftp-password', services.ftp.password);
  await page.locator('button', { hasText: 'Connect' }).first().click();
  await waitForWsConnected(page, 20_000);
  // Wait for log entry confirming connection — use the Logs section specifically
  const logsSection = page.locator('h2', { hasText: 'Logs' }).locator('..');
  await expect(logsSection).toContainText(/Connected to/i, { timeout: 15_000 });
}

async function openCommand(page: import('@playwright/test').Page, commandText: string) {
  await page.locator('button', { hasText: /Commands/i }).click();
  await page.waitForTimeout(300);
  await page.locator('button', { hasText: commandText }).click();
  await page.waitForTimeout(500);
}

test.describe('FTP Protocol', () => {
  test.describe.configure({ mode: 'serial' });

  test('connects to FTP server', async ({ page }) => {
    await connectFtp(page);
  });

  test('lists directory after connect', async ({ page }) => {
    await connectFtp(page);
    await expect(page.locator('h2', { hasText: 'File Browser' })).toBeVisible();
  });

  test('creates a directory', async ({ page }) => {
    await connectFtp(page);
    await openCommand(page, 'Create Directory');
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible();
    await modal.locator('input[placeholder="Directory name"]').fill(testDir);
    await modal.locator('button', { hasText: 'Create' }).click();
    const logsSection = page.locator('h2', { hasText: 'Logs' }).locator('..');
    await expect(logsSection).toContainText(/success|created|257/i, { timeout: 10_000 });
  });

  test('uploads a file', async ({ page }) => {
    await connectFtp(page);
    // Navigate into the test directory if visible
    const dirButton = page.locator(`[role="button"][aria-label*="${testDir}"]`);
    if (await dirButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await dirButton.click();
      await page.waitForTimeout(1000);
    }
    await openCommand(page, 'Upload File');
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await modal.locator('button', { hasText: 'Choose File' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'e2e_test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('e2e test content'),
    });
    const uploadBtn = modal.locator('button', { hasText: /Upload/i });
    if (await uploadBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await uploadBtn.click();
    }
    const logsSection = page.locator('h2', { hasText: 'Logs' }).locator('..');
    await expect(logsSection).toContainText(/success|uploaded|226|150/i, { timeout: 15_000 });
  });

  test('downloads a file', async ({ page }) => {
    await connectFtp(page);
    await openCommand(page, 'Download Files');
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible();
    const checkbox = modal.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      await checkbox.check();
      await modal.locator('button', { hasText: /Download/i }).click();
      const logsSection = page.locator('h2', { hasText: 'Logs' }).locator('..');
      await expect(logsSection).toContainText(/success|download|226/i, { timeout: 15_000 });
    }
  });

  test('renames a file', async ({ page }) => {
    await connectFtp(page);
    await openCommand(page, 'Rename');
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible();
    const radio = modal.locator('input[name="renameFile"]').first();
    if (await radio.isVisible({ timeout: 3000 }).catch(() => false)) {
      await radio.check();
      await modal.locator('input[placeholder="New filename"]').fill(`renamed_${Date.now()}.txt`);
      await modal.locator('button', { hasText: 'Rename' }).click();
      const logsSection = page.locator('h2', { hasText: 'Logs' }).locator('..');
      await expect(logsSection).toContainText(/success|renamed|250/i, { timeout: 10_000 });
    }
  });

  test('deletes files', async ({ page }) => {
    await connectFtp(page);
    await openCommand(page, 'Delete Files');
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible();
    const checkbox = modal.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      await checkbox.check();
      await modal.locator('button', { hasText: /Delete/i }).click();
      const logsSection = page.locator('h2', { hasText: 'Logs' }).locator('..');
      await expect(logsSection).toContainText(/success|deleted|250/i, { timeout: 10_000 });
    }
  });

  test('removes directory', async ({ page }) => {
    await connectFtp(page);
    await openCommand(page, 'Remove Directory');
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible();
    const checkbox = modal.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      await checkbox.check();
      await modal.locator('button', { hasText: /Remove/i }).click();
      const logsSection = page.locator('h2', { hasText: 'Logs' }).locator('..');
      await expect(logsSection).toContainText(/success|removed|250/i, { timeout: 10_000 });
    }
  });
});
