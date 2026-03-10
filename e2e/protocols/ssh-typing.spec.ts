import { test, expect } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { fillField } from '../helpers/form-helpers';
import { waitForWsConnected } from '../helpers/ws-helpers';

test.describe('SSH Terminal Typing', () => {
  test('can type in terminal after connecting', async ({ page }) => {
    // Intercept WebSocket to verify keystrokes are sent
    await page.addInitScript(() => {
      const OrigWebSocket = window.WebSocket;
      (window as unknown as Record<string, unknown>).__wsSentMessages = [];
      window.WebSocket = class extends OrigWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          const origSend = this.send.bind(this);
          this.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
            if (typeof data === 'string') {
              (window as unknown as Record<string, string[]>).__wsSentMessages.push(data);
            }
            return origSend(data);
          };
        }
      } as unknown as typeof WebSocket;
    });

    await page.goto('/#ssh');
    await page.waitForTimeout(2000);

    await fillField(page, 'ssh-host', services.ssh.host);
    await fillField(page, 'ssh-port', services.ssh.port);
    await fillField(page, 'ssh-username', services.ssh.username);
    await fillField(page, 'ssh-password', services.ssh.password);
    await page.locator('button', { hasText: 'Connect' }).first().click();
    await waitForWsConnected(page, 20_000);

    const statusText = page.locator('span.text-slate-300', {
      hasText: `${services.ssh.username}@${services.ssh.host}`,
    }).first();
    await expect(statusText).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);

    // Click the terminal to focus it
    const termDiv = page.locator('[aria-label="SSH terminal"]');
    await termDiv.click();
    await page.waitForTimeout(500);

    // Type a command
    await page.keyboard.type('echo hello-playwright-test');
    await page.waitForTimeout(1000);

    // Verify keystrokes were sent via WebSocket
    const msgs = await page.evaluate(() => (window as unknown as Record<string, string[]>).__wsSentMessages);
    const typingMsgs = msgs.filter((m: string) => !m.startsWith('{'));
    expect(typingMsgs.length).toBeGreaterThan(0);

    // Press Enter to execute
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Verify the xterm textarea exists and can receive focus
    const xtermTextarea = page.locator('.xterm-helper-textarea');
    expect(await xtermTextarea.count()).toBeGreaterThan(0);
  });
});
