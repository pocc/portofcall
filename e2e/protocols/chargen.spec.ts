import { test, expect } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField, clickAction } from '../helpers/form-helpers';

test.describe('Chargen Protocol', () => {
  test('receives character stream', async ({ page }) => {
    test.setTimeout(90_000);
    await navigateToProtocol(page, 'Chargen');
    await fillField(page, 'chargen-host', services.chargen.host);
    await fillField(page, 'chargen-port', services.chargen.port);
    await fillField(page, 'chargen-maxbytes', '1024');
    await clickAction(page, 'Receive Stream');
    // Chargen uses custom result display, not the shared ResultDisplay component
    await expect(page.locator('text=Bytes Received')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('h3', { hasText: 'Success' })).toBeVisible({ timeout: 5_000 });
  });
});
