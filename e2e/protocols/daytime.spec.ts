import { test } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField, clickAction, expectSuccess } from '../helpers/form-helpers';

test.describe('Daytime Protocol', () => {
  test('gets remote time', async ({ page }) => {
    await navigateToProtocol(page, 'Daytime');
    await fillField(page, 'daytime-host', services.daytime.host);
    await fillField(page, 'daytime-port', services.daytime.port);
    await clickAction(page, 'Get Time');
    await expectSuccess(page, 'Remote Time');
  });
});
