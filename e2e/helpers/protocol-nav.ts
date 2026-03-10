import { type Page } from '@playwright/test';

// Map from friendly name to hash route used by the app
const PROTOCOL_HASH: Record<string, string> = {
  'Echo': 'echo',
  'Discard': 'discard',
  'Daytime': 'daytime',
  'Chargen': 'chargen',
  'Time': 'time',
  'Finger': 'finger',
  'PostgreSQL': 'postgres',
  'MySQL': 'mysql',
  'MongoDB': 'mongodb',
  'MQTT': 'mqtt',
  'Redis': 'redis',
  'Memcached': 'memcached',
  'SSH': 'ssh',
  'FTP': 'ftp',
  'IRC': 'irc',
  'Telnet': 'telnet',
};

export async function navigateToProtocol(page: Page, protocolName: string): Promise<void> {
  const hash = PROTOCOL_HASH[protocolName] || protocolName.toLowerCase();

  // Navigate directly via hash route
  await page.goto(`/#${hash}`);
  await page.waitForTimeout(2000);
}
