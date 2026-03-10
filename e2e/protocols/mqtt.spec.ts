import { test } from '@playwright/test';
import { services } from '../fixtures/test-config';
import { navigateToProtocol } from '../helpers/protocol-nav';
import { fillField, clickAction, expectSuccess } from '../helpers/form-helpers';

test.describe('MQTT Protocol', () => {
  test('connects to MQTT broker', async ({ page }) => {
    await navigateToProtocol(page, 'MQTT');
    await fillField(page, 'mqtt-host', services.mqtt.host);
    await fillField(page, 'mqtt-port', services.mqtt.port);
    await clickAction(page, 'Test Connection');
    await expectSuccess(page, 'Connected to MQTT');
  });
});
