/**
 * FastCGI Protocol Integration Tests
 * Tests FastCGI server probing and request forwarding
 *
 * FastCGI uses a binary record format:
 *   version(1) + type(1) + requestId(2) + contentLength(2) + paddingLength(1) + reserved(1) + content
 *
 * Two endpoints:
 * - /api/fastcgi/probe - FCGI_GET_VALUES to discover server capabilities
 * - /api/fastcgi/request - Send a CGI request (BEGIN_REQUEST + PARAMS + STDIN)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('FastCGI Protocol Integration Tests', () => {
  // ─── Probe endpoint ────────────────────────────────────────────────────────

  describe('POST /api/fastcgi/probe - input validation', () => {
    it('should require host parameter', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 9000 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject invalid port (0)', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', port: 0 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should reject invalid port (65536)', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', port: 65536 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });
  });

  describe('POST /api/fastcgi/probe - connection failures', () => {
    it('should fail gracefully for non-existent host', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-fastcgi-host-12345.invalid',
          port: 9000,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should respect timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9000,
          timeout: 3000,
        }),
      });

      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    }, 10000);

    it('should use default port 9000 when not specified', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json() as { success: boolean };
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('POST /api/fastcgi/probe - Cloudflare detection', () => {
    it('should block Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 9000,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json() as { success: boolean; isCloudflare: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 15000);
  });

  describe('POST /api/fastcgi/probe - response structure', () => {
    it('should return consistent error structure for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9000,
          timeout: 3000,
        }),
      });

      const data = await response.json() as { success: boolean; error: string };
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('error');
      expect(typeof data.success).toBe('boolean');
      expect(typeof data.error).toBe('string');
    }, 10000);
  });

  // ─── Request endpoint ──────────────────────────────────────────────────────

  describe('POST /api/fastcgi/request - input validation', () => {
    it('should require host parameter', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 9000,
          scriptFilename: '/index.php',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 99999,
          scriptFilename: '/index.php',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });
  });

  describe('POST /api/fastcgi/request - connection failures', () => {
    it('should fail gracefully for non-existent host', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-fastcgi-host-12345.invalid',
          port: 9000,
          scriptFilename: '/index.php',
          requestUri: '/',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should use default values when optional params omitted', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json() as { success: boolean };
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('POST /api/fastcgi/request - Cloudflare detection', () => {
    it('should block Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 9000,
          scriptFilename: '/index.php',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json() as { success: boolean; isCloudflare: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 15000);
  });

  describe('POST /api/fastcgi/request - response structure', () => {
    it('should return consistent error structure', async () => {
      const response = await fetch(`${API_BASE}/fastcgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9000,
          timeout: 3000,
        }),
      });

      const data = await response.json() as { success: boolean; error: string };
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('error');
      expect(typeof data.success).toBe('boolean');
      expect(typeof data.error).toBe('string');
    }, 10000);
  });
});
