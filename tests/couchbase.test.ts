/**
 * Couchbase / Memcached Binary Protocol Integration Tests
 * Tests Couchbase KV engine connectivity via memcached binary protocol (port 11210)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Couchbase Protocol Integration Tests', () => {
  // ===== PING =====
  describe('Couchbase Ping', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/couchbase/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-couchbase-host-12345.example.com',
          port: 11210,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 11210 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 11210,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should reject invalid port out of range', async () => {
      const response = await fetch(`${API_BASE}/couchbase/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should use default port 11210 for Couchbase KV engine', async () => {
      const response = await fetch(`${API_BASE}/couchbase/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/couchbase/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 11210,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);

    it('should accept port 11210 (Couchbase KV default)', async () => {
      const response = await fetch(`${API_BASE}/couchbase/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 11210,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept port 11211 (Memcached default)', async () => {
      const response = await fetch(`${API_BASE}/couchbase/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 11211,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== VERSION =====
  describe('Couchbase Version', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/couchbase/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-couchbase-host-12345.example.com',
          port: 11210,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 11210 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/couchbase/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 11210,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 10000);

    it('should handle timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 11210,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== STATS =====
  describe('Couchbase Stats', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/couchbase/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-couchbase-host-12345.example.com',
          port: 11210,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 11210 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/couchbase/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 11210,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  // ===== GET =====
  describe('Couchbase Get', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'mykey' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should fail with missing key parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'unreachable-host-12345.invalid' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/couchbase/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-couchbase-host-12345.example.com',
          port: 11210,
          key: 'testkey',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/couchbase/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 11210,
          key: 'testkey',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  // ===== SET =====
  describe('Couchbase Set', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'mykey', value: 'myvalue' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should fail with missing key parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'unreachable-host-12345.invalid', value: 'myvalue' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/couchbase/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-couchbase-host-12345.example.com',
          port: 11210,
          key: 'testkey',
          value: 'testvalue',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/couchbase/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 11210,
          key: 'testkey',
          value: 'testvalue',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  // ===== DELETE =====
  describe('Couchbase Delete', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'mykey' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should fail with missing key parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'unreachable-host-12345.invalid' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/couchbase/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-couchbase-host-12345.example.com',
          port: 11210,
          key: 'testkey',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/couchbase/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 11210,
          key: 'testkey',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  // ===== INCR =====
  describe('Couchbase Incr/Decr', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/incr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'counter' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should fail with missing key parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/incr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'unreachable-host-12345.invalid' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should reject negative delta', async () => {
      const response = await fetch(`${API_BASE}/couchbase/incr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          key: 'counter',
          delta: -1,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should reject invalid operation value', async () => {
      const response = await fetch(`${API_BASE}/couchbase/incr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          key: 'counter',
          operation: 'multiply',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle connection to non-existent host for increment', async () => {
      const response = await fetch(`${API_BASE}/couchbase/incr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-couchbase-host-12345.example.com',
          port: 11210,
          key: 'counter',
          delta: 1,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should accept decrement operation parameter', async () => {
      const response = await fetch(`${API_BASE}/couchbase/incr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 11210,
          key: 'counter',
          operation: 'decrement',
          delta: 5,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/couchbase/incr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 11210,
          key: 'counter',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  // ===== ERROR HANDLING =====
  describe('Couchbase Error Handling', () => {
    it('should return 400 for missing host on ping', async () => {
      const response = await fetch(`${API_BASE}/couchbase/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 11210 }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully on ping', async () => {
      const response = await fetch(`${API_BASE}/couchbase/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 11210,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should handle network errors gracefully on version', async () => {
      const response = await fetch(`${API_BASE}/couchbase/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 11210,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });
});
