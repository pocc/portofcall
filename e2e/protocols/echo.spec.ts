import { test } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField, clickAction, expectSuccess } from '../helpers/form-helpers';

test.describe('Echo Protocol', () => {
  test('sends message and receives echo match', async ({ page }) => {
    await navigateToProtocol(page, 'Echo');
    await fillField(page, 'echo-host', services.echo.host);
    await fillField(page, 'echo-port', services.echo.port);
    await fillField(page, 'echo-message', 'Hello, ECHO!');
    await clickAction(page, 'Test Echo');
    await expectSuccess(page, 'MATCHED');
  });
});
