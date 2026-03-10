import { test, expect } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField } from '../helpers/form-helpers';
import { waitForWsConnected, sendReplCommand, waitForReplOutput } from '../helpers/ws-helpers';

test.describe('Redis Protocol', () => {
  const uniqueKey = `e2e_${Date.now()}`;

  test('connects to Redis', async ({ page }) => {
    await navigateToProtocol(page, 'Redis');
    await fillField(page, 'redis-host', services.redis.host);
    await fillField(page, 'redis-port', services.redis.port);
    await page.getByRole('button', { name: 'Connect' }).click();
    await waitForWsConnected(page);
    await waitForReplOutput(page, /Connected to/i);
  });

  test('PING returns PONG', async ({ page }) => {
    await navigateToProtocol(page, 'Redis');
    await fillField(page, 'redis-host', services.redis.host);
    await fillField(page, 'redis-port', services.redis.port);
    await page.getByRole('button', { name: 'Connect' }).click();
    await waitForWsConnected(page);
    await sendReplCommand(page, 'PING');
    await waitForReplOutput(page, 'PONG');
  });

  test('SET and GET key', async ({ page }) => {
    await navigateToProtocol(page, 'Redis');
    await fillField(page, 'redis-host', services.redis.host);
    await fillField(page, 'redis-port', services.redis.port);
    await page.getByRole('button', { name: 'Connect' }).click();
    await waitForWsConnected(page);

    await sendReplCommand(page, `SET ${uniqueKey} "testval"`);
    await waitForReplOutput(page, 'OK');
    await sendReplCommand(page, `GET ${uniqueKey}`);
    await waitForReplOutput(page, 'testval');
    // Cleanup
    await sendReplCommand(page, `DEL ${uniqueKey}`);
  });

  test('INFO server', async ({ page }) => {
    await navigateToProtocol(page, 'Redis');
    await fillField(page, 'redis-host', services.redis.host);
    await fillField(page, 'redis-port', services.redis.port);
    await page.getByRole('button', { name: 'Connect' }).click();
    await waitForWsConnected(page);
    await sendReplCommand(page, 'INFO server');
    await waitForReplOutput(page, '# Server');
  });

  test('KEYS returns response', async ({ page }) => {
    await navigateToProtocol(page, 'Redis');
    await fillField(page, 'redis-host', services.redis.host);
    await fillField(page, 'redis-port', services.redis.port);
    await page.getByRole('button', { name: 'Connect' }).click();
    await waitForWsConnected(page);
    await sendReplCommand(page, 'KEYS *');
    // Just verify some output appeared after the command
    const output = page.locator('.overflow-y-auto.font-mono').first();
    await expect(output).toContainText('KEYS', { timeout: 10_000 });
  });
});
