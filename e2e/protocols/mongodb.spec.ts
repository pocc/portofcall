import { test } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField, clickAction, expectSuccess } from '../helpers/form-helpers';

test.describe('MongoDB Protocol', () => {
  test('connects to MongoDB server', async ({ page }) => {
    await navigateToProtocol(page, 'MongoDB');
    await fillField(page, 'mongodb-host', services.mongodb.host);
    await fillField(page, 'mongodb-port', services.mongodb.port);
    await clickAction(page, 'Test Connection');
    await expectSuccess(page, 'Connected to MongoDB');
  });

  test('pings MongoDB server', async ({ page }) => {
    await navigateToProtocol(page, 'MongoDB');
    await fillField(page, 'mongodb-host', services.mongodb.host);
    await fillField(page, 'mongodb-port', services.mongodb.port);
    await clickAction(page, 'Ping');
    await expectSuccess(page, /PONG|responded/i);
  });
});
