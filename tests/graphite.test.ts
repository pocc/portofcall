/**
 * Graphite Plaintext Protocol Integration Tests
 * Tests Graphite metric sending
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Graphite Protocol Integration Tests', () => {
  describe('Graphite Send', () => {
    it('should handle send to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/graphite/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-graphite-12345.example.com',
          port: 2003,
          metrics: [{ name: 'test.metric', value: 42 }],
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/graphite/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metrics: [{ name: 'test.metric', value: 42 }],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('host');
    });

    it('should fail with missing metrics parameter', async () => {
      const response = await fetch(`${API_BASE}/graphite/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('metrics');
    });

    it('should fail with empty metrics array', async () => {
      const response = await fetch(`${API_BASE}/graphite/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          metrics: [],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should reject invalid metric names', async () => {
      const response = await fetch(`${API_BASE}/graphite/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          metrics: [{ name: 'invalid metric name!', value: 42 }],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid metric name');
    });

    it('should handle send to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/graphite/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 2003,
          metrics: [
            { name: 'test.cpu.usage', value: 45.2 },
            { name: 'test.memory.used', value: 8192 },
          ],
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('Graphite Cloudflare Detection', () => {
    it('should block send to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/graphite/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 2003,
          metrics: [{ name: 'test.metric', value: 42 }],
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });

  describe('Graphite Validation', () => {
    it('should accept valid dot-separated metric names', async () => {
      const response = await fetch(`${API_BASE}/graphite/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 2003,
          metrics: [{ name: 'app.web.prod.requests.total', value: 100 }],
          timeout: 3000,
        }),
      });

      // Will fail due to unreachable host, but should NOT be a 400 validation error
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept metrics with underscores and hyphens', async () => {
      const response = await fetch(`${API_BASE}/graphite/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 2003,
          metrics: [{ name: 'my-app.web_server.response-time', value: 42.5 }],
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should reject metric names with spaces', async () => {
      const response = await fetch(`${API_BASE}/graphite/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          metrics: [{ name: 'invalid name', value: 42 }],
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should accept custom port', async () => {
      const response = await fetch(`${API_BASE}/graphite/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 2004,
          metrics: [{ name: 'test.metric', value: 42 }],
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });
});
