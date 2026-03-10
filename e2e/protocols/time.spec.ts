import { test } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField, clickAction, expectSuccess } from '../helpers/form-helpers';

test.describe('Time Protocol', () => {
  test('gets binary time', async ({ page }) => {
    test.setTimeout(90_000);
    await navigateToProtocol(page, 'Time');
    await fillField(page, 'time-host', services.time.host);
    await fillField(page, 'time-port', services.time.port);
    await clickAction(page, 'Get Binary Time');
    await expectSuccess(page, 'Raw Time Value', 30_000);
  });
});
