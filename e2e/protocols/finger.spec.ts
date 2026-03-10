import { test } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField, clickAction, expectSuccess } from '../helpers/form-helpers';

test.describe('Finger Protocol', () => {
  test('queries finger server', async ({ page }) => {
    await navigateToProtocol(page, 'Finger');
    await fillField(page, 'finger-host', services.finger.host);
    await fillField(page, 'finger-port', services.finger.port);
    await clickAction(page, 'Finger Query');
    await expectSuccess(page, /Query/i);
  });
});
