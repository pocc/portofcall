/**
 * Riak KV Protocol Buffers Integration Tests
 * Tests Riak KV PBC (Protocol Buffers Client) connectivity (port 8087)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Riak Protocol Integration Tests', () => {
  // ===== PING =====
  describe('Riak Ping', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/riak/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-riak-host-12345.example.com',
          port: 8087,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/riak/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 8087 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port out of range', async () => {
      const response = await fetch(`${API_BASE}/riak/ping`, {
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
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should reject invalid timeout exceeding maximum', async () => {
      const response = await fetch(`${API_BASE}/riak/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8087,
          timeout: 999999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Timeout must be between 0 and 600000 ms');
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/riak/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8087,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should use default port 8087 (Riak PBC default)', async () => {
      const response = await fetch(`${API_BASE}/riak/ping`, {
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
      const response = await fetch(`${API_BASE}/riak/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 8087,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });

  // ===== INFO =====
  describe('Riak Server Info', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/riak/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-riak-host-12345.example.com',
          port: 8087,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/riak/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 8087 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port on info', async () => {
      const response = await fetch(`${API_BASE}/riak/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle timeout on info', async () => {
      const response = await fetch(`${API_BASE}/riak/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8087,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/riak/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 8087,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  // ===== GET =====
  describe('Riak Get', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/riak/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-riak-host-12345.example.com',
          port: 8087,
          bucket: 'mybucket',
          key: 'mykey',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing required fields (host, bucket, key)', async () => {
      const response = await fetch(`${API_BASE}/riak/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'unreachable-host-12345.invalid', port: 8087 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Missing required: host, bucket, key');
    });

    it('should fail with missing bucket', async () => {
      const response = await fetch(`${API_BASE}/riak/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8087,
          key: 'mykey',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should accept optional bucketType parameter', async () => {
      const response = await fetch(`${API_BASE}/riak/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8087,
          bucket: 'mybucket',
          key: 'mykey',
          bucketType: 'default',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/riak/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 8087,
          bucket: 'mybucket',
          key: 'mykey',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  // ===== PUT =====
  describe('Riak Put', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/riak/put`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-riak-host-12345.example.com',
          port: 8087,
          bucket: 'mybucket',
          key: 'mykey',
          value: 'myvalue',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing required fields (host, bucket, key, value)', async () => {
      const response = await fetch(`${API_BASE}/riak/put`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8087,
          bucket: 'mybucket',
          key: 'mykey',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Missing required: host, bucket, key, value');
    });

    it('should accept optional contentType parameter', async () => {
      const response = await fetch(`${API_BASE}/riak/put`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8087,
          bucket: 'mybucket',
          key: 'mykey',
          value: '{"test": true}',
          contentType: 'application/json',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept optional bucketType parameter', async () => {
      const response = await fetch(`${API_BASE}/riak/put`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8087,
          bucket: 'mybucket',
          key: 'mykey',
          value: 'myvalue',
          bucketType: 'default',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/riak/put`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 8087,
          bucket: 'mybucket',
          key: 'mykey',
          value: 'myvalue',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  // ===== ERROR HANDLING =====
  describe('Riak Error Handling', () => {
    it('should return 400 for missing host on ping', async () => {
      const response = await fetch(`${API_BASE}/riak/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 8087 }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully on info', async () => {
      const response = await fetch(`${API_BASE}/riak/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8087,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should handle network errors gracefully on get', async () => {
      const response = await fetch(`${API_BASE}/riak/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8087,
          bucket: 'mybucket',
          key: 'mykey',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should handle network errors gracefully on put', async () => {
      const response = await fetch(`${API_BASE}/riak/put`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8087,
          bucket: 'mybucket',
          key: 'mykey',
          value: 'myvalue',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });
});
