/**
 * Telnet Protocol Integration Tests
 * Tests Telnet connectivity and basic operations
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

// Public Telnet test servers
const TELNET_TEST_SERVERS = [
  {
    name: 'Telehack',
    host: 'telehack.com',
    port: 23,
  },
  {
    name: 'MUD Server (Ancient Anguish)',
    host: 'aa.org',
    port: 23,
  },
];

describe('Telnet Protocol Integration Tests', () => {
  describe('Telnet Connect (HTTP)', () => {
    it('should connect to Telehack server and read banner', async () => {
      const response = await fetch(`${API_BASE}/telnet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'telehack.com',
          port: 23,
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.host).toBe('telehack.com');
      expect(data.port).toBe(23);
      // Banner may or may not be present
      expect(data).toHaveProperty('banner');
      expect(data.message).toContain('reachable');
    }, 30000); // 30 second timeout

    it('should support GET request with query parameters', async () => {
      const params = new URLSearchParams({
        host: 'telehack.com',
        port: '23',
      });

      const response = await fetch(`${API_BASE}/telnet/connect?${params}`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.host).toBe('telehack.com');
    }, 30000);

    it('should fail with non-existent host', async () => {
      const response = await fetch(`${API_BASE}/telnet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-telnet-host-12345.example.com',
          port: 23,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 30000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/telnet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 23,
          // Missing host
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/telnet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'telehack.com',
          port: 23,
          timeout: 5000, // 5 second timeout
        }),
      });

      // Should either succeed or timeout gracefully
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('Telnet Error Handling', () => {
    it('should return 400 for missing host', async () => {
      const response = await fetch(`${API_BASE}/telnet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 23,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully', async () => {
      const response = await fetch(`${API_BASE}/telnet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET-1 (reserved, should be unreachable)
          port: 23,
          timeout: 5000, // 5 second timeout for connection
        }),
      });

      // Should return error response
      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000); // Reduced test timeout since we set connection timeout
  });

  describe('Telnet Connectivity Tests', () => {
    it('should successfully connect to multiple Telnet servers', async () => {
      // Test connectivity to multiple servers
      const results = await Promise.allSettled(
        TELNET_TEST_SERVERS.map(async (server) => {
          const response = await fetch(`${API_BASE}/telnet/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              host: server.host,
              port: server.port,
              timeout: 10000, // 10 second timeout per server
            }),
          });

          const data = await response.json();
          return {
            server: server.name,
            success: response.ok && data.success,
          };
        })
      );

      // At least one server should be reachable
      const successfulConnections = results.filter(
        (result) => result.status === 'fulfilled' && result.value.success
      );

      expect(successfulConnections.length).toBeGreaterThan(0);
    }, 30000); // 30 seconds for multiple servers with shorter timeouts
  });

  describe('Telnet Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/telnet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 23,
        }),
      });

      // Should be blocked with 403
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 30000);
  });
});
