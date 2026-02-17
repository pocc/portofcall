import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('RSH Protocol Integration Tests', () => {
  describe('POST /api/rsh/execute', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/rsh/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 514 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should handle unreachable host gracefully', async () => {
      const response = await fetch(`${API_BASE}/rsh/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 514,
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should accept custom users and command', async () => {
      const response = await fetch(`${API_BASE}/rsh/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 514,
          localUser: 'alice',
          remoteUser: 'alice',
          command: 'whoami',
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
        `${API_BASE}/rsh/execute?host=nonexistent.invalid&port=514&timeout=3000`
      );

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });

    it('should default to port 514 and guest user', async () => {
      const response = await fetch(`${API_BASE}/rsh/execute`, {
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

    it('should detect Cloudflare-protected hosts', async () => {
      // cloudflare.com resolves to a Cloudflare IP
      const response = await fetch(`${API_BASE}/rsh/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 514,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json() as { success: boolean; isCloudflare: boolean };
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    });
  });
});
