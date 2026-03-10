import { test } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField } from '../helpers/form-helpers';
import { waitForWsConnected, sendReplCommand, waitForReplOutput } from '../helpers/ws-helpers';

test.describe('Memcached Protocol', () => {
  test('connects to Memcached', async ({ page }) => {
    await navigateToProtocol(page, 'Memcached');
    await fillField(page, 'memcached-host', services.memcached.host);
    await fillField(page, 'memcached-port', services.memcached.port);
    await page.getByRole('button', { name: 'Connect' }).click();
    await waitForWsConnected(page);
  });

  test('version command', async ({ page }) => {
    await navigateToProtocol(page, 'Memcached');
    await fillField(page, 'memcached-host', services.memcached.host);
    await fillField(page, 'memcached-port', services.memcached.port);
    await page.getByRole('button', { name: 'Connect' }).click();
    await waitForWsConnected(page);
    await sendReplCommand(page, 'version');
    await waitForReplOutput(page, 'VERSION');
  });

  test('stats command', async ({ page }) => {
    await navigateToProtocol(page, 'Memcached');
    await fillField(page, 'memcached-host', services.memcached.host);
    await fillField(page, 'memcached-port', services.memcached.port);
    await page.getByRole('button', { name: 'Connect' }).click();
    await waitForWsConnected(page);
    await sendReplCommand(page, 'stats');
    await waitForReplOutput(page, 'STAT');
  });

  test('set and get key', async ({ page }) => {
    await navigateToProtocol(page, 'Memcached');
    await fillField(page, 'memcached-host', services.memcached.host);
    await fillField(page, 'memcached-port', services.memcached.port);
    await page.getByRole('button', { name: 'Connect' }).click();
    await waitForWsConnected(page);
    await sendReplCommand(page, 'set e2ekey 0 60 7\r\ntestval');
    await waitForReplOutput(page, 'STORED');
    await sendReplCommand(page, 'get e2ekey');
    await waitForReplOutput(page, 'testval');
  });
});
