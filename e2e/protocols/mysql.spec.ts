import { test } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField, clickAction, expectSuccess } from '../helpers/form-helpers';

test.describe('MySQL Protocol', () => {
  test('connects to MySQL server', async ({ page }) => {
    await navigateToProtocol(page, 'MySQL');
    await fillField(page, 'mysql-host', services.mysql.host);
    await fillField(page, 'mysql-port', services.mysql.port);
    await fillField(page, 'mysql-username', services.mysql.username);
    await fillField(page, 'mysql-password', services.mysql.password);
    await fillField(page, 'mysql-database', services.mysql.database);
    await clickAction(page, 'Test Connection');
    await expectSuccess(page, 'Connected to MySQL');
  });
});
