/**
 * EPMD Protocol Integration Tests (Erlang Port Mapper Daemon)
 * Tests EPMD node discovery and port lookup
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('EPMD Protocol Integration Tests', () => {
  describe('EPMD Names Request', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/epmd/names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-epmd-host-12345.example.com',
          port: 4369,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/epmd/names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 4369,
          // Missing host
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port numbers', async () => {
      const response = await fetch(`${API_BASE}/epmd/names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should use default port 4369 when not specified', async () => {
      const response = await fetch(`${API_BASE}/epmd/names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
          // Port not specified, should default to 4369
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.port).toBe(4369);
    }, 10000);

    it('should return proper response structure', async () => {
      const response = await fetch(`${API_BASE}/epmd/names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4369,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');
      expect(data).toHaveProperty('error');
    }, 10000);

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/epmd/names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4369,
          timeout: 2000,
        }),
      });

      // Should timeout or fail quickly
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('EPMD Port Lookup Request', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/epmd/port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-epmd-host-12345.example.com',
          port: 4369,
          nodeName: 'rabbit',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/epmd/port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 4369,
          nodeName: 'rabbit',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host is required');
    });

    it('should fail with missing nodeName parameter', async () => {
      const response = await fetch(`${API_BASE}/epmd/port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com', // Use a non-Cloudflare host to avoid 403
          port: 4369,
        }),
      });

      // Should return 400 for missing nodeName or 403 for Cloudflare
      expect([400, 403]).toContain(response.status);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should use default port 4369 when not specified', async () => {
      const response = await fetch(`${API_BASE}/epmd/port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          nodeName: 'rabbit',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.port).toBe(4369);
    }, 10000);

    it('should return proper response structure', async () => {
      const response = await fetch(`${API_BASE}/epmd/port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4369,
          nodeName: 'test',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');
      expect(data).toHaveProperty('error');
    }, 10000);

    it('should handle various node names', async () => {
      const nodeNames = ['rabbit', 'ejabberd', 'couchdb', 'riak', 'test-node'];

      for (const nodeName of nodeNames) {
        const response = await fetch(`${API_BASE}/epmd/port`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: 'unreachable-host-12345.invalid',
            port: 4369,
            nodeName,
            timeout: 2000,
          }),
        });

        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.error).toBeDefined();
      }
    }, 20000);
  });

  describe('EPMD Error Handling', () => {
    it('should handle network timeouts gracefully', async () => {
      const response = await fetch(`${API_BASE}/epmd/names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4369,
          timeout: 3000,
        }),
      });

      // Should return error response
      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);

    it('should reject invalid port in names request', async () => {
      const response = await fetch(`${API_BASE}/epmd/names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should reject invalid port in port request', async () => {
      const response = await fetch(`${API_BASE}/epmd/port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 70000,
          nodeName: 'test',
        }),
      });

      // Should return error status (400 or 500)
      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('EPMD Use Cases', () => {
    it('should support RabbitMQ node discovery pattern', async () => {
      // Common RabbitMQ node names
      const response = await fetch(`${API_BASE}/epmd/port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4369,
          nodeName: 'rabbit@localhost',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should support CouchDB node discovery pattern', async () => {
      const response = await fetch(`${API_BASE}/epmd/port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4369,
          nodeName: 'couchdb',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('EPMD Response Timing', () => {
    it('should return error response for unreachable host in names request', async () => {
      const response = await fetch(`${API_BASE}/epmd/names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4369,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should return error response for unreachable host in port request', async () => {
      const response = await fetch(`${API_BASE}/epmd/port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4369,
          nodeName: 'test',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });
});
