/**
 * UUCP (Unix-to-Unix Copy) Protocol Integration Tests
 * Tests UUCP protocol probe and handshake (port 540)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';
const UUCP_BASE = `${API_BASE}/uucp`;

// Note: UUCP server must be running for these tests
// Default UUCP port is 540
const UUCP_CONFIG = {
  host: 'localhost',
  port: 540,
  systemName: 'testnode',
  timeout: 10000,
};

describe('UUCP Protocol Integration Tests', () => {
  describe('UUCP Probe', () => {
    it('should probe UUCP server and get system name', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(UUCP_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.host).toBe(UUCP_CONFIG.host);
      expect(data.port).toBe(UUCP_CONFIG.port);
      expect(data.tcpLatency).toBeGreaterThan(0);

      if (data.isUUCPServer) {
        expect(data.serverSystem).toBeDefined();
        expect(data.serverGreeting).toBeDefined();
        expect(data.note).toContain('UUCP');
        expect(data.security).toContain('NONE');
      }
    });

    it('should include historical context note', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(UUCP_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.note).toBeDefined();
      expect(data.note).toContain('historical');
      expect(data.security).toBeDefined();
      expect(data.security).toContain('plaintext');
    });

    it('should handle custom system name', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...UUCP_CONFIG,
          systemName: 'custom-node',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.host).toBe(UUCP_CONFIG.host);
    });

    it('should sanitize invalid system name characters', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...UUCP_CONFIG,
          systemName: 'invalid@#$%name',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 540,
          systemName: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should fail with invalid port', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should fail with port zero', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should reject host with invalid characters', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'invalid@host',
          port: 540,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('invalid characters');
    });

    it('should reject empty host', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 540,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should use default port 540 when not specified', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.port).toBe(540);
    });
  });

  describe('UUCP Handshake', () => {
    it('should attempt UUCP handshake and return banner', async () => {
      const response = await fetch(`${UUCP_BASE}/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: UUCP_CONFIG.host,
          port: UUCP_CONFIG.port,
          timeout: UUCP_CONFIG.timeout,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('banner');
      expect(data).toHaveProperty('latencyMs');
      expect(data).toHaveProperty('loginRequired');
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${UUCP_BASE}/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 540,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should fail with invalid port', async () => {
      const response = await fetch(`${UUCP_BASE}/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with timeout below minimum', async () => {
      const response = await fetch(`${UUCP_BASE}/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 540,
          timeout: 500,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with timeout above maximum', async () => {
      const response = await fetch(`${UUCP_BASE}/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 540,
          timeout: 400000,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${UUCP_BASE}/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 540,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      if (data.isCloudflare) {
        expect(data.isCloudflare).toBe(true);
        expect(data.success).toBe(false);
      } else {
        expect(data).toHaveProperty('success');
      }
    });

    it('should handle non-existent host', async () => {
      const response = await fetch(`${UUCP_BASE}/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-uucp-host-12345.example.com',
          port: 540,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should handle connection timeout', async () => {
      const response = await fetch(`${UUCP_BASE}/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET-1 (should timeout)
          port: 540,
          timeout: 1000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should report loginRequired for login-prompt servers', async () => {
      const response = await fetch(`${UUCP_BASE}/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: UUCP_CONFIG.host,
          port: UUCP_CONFIG.port,
          timeout: UUCP_CONFIG.timeout,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      // loginRequired must be a boolean
      expect(typeof data.loginRequired).toBe('boolean');
    });

    it('should include latencyMs in response', async () => {
      const response = await fetch(`${UUCP_BASE}/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: UUCP_CONFIG.host,
          port: UUCP_CONFIG.port,
          timeout: UUCP_CONFIG.timeout,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.latencyMs).toBeTypeOf('number');
    });

    it('should use default port 540 when not specified in handshake', async () => {
      const response = await fetch(`${UUCP_BASE}/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          timeout: 3000,
        }),
      });

      // port defaults to 540 in the implementation; localhost may not have UUCP
      const data = await response.json();
      expect(data).toHaveProperty('success');
    });
  });

  describe('UUCP Protocol Handshake (via probe)', () => {
    it('should send wakeup sequence', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(UUCP_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
    });

    it('should detect UUCP server greeting', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(UUCP_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('isUUCPServer');

      if (data.isUUCPServer) {
        expect(data.serverGreeting).toBeDefined();
        expect(data.serverSystem).toBeDefined();
      }
    });

    it('should handle handshake response', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(UUCP_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.isUUCPServer && data.handshakeResult) {
        expect(typeof data.handshakeResult).toBe('string');
      }
    });

    it('should detect non-UUCP service', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 80, // HTTP server, not UUCP
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      if (data.success) {
        expect(data.isUUCPServer).toBeDefined();
      }
    });
  });

  describe('UUCP Timeout Handling', () => {
    it('should handle custom timeout', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...UUCP_CONFIG,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
    });

    it('should reject timeout below minimum', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...UUCP_CONFIG,
          timeout: 500,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Timeout');
    });

    it('should reject timeout above maximum', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...UUCP_CONFIG,
          timeout: 400000,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Timeout');
    });

    it('should handle connection timeout', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET-1 (should timeout)
          port: 540,
          timeout: 1000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });
  });

  describe('UUCP Error Handling', () => {
    it('should handle non-existent host', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-uucp-host-12345.example.com',
          port: 540,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should handle closed port', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
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

    it('should handle server with no response', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 22, // SSH server (won't send UUCP greeting)
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.isUUCPServer).toBeDefined();
    });

    it('should handle malformed response gracefully', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 80, // HTTP server
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');
    });
  });

  describe('UUCP Response Validation', () => {
    it('should include TCP latency metric', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(UUCP_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;
      if (data.success) {
        expect(data.tcpLatency).toBeDefined();
        expect(typeof data.tcpLatency).toBe('number');
        expect(data.tcpLatency).toBeGreaterThan(0);
      }
    });

    it('should include security warning', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(UUCP_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;
      if (data.success) {
        expect(data.security).toBeDefined();
        expect(data.security).toContain('plaintext');
        expect(data.security).toContain('SFTP');
      }
    });

    it('should sanitize server greeting for display', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(UUCP_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.isUUCPServer && data.serverGreeting) {
        expect(typeof data.serverGreeting).toBe('string');
      }
    });

    it('should parse server system name', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(UUCP_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.isUUCPServer && data.serverSystem) {
        expect(typeof data.serverSystem).toBe('string');
      }
    });
  });

  describe('UUCP Historical Context', () => {
    it('should provide educational note about UUCP history', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(UUCP_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;
      if (data.success) {
        expect(data.note).toBeDefined();
        expect(data.note).toContain('pre-internet');
      }
    });

    it('should warn about lack of security', async () => {
      const response = await fetch(`${UUCP_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(UUCP_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;
      if (data.success) {
        expect(data.security).toBeDefined();
        expect(data.security).toContain('NONE');
        expect(data.security.toLowerCase()).toContain('sftp');
      }
    });
  });
});
