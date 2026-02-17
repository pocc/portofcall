/**
 * PostgreSQL Protocol Integration Tests
 * Tests PostgreSQL connectivity
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('PostgreSQL Protocol Integration Tests', () => {
  describe('PostgreSQL Connect (HTTP)', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/postgres/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-postgres-host-12345.example.com',
          port: 5432,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/postgres/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 5432,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('host');
    });

    it('should support GET request with query parameters', async () => {
      const params = new URLSearchParams({
        host: 'non-existent-postgres.example.com',
        port: '5432',
        timeout: '5000',
      });

      const response = await fetch(`${API_BASE}/postgres/connect?${params}`);
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/postgres/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5432,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('PostgreSQL Error Handling', () => {
    it('should return 400 for missing host', async () => {
      const response = await fetch(`${API_BASE}/postgres/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 5432,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully', async () => {
      const response = await fetch(`${API_BASE}/postgres/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5432,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });

  describe('PostgreSQL Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/postgres/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 5432,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });

  describe('PostgreSQL Port Support', () => {
    it('should accept port 5432 (PostgreSQL default)', async () => {
      const response = await fetch(`${API_BASE}/postgres/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5432,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept custom ports', async () => {
      const response = await fetch(`${API_BASE}/postgres/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5433,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });
});
