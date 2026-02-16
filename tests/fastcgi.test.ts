import { describe, it, expect } from 'vitest';

const API_BASE = 'http://localhost:8787';

describe('FastCGI Protocol (Port 9000)', () => {
  describe('Probe - Input Validation', () => {
    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/fastcgi/probe`, {
        method: 'GET',
      });
      expect(response.status).toBe(405);
    });

    it('should require host', async () => {
      const response = await fetch(`${API_BASE}/api/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject invalid ports', async () => {
      const response = await fetch(`${API_BASE}/api/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 99999,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });
  });

  describe('Request - Input Validation', () => {
    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/fastcgi/request`, {
        method: 'GET',
      });
      expect(response.status).toBe(405);
    });

    it('should require host', async () => {
      const response = await fetch(`${API_BASE}/api/fastcgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptFilename: '/index.php' }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });
  });

  describe('Connection Tests', () => {
    it('should handle unreachable hosts gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 9000,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should detect Cloudflare-protected hosts', async () => {
      const response = await fetch(`${API_BASE}/api/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 9000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle wrong port (non-FastCGI service)', async () => {
      const response = await fetch(`${API_BASE}/api/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'google.com',
          port: 80,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      // May get connected but won't get valid FastCGI response
      if (data.success) {
        expect(data.records).toBeDefined();
      } else {
        expect(data.error).toBeDefined();
      }
    }, 10000);
  });

  describe('Response Structure', () => {
    it('should return proper error format for probe failures', async () => {
      const response = await fetch(`${API_BASE}/api/fastcgi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 9000,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    }, 8000);

    it('should return proper error format for request failures', async () => {
      const response = await fetch(`${API_BASE}/api/fastcgi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 9000,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error');
    }, 8000);
  });
});
