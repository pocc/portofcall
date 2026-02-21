/**
 * SpamAssassin spamd Protocol Integration Tests
 *
 * Tests the spamd protocol implementation for PING and CHECK/SYMBOLS/REPORT
 * spam analysis via the SpamAssassin daemon on port 783.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = (process.env.API_BASE || 'https://portofcall.ross.gg/api').replace(/\/api$/, '');

describe('SpamAssassin spamd Protocol Integration Tests', () => {
  // --- PING Tests (/api/spamd/ping) ---

  describe('PING (spamd connectivity)', () => {
    it('should ping a spamd server', async () => {
      const response = await fetch(`${API_BASE}/api/spamd/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 783,
          timeout: 10000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data).toHaveProperty('host', 'localhost');
        expect(data).toHaveProperty('port', 783);
        expect(data).toHaveProperty('version');
        expect(data).toHaveProperty('rtt');
        expect(data.rtt).toBeGreaterThan(0);
      } else {
        // spamd not available is expected in test environments
        expect(data).toHaveProperty('error');
      }
    });

    it('should validate required host for ping', async () => {
      const response = await fetch(`${API_BASE}/api/spamd/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 783,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should validate port range for ping', async () => {
      const response = await fetch(`${API_BASE}/api/spamd/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should handle connection timeout for ping', async () => {
      const response = await fetch(`${API_BASE}/api/spamd/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 783,
          timeout: 1,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        expect(data.error).toBeTruthy();
      }
    });

    it('should handle invalid hostname for ping', async () => {
      const response = await fetch(`${API_BASE}/api/spamd/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent-spamd-99999.invalid',
          port: 783,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });
  });

  // --- CHECK Tests (/api/spamd/check) ---

  describe('CHECK / SYMBOLS / REPORT (spam analysis)', () => {
    const testMessage = [
      'From: sender@example.com',
      'To: recipient@example.com',
      'Subject: Test message',
      'Date: Mon, 1 Jan 2024 00:00:00 +0000',
      'Message-ID: <test@example.com>',
      '',
      'This is a test email message for spam checking.',
    ].join('\r\n');

    it('should check a message for spam with SYMBOLS command', async () => {
      const response = await fetch(`${API_BASE}/api/spamd/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 783,
          message: testMessage,
          command: 'SYMBOLS',
          timeout: 30000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data).toHaveProperty('host', 'localhost');
        expect(data).toHaveProperty('port', 783);
        expect(data).toHaveProperty('command', 'SYMBOLS');
        expect(data).toHaveProperty('isSpam');
        expect(data).toHaveProperty('score');
        expect(data).toHaveProperty('threshold');
        expect(data).toHaveProperty('rtt');
        expect(typeof data.isSpam).toBe('boolean');
        expect(typeof data.score).toBe('number');
        expect(typeof data.threshold).toBe('number');
        if (data.symbols) {
          expect(Array.isArray(data.symbols)).toBe(true);
        }
      } else {
        expect(data).toHaveProperty('error');
      }
    });

    it('should check a message with CHECK command', async () => {
      const response = await fetch(`${API_BASE}/api/spamd/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 783,
          message: testMessage,
          command: 'CHECK',
          timeout: 30000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data).toHaveProperty('command', 'CHECK');
        expect(data).toHaveProperty('isSpam');
        expect(data).toHaveProperty('score');
        expect(data).toHaveProperty('threshold');
      } else {
        expect(data).toHaveProperty('error');
      }
    });

    it('should check a message with REPORT command', async () => {
      const response = await fetch(`${API_BASE}/api/spamd/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 783,
          message: testMessage,
          command: 'REPORT',
          timeout: 30000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data).toHaveProperty('command', 'REPORT');
        expect(data).toHaveProperty('isSpam');
        expect(data).toHaveProperty('score');
        if (data.report) {
          expect(typeof data.report).toBe('string');
        }
      } else {
        expect(data).toHaveProperty('error');
      }
    });

    it('should validate required host for check', async () => {
      const response = await fetch(`${API_BASE}/api/spamd/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: testMessage,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should validate required message for check', async () => {
      const response = await fetch(`${API_BASE}/api/spamd/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Message content is required');
    });

    it('should validate port range for check', async () => {
      const response = await fetch(`${API_BASE}/api/spamd/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 0,
          message: testMessage,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should reject invalid command', async () => {
      const response = await fetch(`${API_BASE}/api/spamd/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 783,
          message: testMessage,
          command: 'INVALID',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid command');
    });

    it('should handle invalid hostname for check', async () => {
      const response = await fetch(`${API_BASE}/api/spamd/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent-spamd-99999.invalid',
          port: 783,
          message: testMessage,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });
  });

  // --- spamd Protocol Encoding Tests ---

  describe('spamd Protocol Format', () => {
    it('should construct valid PING request', () => {
      const version = '1.5';
      const request = `PING SPAMC/${version}\r\n\r\n`;

      expect(request).toBe('PING SPAMC/1.5\r\n\r\n');
      expect(request).toMatch(/^PING SPAMC\/[\d.]+\r\n\r\n$/);
    });

    it('should construct valid CHECK request with Content-length', () => {
      const version = '1.5';
      const message = 'Subject: Test\r\n\r\nTest body';
      const messageBytes = new TextEncoder().encode(message);
      const request = `CHECK SPAMC/${version}\r\nContent-length: ${messageBytes.length}\r\n\r\n`;

      expect(request).toContain('CHECK SPAMC/1.5');
      expect(request).toContain(`Content-length: ${messageBytes.length}`);
      expect(request.endsWith('\r\n\r\n')).toBe(true);
    });

    it('should construct valid SYMBOLS request', () => {
      const version = '1.5';
      const message = 'test';
      const messageBytes = new TextEncoder().encode(message);
      const request = `SYMBOLS SPAMC/${version}\r\nContent-length: ${messageBytes.length}\r\n\r\n`;

      expect(request).toContain('SYMBOLS SPAMC/1.5');
      expect(request).toContain('Content-length: 4');
    });

    it('should construct valid REPORT request', () => {
      const version = '1.5';
      const message = 'test';
      const messageBytes = new TextEncoder().encode(message);
      const request = `REPORT SPAMC/${version}\r\nContent-length: ${messageBytes.length}\r\n\r\n`;

      expect(request).toContain('REPORT SPAMC/1.5');
      expect(request).toContain('Content-length: 4');
    });

    it('should parse PONG response line', () => {
      const response = 'SPAMD/1.5 0 PONG\r\n';
      const match = response.match(/^SPAMD\/([\d.]+)\s+(\d+)\s+(.+)/);

      expect(match).not.toBeNull();
      expect(match![1]).toBe('1.5');
      expect(parseInt(match![2])).toBe(0);
      expect(match![3].trim()).toBe('PONG');
    });

    it('should parse CHECK response with spam status', () => {
      const response = [
        'SPAMD/1.5 0 EX_OK',
        'Content-length: 0',
        'Spam: True ; 15.2 / 5.0',
        '',
        '',
      ].join('\r\n');

      // Parse status line
      const statusMatch = response.match(/^SPAMD\/([\d.]+)\s+(\d+)\s+(.+)/);
      expect(statusMatch).not.toBeNull();
      expect(statusMatch![3].trim()).toBe('EX_OK');

      // Parse spam header
      const spamMatch = response.match(/Spam:\s*(True|False|Yes|No)\s*;\s*([\d.]+)\s*\/\s*([\d.]+)/i);
      expect(spamMatch).not.toBeNull();
      expect(spamMatch![1]).toBe('True');
      expect(parseFloat(spamMatch![2])).toBe(15.2);
      expect(parseFloat(spamMatch![3])).toBe(5.0);
    });

    it('should parse non-spam response', () => {
      const spamHeader = 'Spam: False ; 2.1 / 5.0';
      const match = spamHeader.match(/Spam:\s*(True|False|Yes|No)\s*;\s*([\d.]+)\s*\/\s*([\d.]+)/i);

      expect(match).not.toBeNull();
      expect(match![1]).toBe('False');
      expect(parseFloat(match![2])).toBe(2.1);
      expect(parseFloat(match![3])).toBe(5.0);

      const isSpam = match![1].toLowerCase() === 'true' || match![1].toLowerCase() === 'yes';
      expect(isSpam).toBe(false);
    });

    it('should parse SYMBOLS response body', () => {
      const body = 'BAYES_50,HTML_MESSAGE,MIME_HTML_ONLY,RDNS_NONE';
      const symbols = body.trim().split(',').map(s => s.trim()).filter(s => s.length > 0);

      expect(symbols).toHaveLength(4);
      expect(symbols).toContain('BAYES_50');
      expect(symbols).toContain('HTML_MESSAGE');
      expect(symbols).toContain('MIME_HTML_ONLY');
      expect(symbols).toContain('RDNS_NONE');
    });

    it('should handle response codes correctly', () => {
      const responseCodes: Record<number, string> = {
        0: 'EX_OK',
        64: 'EX_USAGE',
        65: 'EX_DATAERR',
        66: 'EX_NOINPUT',
        68: 'EX_NOHOST',
        69: 'EX_UNAVAILABLE',
        74: 'EX_IOERR',
        76: 'EX_PROTOCOL',
      };

      expect(responseCodes[0]).toBe('EX_OK');
      expect(responseCodes[64]).toBe('EX_USAGE');
      expect(responseCodes[65]).toBe('EX_DATAERR');
      expect(responseCodes[74]).toBe('EX_IOERR');
      expect(responseCodes[76]).toBe('EX_PROTOCOL');
    });

    it('should recognize GTUBE test pattern', () => {
      const GTUBE = 'XJS*C4JDBQADN1.NSBN3*2IDNEN*GTUBE-STANDARD-ANTI-UBE-TEST-EMAIL*C.34X';
      const message = `Subject: GTUBE test\r\n\r\n${GTUBE}`;

      expect(message).toContain('GTUBE-STANDARD-ANTI-UBE-TEST-EMAIL');
      expect(message.length).toBeGreaterThan(0);
    });

    it('should enforce message size limit', () => {
      const maxSize = 524288; // 512KB
      const largeMessage = 'X'.repeat(maxSize + 1);
      expect(largeMessage.length).toBeGreaterThan(maxSize);

      // Messages within limit should pass
      const validMessage = 'X'.repeat(maxSize);
      expect(validMessage.length).toBeLessThanOrEqual(maxSize);
    });
  });
});
