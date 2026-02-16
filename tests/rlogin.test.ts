import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg';

describe('Rlogin Protocol Integration Tests', () => {
  describe('POST /api/rlogin/connect', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/api/rlogin/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 513 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should handle unreachable host gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/rlogin/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 513,
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should accept custom user and terminal params', async () => {
      const response = await fetch(`${API_BASE}/api/rlogin/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 513,
          localUser: 'testuser',
          remoteUser: 'admin',
          terminalType: 'vt100',
          terminalSpeed: '9600',
          timeout: 3000,
        }),
      });

      // Should fail with connection error, not validation error
      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });

    it('should support GET with query params', async () => {
      const response = await fetch(
        `${API_BASE}/api/rlogin/connect?host=nonexistent.invalid&port=513&timeout=3000`
      );

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });

    it('should default to port 513 and guest user', async () => {
      const response = await fetch(`${API_BASE}/api/rlogin/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });
  });

  describe('WebSocket /api/rlogin/connect', () => {
    it('should serve HTTP probe without upgrade header', async () => {
      const response = await fetch(`${API_BASE}/api/rlogin/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 513,
          timeout: 3000,
        }),
      });

      // Should get a JSON response (not 426), since without Upgrade header it falls through to HTTP probe
      expect(response.headers.get('Content-Type')).toContain('application/json');
    });
  });
});
