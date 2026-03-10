import { type Page } from '@playwright/test';

// Map from search term to exact protocol name in aria-label
const PROTOCOL_NAMES: Record<string, string> = {
  'Echo': 'ECHO',
  'Discard': 'Discard',
  'Daytime': 'Daytime',
  'Chargen': 'CHARGEN',
  'Time': 'TIME',
  'Finger': 'Finger',
  'PostgreSQL': 'PostgreSQL',
  'MySQL': 'MySQL',
  'MongoDB': 'MongoDB',
  'MQTT': 'MQTT',
  'Redis': 'Redis',
  'Memcached': 'Memcached',
  'SSH': 'SSH',
  'FTP': 'FTP (Passive Mode)',
  'IRC': 'IRC',
  'Telnet': 'Telnet',
};

export async function navigateToProtocol(page: Page, protocolName: string): Promise<void> {
  // Always start fresh from base URL
  await page.goto('/');
  await page.waitForTimeout(300);

  // Force 'cards' view mode and modern theme for consistent selectors
  await page.evaluate(() => {
    localStorage.setItem('portofcall-view', 'cards');
    localStorage.setItem('portofcall-theme', 'modern');
  });
  await page.reload();
  await page.waitForTimeout(500);

  // Search for the protocol
  const searchInput = page.getByPlaceholder(/Search protocols/i);
  await searchInput.fill(protocolName);
  await page.waitForTimeout(500);

  // Get the exact name for aria-label matching
  const exactName = PROTOCOL_NAMES[protocolName] || protocolName;

  // Click the protocol card using aria-label with exact name
  const card = page.locator(`button[aria-label^="Connect to ${exactName} on port"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.click();

  // Wait for the lazy-loaded component to render
  await page.waitForTimeout(1500);
}
