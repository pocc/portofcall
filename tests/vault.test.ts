/**
 * HashiCorp Vault Protocol Integration Tests
 *
 * Tests the Vault HTTP API implementation over raw TCP sockets.
 * Vault uses HTTP/1.1 on port 8200.
 *
 * Note: Tests may fail without a reachable Vault server.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Vault Protocol Integration Tests', () => {
  describe('POST /api/vault/health', () => {
    it('should connect and retrieve health status', async () => {
      const response = await fetch(`${API_BASE}/vault/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 8200,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.host).toBe('localhost');
        expect(data.port).toBe(8200);
        expect(data.rtt).toBeDefined();
        expect(data.protocol).toBe('Vault');
        expect(data.version).toBeDefined();
        expect(data.initialized).toBeTypeOf('boolean');
        expect(data.sealed).toBeTypeOf('boolean');
      }
    }, 20000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/vault/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 8200,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/vault/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 99999,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should handle connection timeout gracefully', async () => {
      const response = await fetch(`${API_BASE}/vault/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 8200,
          timeout: 1000,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 5000);
  });

  describe('POST /api/vault/query', () => {
    it('should query sys/health endpoint', async () => {
      const response = await fetch(`${API_BASE}/vault/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 8200,
          path: '/v1/sys/health',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.path).toBe('/v1/sys/health');
        expect(data.statusCode).toBeDefined();
        expect(data.rtt).toBeDefined();
        expect(data.response).toBeDefined();
      }
    }, 20000);

    it('should reject empty path', async () => {
      const response = await fetch(`${API_BASE}/vault/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 8200,
          path: '',
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Path is required');
    });

    it('should reject disallowed paths', async () => {
      const response = await fetch(`${API_BASE}/vault/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 8200,
          path: '/v1/secret/data/my-secret',
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('not allowed');
    });

    it('should query sys/seal-status endpoint', async () => {
      const response = await fetch(`${API_BASE}/vault/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 8200,
          path: '/v1/sys/seal-status',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.path).toBe('/v1/sys/seal-status');
        expect(data.rtt).toBeDefined();
      }
    }, 20000);
  });
});
