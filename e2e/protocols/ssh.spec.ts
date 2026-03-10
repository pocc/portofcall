import { test, expect } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField } from '../helpers/form-helpers';
import { waitForWsConnected } from '../helpers/ws-helpers';

test.describe('SSH Protocol', () => {
  test('connects to SSH server', async ({ page }) => {
    await navigateToProtocol(page, 'SSH');
    await fillField(page, 'ssh-host', services.ssh.host);
    await fillField(page, 'ssh-port', services.ssh.port);
    await fillField(page, 'ssh-username', services.ssh.username);
    await fillField(page, 'ssh-password', services.ssh.password);
    await page.locator('button', { hasText: 'Connect' }).first().click();
    await waitForWsConnected(page, 20_000);
    // Check status text — use first() to avoid strict mode with xterm echoed text
    const statusText = page.locator('span.text-slate-300', { hasText: `${services.ssh.username}@${services.ssh.host}` }).first();
    await expect(statusText).toBeVisible({ timeout: 15_000 });
  });

  test('disconnects from SSH server', async ({ page }) => {
    await navigateToProtocol(page, 'SSH');
    await fillField(page, 'ssh-host', services.ssh.host);
    await fillField(page, 'ssh-port', services.ssh.port);
    await fillField(page, 'ssh-username', services.ssh.username);
    await fillField(page, 'ssh-password', services.ssh.password);
    await page.locator('button', { hasText: 'Connect' }).first().click();
    await waitForWsConnected(page, 20_000);
    await page.locator('button', { hasText: 'Disconnect' }).click();
    // Wait for the green dot to disappear (disconnected = bg-slate-500)
    await expect(page.locator('.bg-green-400.animate-pulse')).toBeHidden({ timeout: 10_000 });
  });
});
