import { test } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField, clickAction, expectSuccess } from '../helpers/form-helpers';

test.describe('PostgreSQL Protocol', () => {
  test('connects to PostgreSQL server', async ({ page }) => {
    await navigateToProtocol(page, 'PostgreSQL');
    await fillField(page, 'postgres-host', services.postgresql.host);
    await fillField(page, 'postgres-port', services.postgresql.port);
    await fillField(page, 'postgres-username', services.postgresql.username);
    await fillField(page, 'postgres-password', services.postgresql.password);
    await fillField(page, 'postgres-database', services.postgresql.database);
    await clickAction(page, 'Test Connection');
    await expectSuccess(page, 'Connected to PostgreSQL');
  });
});
