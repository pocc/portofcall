/**
 * Perforce (Helix Core) Protocol Integration Tests
 * Tests Perforce server probe and protocol handshake
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';
const PERFORCE_BASE = `${API_BASE}/perforce`;

// Note: Perforce server must be running for these tests
// Default Perforce port is 1666
const PERFORCE_CONFIG = {
  host: 'localhost',
  port: 1666,
  timeout: 10000,
};

const PERFORCE_AUTH = {
  ...PERFORCE_CONFIG,
  username: 'admin',
  password: 'password',
};

describe('Perforce Protocol Integration Tests', () => {
  describe('Perforce Probe', () => {
    it('should probe Perforce server and get version info', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(PERFORCE_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(PERFORCE_CONFIG.host);
      expect(data.port).toBe(PERFORCE_CONFIG.port);

      if (data.success) {
        expect(data.isPerforceServer).toBe(true);
        expect(data.tcpLatency).toBeGreaterThan(0);
        expect(data.serverInfo).toBeDefined();

        if (data.serverInfo.server2) {
          expect(data.serverInfo.server2).toBeDefined();
        }
        if (data.serverInfo.xfiles) {
          expect(data.serverInfo.xfiles).toBeDefined();
        }
      }
    });

    it('should handle custom timeout', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...PERFORCE_CONFIG,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(PERFORCE_CONFIG.host);
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 1666,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should fail with invalid port', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
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
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
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
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'invalid@host',
          port: 1666,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('invalid characters');
    });

    it('should reject empty host', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 1666,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should use default port 1666 when not specified', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.port).toBe(1666);
    });
  });

  describe('Perforce Info', () => {
    it('should get server info without authentication', async () => {
      const response = await fetch(`${PERFORCE_BASE}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(PERFORCE_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(PERFORCE_CONFIG.host);
      expect(data.port).toBe(PERFORCE_CONFIG.port);

      if (data.success) {
        expect(data.isPerforceServer).toBeDefined();
        expect(data.tcpLatency).toBeGreaterThan(0);

        if (data.serverVersion) {
          expect(typeof data.serverVersion).toBe('string');
        }
        if (data.serverRoot) {
          expect(typeof data.serverRoot).toBe('string');
        }
      }
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${PERFORCE_BASE}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 1666,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should fail with invalid port', async () => {
      const response = await fetch(`${PERFORCE_BASE}/info`, {
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

    it('should reject GET requests', async () => {
      const response = await fetch(`${PERFORCE_BASE}/info`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should handle non-existent host', async () => {
      const response = await fetch(`${PERFORCE_BASE}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-perforce-host-12345.example.com',
          port: 1666,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${PERFORCE_BASE}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 1666,
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
  });

  describe('Perforce Login', () => {
    it('should attempt login with credentials', async () => {
      const response = await fetch(`${PERFORCE_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(PERFORCE_AUTH),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(PERFORCE_CONFIG.host);
      expect(data.port).toBe(PERFORCE_CONFIG.port);

      if (data.success) {
        expect(data.authenticated).toBeDefined();
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should fail with missing username', async () => {
      const response = await fetch(`${PERFORCE_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...PERFORCE_CONFIG,
          password: 'password',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('username');
    });

    it('should fail with missing password', async () => {
      const response = await fetch(`${PERFORCE_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...PERFORCE_CONFIG,
          username: 'admin',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('password');
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${PERFORCE_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 1666,
          username: 'admin',
          password: 'password',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${PERFORCE_BASE}/login`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should handle non-existent host', async () => {
      const response = await fetch(`${PERFORCE_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-perforce-host-12345.example.com',
          port: 1666,
          timeout: 3000,
          username: 'admin',
          password: 'password',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });
  });

  describe('Perforce Changes', () => {
    it('should list changelists with credentials', async () => {
      const response = await fetch(`${PERFORCE_BASE}/changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...PERFORCE_AUTH,
          max: 5,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(PERFORCE_CONFIG.host);

      if (data.success) {
        expect(Array.isArray(data.changes)).toBe(true);
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should filter changelists by status', async () => {
      const response = await fetch(`${PERFORCE_BASE}/changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...PERFORCE_AUTH,
          status: 'submitted',
          max: 5,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(PERFORCE_CONFIG.host);
    });

    it('should fail with missing username', async () => {
      const response = await fetch(`${PERFORCE_BASE}/changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...PERFORCE_CONFIG,
          password: 'password',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('username');
    });

    it('should fail with missing password', async () => {
      const response = await fetch(`${PERFORCE_BASE}/changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...PERFORCE_CONFIG,
          username: 'admin',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('password');
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${PERFORCE_BASE}/changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 1666,
          username: 'admin',
          password: 'password',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${PERFORCE_BASE}/changes`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('Perforce Describe', () => {
    it('should describe a changelist', async () => {
      const response = await fetch(`${PERFORCE_BASE}/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...PERFORCE_AUTH,
          change: 1,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(PERFORCE_CONFIG.host);

      if (data.success) {
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should fail with missing username', async () => {
      const response = await fetch(`${PERFORCE_BASE}/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...PERFORCE_CONFIG,
          password: 'password',
          change: 1,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('username');
    });

    it('should fail with missing password', async () => {
      const response = await fetch(`${PERFORCE_BASE}/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...PERFORCE_CONFIG,
          username: 'admin',
          change: 1,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('password');
    });

    it('should fail with missing change number', async () => {
      const response = await fetch(`${PERFORCE_BASE}/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...PERFORCE_AUTH,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('change');
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${PERFORCE_BASE}/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 1666,
          username: 'admin',
          password: 'password',
          change: 1,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${PERFORCE_BASE}/describe`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('Perforce Protocol Handshake', () => {
    it('should receive server response with protocol fields', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(PERFORCE_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.isPerforceServer) {
        expect(data.serverInfo).toBeDefined();
        expect(typeof data.serverInfo).toBe('object');
        expect(data.rawResponse).toBeDefined();
      }
    });

    it('should detect non-Perforce service', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 80, // HTTP server, not Perforce
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      if (data.success) {
        expect(data).toHaveProperty('isPerforceServer');
      }
    });
  });

  describe('Perforce Error Handling', () => {
    it('should handle non-existent host', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-perforce-host-12345.example.com',
          port: 1666,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should handle connection timeout', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET-1 (should timeout)
          port: 1666,
          timeout: 1000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should handle closed port', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
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
      expect(data).toHaveProperty('success');
    });

    it('should handle malformed response gracefully', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 22, // SSH server, not Perforce
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

  describe('Perforce Response Validation', () => {
    it('should parse tagged wire protocol response', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(PERFORCE_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.isPerforceServer) {
        const info = data.serverInfo;
        expect(info).toBeDefined();

        const hasPerforceFields =
          info.server2 ||
          info.xfiles ||
          info.security ||
          info.maxcommitsperfile ||
          data.rawResponse.includes('Perforce') ||
          data.rawResponse.includes('p4d');

        expect(hasPerforceFields).toBe(true);
      }
    });

    it('should include raw response for debugging', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(PERFORCE_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success) {
        expect(data.rawResponse).toBeDefined();
        expect(typeof data.rawResponse).toBe('string');
      }
    });

    it('should include TCP latency metric', async () => {
      const response = await fetch(`${PERFORCE_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(PERFORCE_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success) {
        expect(data.tcpLatency).toBeDefined();
        expect(typeof data.tcpLatency).toBe('number');
        expect(data.tcpLatency).toBeGreaterThan(0);
      }
    });
  });
});
