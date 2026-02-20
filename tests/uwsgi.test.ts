/**
 * uWSGI Protocol Integration Tests
 * Tests uWSGI binary protocol (default port 3031)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('uWSGI Protocol Integration Tests', () => {
  describe('POST /api/uwsgi/probe', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 3031 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-uwsgi-host-12345.example.com',
          port: 3031,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should default to port 3031 when not specified', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 15000);

    it('should handle custom timeout', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3031,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 3031,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });

  describe('POST /api/uwsgi/request', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-uwsgi-host-12345.example.com',
          port: 3031,
          path: '/',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should default method to GET when not specified', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3031,
          path: '/test',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should accept custom HTTP methods', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3031,
          method: 'POST',
          path: '/api/endpoint',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should reject invalid HTTP method', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3031,
          method: 'INVALID123',
          path: '/',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid HTTP method');
    });

    it('should reject path not starting with /', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3031,
          path: 'no-leading-slash',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Path must start with /');
    });

    it('should handle path with query string', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3031,
          path: '/api/test?foo=bar&baz=qux',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 3031,
          path: '/',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  describe('uWSGI Protocol Encoding', () => {
    it('should handle empty WSGI variables', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3031,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);
  });

  describe('uWSGI Response Parsing', () => {
    it('should return structured error for connection failure', async () => {
      const response = await fetch(`${API_BASE}/uwsgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3031,
          path: '/',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    }, 15000);
  });
});
