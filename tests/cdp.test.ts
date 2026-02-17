/**
 * Chrome DevTools Protocol (CDP) Integration Tests
 * Tests CDP health check and query endpoints
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('CDP Integration Tests', () => {
  describe('CDP Health Check', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/cdp/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-chrome-12345.example.com',
          port: 9222,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/cdp/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 9222,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should handle custom port', async () => {
      const response = await fetch(`${API_BASE}/cdp/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9223,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle timeout', async () => {
      const response = await fetch(`${API_BASE}/cdp/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9222,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('CDP Query', () => {
    it('should handle connection failure', async () => {
      const response = await fetch(`${API_BASE}/cdp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-chrome-12345.example.com',
          port: 9222,
          endpoint: '/json/version',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/cdp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 9222,
          endpoint: '/json/version',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle non-Chrome service', async () => {
      const response = await fetch(`${API_BASE}/cdp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9222,
          endpoint: '/json/version',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle different endpoints', async () => {
      const endpoints = ['/json/version', '/json/list', '/json', '/json/protocol'];

      for (const endpoint of endpoints) {
        const response = await fetch(`${API_BASE}/cdp/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: 'unreachable-host-12345.invalid',
            port: 9222,
            endpoint,
            timeout: 3000,
          }),
        });

        const data = await response.json();
        expect(data).toHaveProperty('success');
        // Should fail to connect, but not error on endpoint format
        expect(data.success).toBe(false);
      }
    }, 30000);

    it('should normalize endpoint paths', async () => {
      const response = await fetch(`${API_BASE}/cdp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9222,
          endpoint: 'json/version', // missing leading slash
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('CDP Error Handling', () => {
    it('should return 400 for missing host on health check', async () => {
      const response = await fetch(`${API_BASE}/cdp/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing host on query', async () => {
      const response = await fetch(`${API_BASE}/cdp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully', async () => {
      const response = await fetch(`${API_BASE}/cdp/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9222,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });

  describe('CDP Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/cdp/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 9222,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });

  describe('CDP Port Support', () => {
    it('should accept default port 9222', async () => {
      const response = await fetch(`${API_BASE}/cdp/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9222,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept custom debugging ports', async () => {
      const response = await fetch(`${API_BASE}/cdp/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9223,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('CDP Response Format', () => {
    it('should return structured health check response', async () => {
      const response = await fetch(`${API_BASE}/cdp/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9222,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('latencyMs');

      // If connection fails (expected), should have error
      if (!data.success) {
        expect(data).toHaveProperty('error');
      }
      // If connection succeeds, should have parsed data
      if (data.success) {
        expect(data).toHaveProperty('parsed');
        expect(data.parsed).toHaveProperty('version');
      }
    }, 10000);

    it('should return structured query response', async () => {
      const response = await fetch(`${API_BASE}/cdp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9222,
          endpoint: '/json/version',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('statusCode');
      expect(data).toHaveProperty('latencyMs');
      expect(data).toHaveProperty('body');
    }, 10000);
  });
});
