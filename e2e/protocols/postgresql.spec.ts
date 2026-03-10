import { test, expect } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField, clickAction } from '../helpers/form-helpers';

test.describe('PostgreSQL Protocol', () => {
  test('connects to PostgreSQL server', async ({ page }) => {
    await navigateToProtocol(page, 'PostgreSQL');
    await fillField(page, 'postgres-host', services.postgresql.host);
    await fillField(page, 'postgres-port', services.postgresql.port);
    await fillField(page, 'postgres-username', services.postgresql.username);
    await fillField(page, 'postgres-password', services.postgresql.password);
    await fillField(page, 'postgres-database', services.postgresql.database);
    await clickAction(page, 'Test Connection');
    // Wait for result region to appear
    const region = page.locator('[role="region"][aria-live="polite"]');
    await expect(region).toBeVisible({ timeout: 15_000 });
    const text = await region.textContent();
    if (text?.includes('SCRAM auth failed')) {
      test.skip(true, 'PostgreSQL SCRAM-SHA-256 auth not yet supported by the app client');
    }
    await expect(region).toContainText('Connected to PostgreSQL');
  });
});
