/**
 * NATS Protocol Integration Tests
 * Tests NATS connectivity and message publishing
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('NATS Protocol Integration Tests', () => {
  describe('NATS Connect (HTTP)', () => {
    it('should connect to demo.nats.io successfully', async () => {
      const response = await fetch(`${API_BASE}/nats/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'demo.nats.io',
          port: 4222,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        serverInfo?: {
          version?: string;
          server_id?: string;
        };
      };

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.serverInfo).toBeDefined();
      expect(data.serverInfo?.version).toBeDefined();
      expect(data.serverInfo?.server_id).toBeDefined();
    }, 15000);

    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/nats/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-nats-host-12345.example.com',
          port: 4222,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/nats/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 4222,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('host');
    });

    it('should support GET request with query parameters', async () => {
      const params = new URLSearchParams({
        host: 'demo.nats.io',
        port: '4222',
        timeout: '10000',
      });

      const response = await fetch(`${API_BASE}/nats/connect?${params}`);
      const data = await response.json() as { success?: boolean };
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(true);
    }, 15000);

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/nats/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4222,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle user/pass authentication parameters', async () => {
      const response = await fetch(`${API_BASE}/nats/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4222,
          user: 'testuser',
          pass: 'testpass',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should handle token authentication parameter', async () => {
      const response = await fetch(`${API_BASE}/nats/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4222,
          token: 'test-token',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('NATS Publish', () => {
    it('should publish a message to demo.nats.io', async () => {
      const response = await fetch(`${API_BASE}/nats/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'demo.nats.io',
          port: 4222,
          subject: 'test.portofcall',
          payload: 'Hello from Port of Call test!',
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        subject?: string;
        payloadSize?: number;
      };

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.subject).toBe('test.portofcall');
      expect(data.payloadSize).toBeGreaterThan(0);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/nats/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: 'test.subject',
          payload: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing subject parameter', async () => {
      const response = await fetch(`${API_BASE}/nats/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'demo.nats.io',
          payload: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('subject');
    });

    it('should publish empty payload', async () => {
      const response = await fetch(`${API_BASE}/nats/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'demo.nats.io',
          port: 4222,
          subject: 'test.empty',
          payload: '',
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        payloadSize?: number;
      };

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.payloadSize).toBe(0);
    }, 15000);

    it('should handle publish to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/nats/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4222,
          subject: 'test.subject',
          payload: 'test',
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('NATS Error Handling', () => {
    it('should return 400 for missing host', async () => {
      const response = await fetch(`${API_BASE}/nats/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 4222,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully', async () => {
      const response = await fetch(`${API_BASE}/nats/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4222,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });

  describe('NATS Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/nats/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 4222,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);

    it('should block publish to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/nats/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 4222,
          subject: 'test',
          payload: 'test',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  describe('NATS Port Support', () => {
    it('should accept port 4222 (NATS default)', async () => {
      const response = await fetch(`${API_BASE}/nats/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'demo.nats.io',
          port: 4222,
          timeout: 10000,
        }),
      });

      const data = await response.json() as { success?: boolean };
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(true);
    }, 15000);

    it('should accept custom ports', async () => {
      const response = await fetch(`${API_BASE}/nats/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4223,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });
});
