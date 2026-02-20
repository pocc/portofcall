/**
 * Loki Protocol Integration Tests
 * Tests Loki HTTP API connectivity, health checks, queries, and log pushing
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Loki Protocol Integration Tests', () => {
  describe('Loki Health', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/loki/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-loki-host-12345.example.com',
          port: 3100,
        }),
      });

      // Health endpoint always returns 200 with errors collected in results
      const data = await response.json();
      expect(data.results).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/loki/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 3100,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should accept port 3100 (Loki default)', async () => {
      const response = await fetch(`${API_BASE}/loki/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3100,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);
  });

  describe('Loki Query', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/loki/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '{job="test"}',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing query parameter', async () => {
      const response = await fetch(`${API_BASE}/loki/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle query to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/loki/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3100,
          query: '{job="test"}',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.error).toBeDefined();
    }, 15000);

    it('should support LogQL queries', async () => {
      const response = await fetch(`${API_BASE}/loki/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3100,
          query: '{job="app"} |= "error"',
          limit: 50,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('error');
    }, 15000);
  });

  describe('Loki Metrics', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/loki/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 3100,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle metrics from unreachable host', async () => {
      const response = await fetch(`${API_BASE}/loki/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3100,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.error).toBeDefined();
    }, 15000);
  });

  describe('Loki Push', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/loki/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: ['test log line'],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing lines parameter', async () => {
      const response = await fetch(`${API_BASE}/loki/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with empty lines array', async () => {
      const response = await fetch(`${API_BASE}/loki/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          lines: [],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle push to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/loki/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3100,
          lines: ['test log line'],
          timeout: 5000,
        }),
      });

      // Push to unreachable host may return 200 with success:false in the body
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should support custom labels', async () => {
      const response = await fetch(`${API_BASE}/loki/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3100,
          lines: ['test log line'],
          labels: { job: 'test', environment: 'dev' },
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);
  });

  describe('Loki Range Query', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/loki/range`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '{job="test"}',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing query parameter', async () => {
      const response = await fetch(`${API_BASE}/loki/range`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle range query to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/loki/range`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3100,
          query: '{job="test"}',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should support time range and direction parameters', async () => {
      const response = await fetch(`${API_BASE}/loki/range`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3100,
          query: '{job="test"}',
          limit: 50,
          direction: 'backward',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);
  });

  describe('Loki Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/loki/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 3100,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('Cloudflare');
    }, 10000);

    it('should block query to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/loki/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 3100,
          query: '{job="test"}',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });

  describe('Loki Port Support', () => {
    it('should accept custom ports', async () => {
      const response = await fetch(`${API_BASE}/loki/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8080,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);
  });

  describe('Loki Error Handling', () => {
    it('should return 400 for missing host', async () => {
      const response = await fetch(`${API_BASE}/loki/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 3100,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully', async () => {
      const response = await fetch(`${API_BASE}/loki/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3100,
        }),
      });

      // Health endpoint always returns 200 with errors collected in results
      const data = await response.json();
      expect(data.results).toBeDefined();
    }, 15000);
  });
});
