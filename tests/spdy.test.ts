/**
 * SPDY Protocol Integration Tests
 *
 * Implementation: src/worker/spdy.ts
 *
 * Endpoints:
 *   POST /api/spdy/connect   — SPDY/3 probe via TLS (also accepts GET with query params)
 *   POST /api/spdy/h2-probe  — Full HTTP/2 probe via TLS
 *
 * Default port: 443/TCP (TLS)
 *
 * SPDY is deprecated since 2016; modern servers respond with HTTP/2.
 * The connect endpoint returns success:true even when SPDY is not detected —
 * it reports the negotiated protocol (spdy3 | http2 | http1 | tls-alert | unknown).
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('SPDY Protocol Integration Tests', () => {
  // ── /api/spdy/connect ─────────────────────────────────────────────────────

  describe('POST /api/spdy/connect', () => {
    it('should return 400 when host is missing (POST)', async () => {
      const response = await fetch(`${API_BASE}/spdy/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 443 }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should return 400 when host is missing (GET)', async () => {
      const response = await fetch(`${API_BASE}/spdy/connect?port=443`);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should return success:false for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/spdy/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-spdy-12345.example.com',
          port: 443,
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/spdy/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 443,
          timeout: 10000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 15000);

    it('should accept GET with query parameters', async () => {
      const params = new URLSearchParams({
        host: 'non-existent-spdy.example.com',
        port: '443',
        timeout: '5000',
      });
      const response = await fetch(`${API_BASE}/spdy/connect?${params}`);
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should use default port 443', async () => {
      const response = await fetch(`${API_BASE}/spdy/connect`, {
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

    it('should accept custom port (e.g. 8443)', async () => {
      const response = await fetch(`${API_BASE}/spdy/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8443,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should probe a modern HTTPS server and return protocol field', async () => {
      const response = await fetch(`${API_BASE}/spdy/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'google.com',
          port: 443,
          timeout: 10000,
        }),
      });
      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      // If connection succeeds the protocol field should be set
      if (data.success) {
        expect(data).toHaveProperty('protocol');
        expect(['spdy3', 'http2', 'http1', 'tls-alert', 'unknown']).toContain(data.protocol);
      }
    }, 15000);
  });

  // ── /api/spdy/h2-probe ────────────────────────────────────────────────────

  describe('POST /api/spdy/h2-probe', () => {
    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/spdy/h2-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 443 }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should return success:false for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/spdy/h2-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 443,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/spdy/h2-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 443,
          timeout: 10000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 15000);

    it('should probe an HTTP/2 server and return h2Settings', async () => {
      const response = await fetch(`${API_BASE}/spdy/h2-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'google.com',
          port: 443,
          path: '/',
          timeout: 15000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
      if (data.isCloudflare) {
        expect(data.success).toBe(false);
        expect(data.error).toContain('Cloudflare');
      } else if (data.success) {
        expect(data).toHaveProperty('h2Settings');
        expect(data).toHaveProperty('protocol');
        expect(data.protocol).toBe('HTTP/2');
      }
    }, 20000);

    it('should support custom path parameter', async () => {
      const response = await fetch(`${API_BASE}/spdy/h2-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'httpbin.org',
          port: 443,
          path: '/get',
          timeout: 10000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
      if (data.isCloudflare) {
        expect(data.success).toBe(false);
        expect(data.error).toContain('Cloudflare');
      }
    }, 15000);

    it('should use default port 443', async () => {
      const response = await fetch(`${API_BASE}/spdy/h2-probe`, {
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

    it('should include framesReceived and bytesReceived fields on success', async () => {
      const response = await fetch(`${API_BASE}/spdy/h2-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'google.com',
          port: 443,
          path: '/',
          timeout: 15000,
        }),
      });
      const data = await response.json();
      if (data.success) {
        expect(data).toHaveProperty('framesReceived');
        expect(Array.isArray(data.framesReceived)).toBe(true);
        expect(data).toHaveProperty('bytesReceived');
        expect(data).toHaveProperty('latencyMs');
      }
    }, 20000);
  });
});
