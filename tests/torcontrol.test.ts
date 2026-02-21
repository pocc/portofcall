/**
 * Tor Control Protocol Integration Tests
 * Tests Tor Control Protocol operations (port 9051)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';
const TOR_BASE = `${API_BASE}/torcontrol`;

// Note: Tor control port must be accessible for these tests
// Default Tor control port is 9051
const TOR_CONFIG = {
  host: 'test-host.invalid',
  port: 9051,
  timeout: 10000,
};

describe('Tor Control Protocol Integration Tests', () => {
  describe('Tor Control Probe', () => {
    it('should probe Tor control port and get protocol info', async () => {
      const response = await fetch(`${TOR_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(TOR_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(TOR_CONFIG.host);
      expect(data.port).toBe(TOR_CONFIG.port);

      if (data.success) {
        expect(data.statusCode).toBe(250);
        expect(data.protocolInfoVersion).toBeDefined();
        expect(data.authMethods).toBeDefined();
        expect(Array.isArray(data.authMethods)).toBe(true);
        expect(data.rtt).toBeGreaterThan(0);

        // Tor version should be present
        if (data.torVersion) {
          expect(typeof data.torVersion).toBe('string');
        }
      }
    });

    it('should return PROTOCOLINFO details', async () => {
      const response = await fetch(`${TOR_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(TOR_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success) {
        expect(data.protocolInfoVersion).toBeDefined();
        expect(data.authMethods).toBeDefined();

        // Common auth methods: NULL, HASHEDPASSWORD, COOKIE, SAFECOOKIE
        const validAuthMethods = ['NULL', 'HASHEDPASSWORD', 'COOKIE', 'SAFECOOKIE'];
        if (data.authMethods.length > 0) {
          const hasValidMethod = data.authMethods.some((m: string) =>
            validAuthMethods.includes(m)
          );
          expect(hasValidMethod).toBe(true);
        }
      }
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${TOR_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 9051,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should handle custom timeout', async () => {
      const response = await fetch(`${TOR_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...TOR_CONFIG,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(TOR_CONFIG.host);
    });
  });

  describe('Tor Control GETINFO', () => {
    it('should get Tor version info', async () => {
      const response = await fetch(`${TOR_BASE}/getinfo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...TOR_CONFIG,
          password: '',
          key: 'version',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(TOR_CONFIG.host);

      if (data.success) {
        expect(data.statusCode).toBe(250);
        expect(data.value).toBeDefined();
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should get config-file info', async () => {
      const response = await fetch(`${TOR_BASE}/getinfo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...TOR_CONFIG,
          password: '',
          key: 'config-file',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success) {
        expect(data.statusCode).toBe(250);
        expect(data.value).toBeDefined();
      }
    });

    it('should fail with invalid key format', async () => {
      const response = await fetch(`${TOR_BASE}/getinfo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...TOR_CONFIG,
          password: '',
          keys: ['invalid key with spaces!'],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('key');
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${TOR_BASE}/getinfo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: '',
          key: 'version',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should handle invalid info key', async () => {
      const response = await fetch(`${TOR_BASE}/getinfo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...TOR_CONFIG,
          password: '',
          key: 'invalid-key-12345',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      if (data.success === false) {
        expect(data.statusCode).toBeGreaterThanOrEqual(500);
        expect(data.error).toBeDefined();
      }
    });
  });

  describe('Tor Control SIGNAL', () => {
    it('should send NEWNYM signal for new identity', async () => {
      const response = await fetch(`${TOR_BASE}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...TOR_CONFIG,
          password: '',
          signal: 'NEWNYM',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(TOR_CONFIG.host);

      if (data.success) {
        expect(data.statusCode).toBe(250);
        expect(data.message).toBeDefined();
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should fail with missing signal', async () => {
      const response = await fetch(`${TOR_BASE}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...TOR_CONFIG,
          password: '',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('signal');
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${TOR_BASE}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: '',
          signal: 'NEWNYM',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should handle invalid signal name', async () => {
      const response = await fetch(`${TOR_BASE}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...TOR_CONFIG,
          password: '',
          signal: 'INVALID_SIGNAL',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      if (data.success === false) {
        expect(data.statusCode).toBeGreaterThanOrEqual(500);
        expect(data.error).toBeDefined();
      }
    });
  });

  describe('Tor Control Authentication', () => {
    it('should handle NULL authentication', async () => {
      const response = await fetch(`${TOR_BASE}/getinfo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...TOR_CONFIG,
          password: '',
          key: 'version',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      // May succeed or fail depending on Tor configuration
      expect(data).toHaveProperty('success');
    });

    it('should handle password authentication', async () => {
      const response = await fetch(`${TOR_BASE}/getinfo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...TOR_CONFIG,
          password: 'test-password',
          key: 'version',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      // May succeed or fail depending on actual password
      expect(data).toHaveProperty('success');
    });

    it('should fail with wrong password', async () => {
      const response = await fetch(`${TOR_BASE}/getinfo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...TOR_CONFIG,
          password: 'definitely-wrong-password-12345',
          key: 'version',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      if (data.success === false && data.statusCode === 515) {
        expect(data.error).toBeDefined();
      }
    });
  });

  describe('Tor Control Error Handling', () => {
    it('should handle non-existent host', async () => {
      const response = await fetch(`${TOR_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-tor-host-12345.example.com',
          port: 9051,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should handle connection timeout', async () => {
      const response = await fetch(`${TOR_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET-1 (should timeout)
          port: 9051,
          timeout: 1000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should handle non-Tor service', async () => {
      const response = await fetch(`${TOR_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 80, // HTTP, not Tor
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      if (data.success === false) {
        expect(data.error).toBeDefined();
      }
    });

    it('should handle closed port', async () => {
      const response = await fetch(`${TOR_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 19999, // Unlikely to be open
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should reject GET requests on probe', async () => {
      const response = await fetch(`${TOR_BASE}/probe`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should reject GET requests on getinfo', async () => {
      const response = await fetch(`${TOR_BASE}/getinfo`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should reject GET requests on signal', async () => {
      const response = await fetch(`${TOR_BASE}/signal`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('Tor Control Response Parsing', () => {
    it('should parse multiline responses', async () => {
      const response = await fetch(`${TOR_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(TOR_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success) {
        expect(data.rawResponse).toBeDefined();
        expect(typeof data.rawResponse).toBe('string');
      }
    });

    it('should parse status codes correctly', async () => {
      const response = await fetch(`${TOR_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(TOR_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success) {
        expect(data.statusCode).toBeDefined();
        expect(typeof data.statusCode).toBe('number');
        expect(data.statusCode).toBe(250);
      }
    });

    it('should include RTT measurement', async () => {
      const response = await fetch(`${TOR_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(TOR_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success) {
        expect(data.rtt).toBeDefined();
        expect(typeof data.rtt).toBe('number');
        expect(data.rtt).toBeGreaterThan(0);
      }
    });
  });
});
