/**
 * Kibana Protocol Integration Tests
 * Tests Kibana HTTP API connectivity, status checks, and saved objects
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Kibana Protocol Integration Tests', () => {
  describe('Kibana Status', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/kibana/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-kibana-host-12345.example.com',
          port: 5601,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/kibana/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 5601,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should accept port 5601 (Kibana default)', async () => {
      const response = await fetch(`${API_BASE}/kibana/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5601,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('error');
    }, 15000);
  });

  describe('Kibana Saved Objects', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/kibana/saved-objects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'dashboard',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle saved objects query', async () => {
      const response = await fetch(`${API_BASE}/kibana/saved-objects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5601,
          type: 'dashboard',
          perPage: 10,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.error).toBeDefined();
    }, 15000);

    it('should support type parameter', async () => {
      const response = await fetch(`${API_BASE}/kibana/saved-objects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5601,
          type: 'visualization',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('error');
    }, 15000);
  });

  describe('Kibana Index Patterns', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/kibana/index-patterns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 5601,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle index patterns from unreachable host', async () => {
      const response = await fetch(`${API_BASE}/kibana/index-patterns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5601,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.error).toBeDefined();
    }, 15000);
  });

  describe('Kibana Alerts', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/kibana/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 5601,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle alerts from unreachable host', async () => {
      const response = await fetch(`${API_BASE}/kibana/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5601,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.error).toBeDefined();
    }, 15000);
  });

  describe('Kibana Query', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/kibana/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '_cat/indices',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle query from unreachable host', async () => {
      const response = await fetch(`${API_BASE}/kibana/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5601,
          query: '_cat/indices?v',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.error).toBeDefined();
    }, 15000);

    it('should support custom query paths', async () => {
      const response = await fetch(`${API_BASE}/kibana/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5601,
          query: '_cluster/health',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('error');
    }, 15000);
  });

  describe('Kibana Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/kibana/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 5601,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('Cloudflare');
    }, 10000);

    it('should block query to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/kibana/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 5601,
          query: '_cat/indices',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });

  describe('Kibana Port Support', () => {
    it('should accept custom ports', async () => {
      const response = await fetch(`${API_BASE}/kibana/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8080,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('error');
    }, 15000);
  });

  describe('Kibana Error Handling', () => {
    it('should return 400 for missing host', async () => {
      const response = await fetch(`${API_BASE}/kibana/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 5601,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully', async () => {
      const response = await fetch(`${API_BASE}/kibana/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5601,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.error).toBeDefined();
    }, 15000);
  });
});
