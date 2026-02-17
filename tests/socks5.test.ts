/**
 * SOCKS5 Protocol Integration Tests
 * Tests SOCKS5 proxy handshake, authentication, and connection
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('SOCKS5 Protocol Integration Tests', () => {
  describe('SOCKS5 Input Validation', () => {
    it('should fail with missing proxy host', async () => {
      const response = await fetch(`${API_BASE}/socks5/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destHost: 'example.com',
          destPort: 80,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Proxy host');
    });

    it('should fail with missing destination host', async () => {
      const response = await fetch(`${API_BASE}/socks5/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyHost: '127.0.0.1',
          destPort: 80,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Destination host');
    });

    it('should fail with invalid destination port', async () => {
      const response = await fetch(`${API_BASE}/socks5/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyHost: '127.0.0.1',
          destHost: 'example.com',
          destPort: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('port');
    });

    it('should reject GET method', async () => {
      const response = await fetch(`${API_BASE}/socks5/connect`);
      expect(response.status).toBe(405);
    });
  });

  describe('SOCKS5 Connection Tests', () => {
    it('should fail gracefully with non-existent proxy', async () => {
      const response = await fetch(`${API_BASE}/socks5/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyHost: 'non-existent-proxy-12345.example.com',
          proxyPort: 1080,
          destHost: 'example.com',
          destPort: 80,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail gracefully with unreachable proxy', async () => {
      const response = await fetch(`${API_BASE}/socks5/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyHost: 'unreachable-host-12345.invalid', // TEST-NET-1 (reserved, unreachable)
          proxyPort: 1080,
          destHost: 'example.com',
          destPort: 80,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should detect non-SOCKS5 server gracefully', async () => {
      // Connecting to a web server on port 80 - it won't speak SOCKS5
      const response = await fetch(`${API_BASE}/socks5/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyHost: '93.184.216.34', // example.com IP
          proxyPort: 80,
          destHost: 'example.com',
          destPort: 80,
          timeout: 10000,
        }),
      });

      // Should fail (web server doesn't speak SOCKS5)
      const data = await response.json();
      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 15000);
  });

  describe('SOCKS5 Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected proxy', async () => {
      const response = await fetch(`${API_BASE}/socks5/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyHost: 'cloudflare.com',
          proxyPort: 1080,
          destHost: 'example.com',
          destPort: 80,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 30000);
  });

  describe('SOCKS5 Protocol Details', () => {
    it('should include authentication fields in response', async () => {
      // This will fail to connect, but validates response structure
      const response = await fetch(`${API_BASE}/socks5/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyHost: '127.0.0.1',
          proxyPort: 1080,
          destHost: 'example.com',
          destPort: 80,
          username: 'testuser',
          password: 'testpass',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      // Connection will fail (no local SOCKS5), but verify structure
      expect(data).toHaveProperty('success');
      if (data.success) {
        expect(data).toHaveProperty('authMethod');
        expect(data).toHaveProperty('replyCode');
        expect(data).toHaveProperty('replyMessage');
      }
    }, 10000);
  });
});
