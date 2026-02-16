import { describe, it, expect } from 'vitest';

describe('Firebird Protocol Endpoints', () => {
  describe('POST /api/firebird/probe', () => {
    it('should reject requests with empty host', async () => {
      const response = await fetch('http://localhost:8787/api/firebird/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: '', port: 3050 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject requests with invalid port', async () => {
      const response = await fetch('http://localhost:8787/api/firebird/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'test.example.com', port: 99999 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should handle connection timeout gracefully', async () => {
      const response = await fetch('http://localhost:8787/api/firebird/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: '10.255.255.1', port: 3050 }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should handle non-Firebird server gracefully', async () => {
      // Try to connect to a known HTTP server on wrong port
      const response = await fetch('http://localhost:8787/api/firebird/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', port: 80 }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      // Will either fail to connect or get invalid protocol response
      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 10000);
  });

  describe('POST /api/firebird/version', () => {
    it('should reject requests with empty host', async () => {
      const response = await fetch('http://localhost:8787/api/firebird/version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: '', port: 3050 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should handle connection timeout gracefully', async () => {
      const response = await fetch('http://localhost:8787/api/firebird/version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: '10.255.255.1', port: 3050 }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);
  });

  describe('Method validation', () => {
    it('should reject GET requests to probe endpoint', async () => {
      const response = await fetch('http://localhost:8787/api/firebird/probe', {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should reject GET requests to version endpoint', async () => {
      const response = await fetch('http://localhost:8787/api/firebird/version', {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });
});
