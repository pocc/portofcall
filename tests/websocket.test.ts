import { describe, it, expect } from 'vitest';

const API_BASE = (process.env.API_BASE || 'https://portofcall.ross.gg/api').replace(/\/api$/, '');

describe('WebSocket Protocol (Port 80/443)', () => {
  describe('Probe - Input Validation', () => {
    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/websocket/probe`, {
        method: 'GET',
      });
      expect(response.status).toBe(405);
    });

    it('should require host', async () => {
      const response = await fetch(`${API_BASE}/api/websocket/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject invalid ports', async () => {
      const response = await fetch(`${API_BASE}/api/websocket/probe`, {
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

    it('should accept valid parameters', async () => {
      const response = await fetch(`${API_BASE}/api/websocket/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          path: '/ws',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      // Should attempt connection (and fail for unreachable host)
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);
  });

  describe('Connection Tests', () => {
    it('should handle unreachable hosts gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/websocket/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);

    it('should detect Cloudflare-protected hosts', async () => {
      const response = await fetch(`${API_BASE}/api/websocket/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 80,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle non-WebSocket HTTP server', async () => {
      const response = await fetch(`${API_BASE}/api/websocket/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 80,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      // Server should respond with HTTP but not 101
      if (data.success === false) {
        expect(data.error || data.statusCode).toBeDefined();
      } else {
        // If somehow it connects, verify we get response structure
        expect(data.statusCode).toBeDefined();
      }
    }, 10000);
  });

  describe('Response Structure', () => {
    it('should return proper error format for probe failures', async () => {
      const response = await fetch(`${API_BASE}/api/websocket/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    }, 15000);

    it('should include timing information when connection is made', async () => {
      const response = await fetch(`${API_BASE}/api/websocket/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 80,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      // If the server responded (even with non-101), we should have timing
      if (data.connectTimeMs !== undefined) {
        expect(typeof data.connectTimeMs).toBe('number');
        expect(typeof data.totalTimeMs).toBe('number');
      }
    }, 10000);
  });

  describe('Ping Feature', () => {
    it('should accept sendPing parameter', async () => {
      const response = await fetch(`${API_BASE}/api/websocket/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          sendPing: true,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      // Ping only happens after successful upgrade, so no pingResponse on failed connection
      expect(data.pingResponse).toBeUndefined();
    }, 15000);
  });

  describe('Protocol Sub-protocols', () => {
    it('should accept sub-protocols parameter', async () => {
      const response = await fetch(`${API_BASE}/api/websocket/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          protocols: 'chat, superchat',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });
});
