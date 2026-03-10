import { test } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField, expectSuccess } from '../helpers/form-helpers';

test.describe('Discard Protocol', () => {
  test('sends data and confirms discard', async ({ page }) => {
    await navigateToProtocol(page, 'Discard');
    await fillField(page, 'discard-host', services.discard.host);
    await fillField(page, 'discard-port', services.discard.port);
    // discard-data is a textarea
    const textarea = page.locator('#discard-data');
    await textarea.clear();
    await textarea.fill('Test discard data payload');
    await page.getByRole('button', { name: /Send Data/i }).click();
    await expectSuccess(page, /sent successfully/i);
  });
});
