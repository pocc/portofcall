import { test, expect } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField } from '../helpers/form-helpers';
import { waitForWsConnected } from '../helpers/ws-helpers';

test.describe('Telnet Protocol', () => {
  test('connects to Telnet server', async ({ page }) => {
    await navigateToProtocol(page, 'Telnet');
    await fillField(page, 'telnet-host', services.telnet.host);
    await fillField(page, 'telnet-port', services.telnet.port);
    await page.getByRole('button', { name: 'Connect' }).click();
    await waitForWsConnected(page, 20_000);
    // Telnet terminal output is DOM-readable
    const terminalOutput = page.locator('.overflow-y-auto').first();
    await expect(terminalOutput).toContainText(/Connected|WebSocket connected/i, { timeout: 15_000 });
  });

  test('sends command and receives output', async ({ page }) => {
    await navigateToProtocol(page, 'Telnet');
    await fillField(page, 'telnet-host', services.telnet.host);
    await fillField(page, 'telnet-port', services.telnet.port);
    await page.getByRole('button', { name: 'Connect' }).click();
    await waitForWsConnected(page, 20_000);
    await page.waitForTimeout(1000);
    // Use a quick command button if available, otherwise type
    const helpBtn = page.getByRole('button', { name: 'help' });
    if (await helpBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await helpBtn.click();
    } else {
      const input = page.locator('input[type="text"]').last();
      await input.fill('help');
      await input.press('Enter');
    }
    const terminalOutput = page.locator('.overflow-y-auto').first();
    await expect(terminalOutput).toContainText(/help|available|command/i, { timeout: 10_000 });
  });
});
