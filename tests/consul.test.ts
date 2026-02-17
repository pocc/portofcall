/**
 * Consul Protocol Integration Tests
 * Tests Consul HTTP API connectivity over TCP sockets
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Consul Protocol Integration Tests', () => {
  describe('Consul Health (HTTP)', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/consul/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-consul-host-12345.example.com',
          port: 8500,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/consul/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 8500,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('host');
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/consul/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8500,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should accept default port when not specified', async () => {
      const response = await fetch(`${API_BASE}/consul/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should accept optional ACL token', async () => {
      const response = await fetch(`${API_BASE}/consul/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8500,
          token: 'test-token',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('Consul Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/consul/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 8500,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });

  describe('Consul Response Format', () => {
    it('should return error with proper structure for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/consul/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8500,
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    }, 10000);
  });
});
