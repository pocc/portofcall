import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg';

describe('HTTP Proxy Protocol Integration Tests', () => {
  describe('POST /api/httpproxy/probe', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/api/httpproxy/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 3128 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should handle unreachable proxy gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/httpproxy/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 3128,
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should support GET with query params', async () => {
      const response = await fetch(
        `${API_BASE}/api/httpproxy/probe?host=nonexistent.invalid&port=3128&timeout=3000`
      );

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });

    it('should accept custom target URL', async () => {
      const response = await fetch(`${API_BASE}/api/httpproxy/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 8080,
          targetUrl: 'http://httpbin.org/ip',
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });
  });

  describe('POST /api/httpproxy/connect', () => {
    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/httpproxy/connect`);
      expect(response.status).toBe(405);
    });

    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/api/httpproxy/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 3128 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should handle unreachable proxy for CONNECT', async () => {
      const response = await fetch(`${API_BASE}/api/httpproxy/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 3128,
          targetHost: 'example.com',
          targetPort: 443,
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });
  });
});
