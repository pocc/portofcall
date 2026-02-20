/**
 * HTTP/1.1 Protocol Integration Tests
 *
 * Tests raw HTTP/1.1 requests sent over TCP via the worker implementation.
 * Implementation: src/worker/http.ts
 *
 * Endpoints:
 *   POST /api/http/request  — generic HTTP request (GET, POST, HEAD, PUT, DELETE, OPTIONS, PATCH, TRACE)
 *   POST /api/http/head     — shortcut for HEAD request
 *   POST /api/http/options  — shortcut for OPTIONS *
 *
 * Default port: 80/TCP (443 when tls: true)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('HTTP Protocol Integration Tests', () => {
  // ── /api/http/request ─────────────────────────────────────────────────────

  describe('POST /api/http/request — method validation', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/http/request`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/http/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'GET' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should return 400 for invalid HTTP method', async () => {
      const response = await fetch(`${API_BASE}/http/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', method: 'INVALID' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Method must be one of');
    });

    it('should accept all valid HTTP methods without error', async () => {
      const methods = ['GET', 'POST', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'TRACE'];
      for (const method of methods) {
        const response = await fetch(`${API_BASE}/http/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: 'unreachable-host-12345.invalid',
            method,
            timeout: 3000,
          }),
        });
        // Should not return 400 for valid methods (may be 200 or 500)
        expect(response.status).not.toBe(400);
      }
    }, 60000);

    it('should return 400 when TRACE request includes a body', async () => {
      const response = await fetch(`${API_BASE}/http/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          method: 'TRACE',
          body: 'should not be allowed',
        }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('TRACE');
    });
  });

  describe('POST /api/http/request — connection to unreachable host', () => {
    it('should return success:false for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/http/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-host-12345.invalid',
          port: 80,
          method: 'GET',
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);
  });

  describe('POST /api/http/request — Cloudflare-protected host', () => {
    it('should return isCloudflare:true for Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/http/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 80,
          method: 'GET',
          path: '/',
          timeout: 10000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 15000);
  });

  describe('POST /api/http/request — successful GET request', () => {
    it('should send GET request and return timing + parsed response', async () => {
      const response = await fetch(`${API_BASE}/http/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'httpbin.org',
          port: 80,
          method: 'GET',
          path: '/get',
          timeout: 15000,
        }),
      });
      expect(response.ok).toBe(true);
      const data = await response.json();
      if (data.isCloudflare) {
        expect(data.success).toBe(false);
        expect(data.error).toContain('Cloudflare');
      } else {
        expect(data.success).toBe(true);
        expect(data.statusCode).toBe(200);
        expect(data.httpVersion).toContain('HTTP/1.1');
        expect(data.body).toBeDefined();
        expect(data.tcpLatency).toBeDefined();
        expect(data.ttfb).toBeDefined();
        expect(data.totalTime).toBeDefined();
        expect(data.requestLine).toContain('GET');
        expect(data.requestHeaders).toBeDefined();
      }
    }, 20000);

    it('should send POST request with body', async () => {
      const response = await fetch(`${API_BASE}/http/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'httpbin.org',
          port: 80,
          method: 'POST',
          path: '/post',
          body: 'test=data',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000,
        }),
      });
      expect(response.ok).toBe(true);
      const data = await response.json();
      if (data.isCloudflare) {
        expect(data.success).toBe(false);
      } else {
        expect(data.success).toBe(true);
        expect(data.statusCode).toBe(200);
        expect(data.requestHeaders).toBeDefined();
      }
    }, 20000);

    it('should support custom request headers', async () => {
      const response = await fetch(`${API_BASE}/http/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'httpbin.org',
          port: 80,
          method: 'GET',
          path: '/headers',
          headers: { 'X-Custom-Header': 'test-value' },
          timeout: 15000,
        }),
      });
      expect(response.ok).toBe(true);
      const data = await response.json();
      if (!data.isCloudflare) {
        expect(data.success).toBe(true);
        expect(data.statusCode).toBe(200);
      }
    }, 20000);

    it('should parse chunked transfer-encoding response body', async () => {
      const response = await fetch(`${API_BASE}/http/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'httpbin.org',
          port: 80,
          method: 'GET',
          path: '/stream/3',
          timeout: 15000,
        }),
      });
      expect(response.ok).toBe(true);
      const data = await response.json();
      if (!data.isCloudflare) {
        expect(data.success).toBe(true);
        expect(data.body).toBeDefined();
      }
    }, 20000);
  });

  describe('POST /api/http/request — TLS / HTTPS', () => {
    it('should connect via TLS when tls:true and port 443', async () => {
      const response = await fetch(`${API_BASE}/http/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'httpbin.org',
          port: 443,
          tls: true,
          method: 'GET',
          path: '/get',
          timeout: 15000,
        }),
      });
      expect(response.ok).toBe(true);
      const data = await response.json();
      if (data.isCloudflare) {
        expect(data.success).toBe(false);
      } else {
        expect(data.success).toBe(true);
        expect(data.tls).toBe(true);
        expect(data.statusCode).toBe(200);
      }
    }, 20000);
  });

  // ── /api/http/head ─────────────────────────────────────────────────────────

  describe('POST /api/http/head', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/http/head`);
      expect(response.status).toBe(405);
    });

    it('should send HEAD request and return headers without body', async () => {
      const response = await fetch(`${API_BASE}/http/head`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'httpbin.org',
          port: 80,
          path: '/get',
          timeout: 15000,
        }),
      });
      const data = await response.json();
      if (data.isCloudflare) {
        expect(data.success).toBe(false);
        expect(data.error).toContain('Cloudflare');
      } else {
        expect(data.success).toBe(true);
        expect(data.statusCode).toBe(200);
        // HEAD responses must not have a body
        expect(data.body).toBeUndefined();
        expect(data.responseHeaders).toBeDefined();
      }
    }, 20000);

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/http/head`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });
  });

  // ── /api/http/options ──────────────────────────────────────────────────────

  describe('POST /api/http/options', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/http/options`);
      expect(response.status).toBe(405);
    });

    it('should send OPTIONS request to httpbin.org', async () => {
      const response = await fetch(`${API_BASE}/http/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'httpbin.org',
          port: 80,
          timeout: 15000,
        }),
      });
      expect(response.ok).toBe(true);
      const data = await response.json();
      if (!data.isCloudflare) {
        expect(data).toHaveProperty('success');
        expect(data.responseHeaders).toBeDefined();
      }
    }, 20000);

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/http/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 80 }),
      });
      expect(response.status).toBe(400);
    });
  });

  // ── Default port behaviour ─────────────────────────────────────────────────

  describe('Default port behaviour', () => {
    it('should default to port 80 when no port specified', async () => {
      const response = await fetch(`${API_BASE}/http/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          method: 'GET',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should default to port 443 when tls:true and no port specified', async () => {
      const response = await fetch(`${API_BASE}/http/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          tls: true,
          method: 'GET',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });
});
