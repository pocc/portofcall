/**
 * OpenTSDB Telnet Protocol Integration Tests
 * Tests OpenTSDB telnet-style text protocol connectivity (port 4242)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('OpenTSDB Protocol Integration Tests', () => {
  // ===== VERSION =====
  describe('OpenTSDB Version', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-opentsdb-host-12345.example.com',
          port: 4242,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 4242 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4242,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should accept port 4242 (OpenTSDB default)', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4242,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== STATS =====
  describe('OpenTSDB Stats', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-opentsdb-host-12345.example.com',
          port: 4242,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 4242 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle timeout on stats', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4242,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== SUGGEST =====
  describe('OpenTSDB Suggest', () => {
    it('should handle connection to non-existent host for suggest', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-opentsdb-host-12345.example.com',
          port: 4242,
          type: 'metrics',
          max: 10,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metrics' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should reject invalid suggest type', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4242,
          type: 'invalid_type',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid type');
    });

    it('should reject max parameter exceeding limit', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4242,
          type: 'metrics',
          max: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('max parameter');
    });

    it('should accept valid suggest types: metrics, tagk, tagv', async () => {
      for (const type of ['metrics', 'tagk', 'tagv']) {
        const response = await fetch(`${API_BASE}/opentsdb/suggest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: 'unreachable-host-12345.invalid',
            port: 4242,
            type,
            max: 10,
            timeout: 3000,
          }),
        });

        const data = await response.json();
        expect(data).toHaveProperty('success');
      }
    }, 30000);

    it('should accept optional query prefix for suggest', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4242,
          type: 'metrics',
          q: 'sys.cpu',
          max: 5,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== PUT =====
  describe('OpenTSDB Put', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/put`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-opentsdb-host-12345.example.com',
          port: 4242,
          metric: 'test.metric',
          value: 42,
          timestamp: Math.floor(Date.now() / 1000),
          tags: { host: 'testhost' },
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host and metric parameters', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/put`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 42 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should reject invalid metric name with special characters', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/put`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4242,
          metric: 'invalid metric!@#$',
          value: 42,
          timestamp: Math.floor(Date.now() / 1000),
          tags: { host: 'testhost' },
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid metric name');
    });

    it('should accept valid metric name with dots and underscores', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/put`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4242,
          metric: 'sys.cpu.user',
          value: 42,
          timestamp: Math.floor(Date.now() / 1000),
          tags: { host: 'myhost' },
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== QUERY =====
  describe('OpenTSDB Query', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-opentsdb-host-12345.example.com',
          port: 4242,
          metric: 'sys.cpu.user',
          start: '1h-ago',
          aggregator: 'sum',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metric: 'sys.cpu.user',
          start: '1h-ago',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing metric parameter', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          start: '1h-ago',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should accept optional aggregator parameter', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4242,
          metric: 'sys.cpu.user',
          start: '1h-ago',
          aggregator: 'avg',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== ERROR HANDLING =====
  describe('OpenTSDB Error Handling', () => {
    it('should return 400 for missing host on version', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 4242 }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully on stats', async () => {
      const response = await fetch(`${API_BASE}/opentsdb/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4242,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });
});
