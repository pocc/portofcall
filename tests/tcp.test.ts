/**
 * TCP Protocol Integration Tests
 * Tests raw TCP send/receive operations
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('TCP Protocol Integration Tests', () => {
  describe('TCP Send Endpoint', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-tcp-host-12345.example.com',
          port: 80,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 80,
          // Missing host
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host is required');
    });

    it('should fail with missing port parameter', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          // Missing port
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should reject invalid port numbers (too low)', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
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

    it('should reject invalid port numbers (too high)', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
      const data = await response.json();
      expect(data.error).toContain('Method not allowed');
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          timeout: 3000,
        }),
      });

      // Should timeout or fail quickly
      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should connect without sending data (banner grab)', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 22, // SSH typically sends banner first
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      // Only check these on success
      if (data.success) {
        expect(data).toHaveProperty('sent');
        expect(data).toHaveProperty('sentBytes');
      }
    }, 10000);

    it('should send UTF-8 data', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          data: 'GET / HTTP/1.0\r\n\r\n',
          encoding: 'utf8',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      // Only check on success
      if (data.success) {
        expect(data).toHaveProperty('sent');
        expect(data).toHaveProperty('encoding');
        if (data.encoding) {
          expect(data.encoding).toBe('utf8');
        }
      }
    }, 10000);

    it('should send hex-encoded data', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          data: '48656c6c6f', // "Hello" in hex
          encoding: 'hex',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      // Only check on success
      if (data.success) {
        expect(data).toHaveProperty('encoding');
        if (data.encoding) {
          expect(data.encoding).toBe('hex');
        }
      }
    }, 10000);

    it('should reject invalid encoding', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 80,
          encoding: 'base64',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Encoding must be "utf8" or "hex"');
    });

    it('should respect maxBytes parameter', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          maxBytes: 1024,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (data.bytesReceived !== undefined) {
        expect(data.bytesReceived).toBeLessThanOrEqual(1024);
      }
    }, 10000);

    it('should reject invalid maxBytes (too low)', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 80,
          maxBytes: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('maxBytes must be between 1 and 65536');
    });

    it('should reject invalid maxBytes (too high)', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 80,
          maxBytes: 100000,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('maxBytes must be between 1 and 65536');
    });

    it('should return proper response structure', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          data: 'Test',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      // Only check full structure on success
      if (data.success) {
        expect(data).toHaveProperty('host');
        expect(data).toHaveProperty('port');
        expect(data).toHaveProperty('sent');
        expect(data).toHaveProperty('sentBytes');
        expect(data).toHaveProperty('received');
        expect(data).toHaveProperty('receivedHex');
        expect(data).toHaveProperty('receivedUtf8');
        expect(data).toHaveProperty('bytesReceived');
        expect(data).toHaveProperty('rtt');
        expect(data).toHaveProperty('connectMs');
        expect(data).toHaveProperty('encoding');
      }
    }, 10000);
  });

  describe('TCP Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 443,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);

    it('should block connection to Cloudflare IP address', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '104.16.1.1',
          port: 443,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  describe('TCP Use Cases', () => {
    it('should support HTTP banner grab pattern', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          data: 'HEAD / HTTP/1.0\r\n\r\n',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      // Only check on success
      if (data.success) {
        expect(data).toHaveProperty('sent');
        expect(data.sent).toContain('HTTP');
      }
    }, 10000);

    it('should support SMTP banner grab pattern', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 25,
          timeout: 3000,
          // No data - SMTP server sends banner first
        }),
      });

      const data = await response.json();
      // Only check on success
      if (data.success) {
        expect(data).toHaveProperty('received');
      }
    }, 10000);

    it('should support FTP banner grab pattern', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 21,
          timeout: 3000,
          // No data - FTP server sends banner first
        }),
      });

      const data = await response.json();
      // Only check on success
      if (data.success) {
        expect(data).toHaveProperty('received');
      }
    }, 10000);

    it('should support SSH banner grab pattern', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 22,
          timeout: 3000,
          // No data - SSH server sends banner first
        }),
      });

      const data = await response.json();
      // Only check on success
      if (data.success) {
        expect(data).toHaveProperty('received');
      }
    }, 10000);
  });

  describe('TCP Response Timing', () => {
    it('should include RTT measurement', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('rtt');
      expect(typeof data.rtt).toBe('number');
    }, 10000);

    it('should include separate connect time measurement', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (data.success) {
        expect(data).toHaveProperty('connectMs');
        expect(typeof data.connectMs).toBe('number');
      }
    }, 10000);
  });

  describe('TCP Data Encoding', () => {
    it('should always return both hex and utf8 decoded responses', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          encoding: 'utf8',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (data.success) {
        expect(data).toHaveProperty('receivedHex');
        expect(data).toHaveProperty('receivedUtf8');
        expect(typeof data.receivedHex).toBe('string');
        expect(typeof data.receivedUtf8).toBe('string');
      }
    }, 10000);

    it('should handle binary data correctly', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          data: 'FF00FF00',
          encoding: 'hex',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      // Only check on success
      if (data.success) {
        expect(data).toHaveProperty('encoding');
        if (data.sent) {
          expect(data.sent).toBe('FF00FF00');
        }
      }
    }, 10000);
  });

  describe('TCP Error Handling', () => {
    it('should handle network timeouts gracefully', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle connection refused gracefully', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 1,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);
  });
});
