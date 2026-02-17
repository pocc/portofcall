import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('IMAPS Protocol Integration Tests', () => {
  describe('POST /api/imaps/connect', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/imaps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 993 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should handle unreachable host gracefully', async () => {
      const response = await fetch(`${API_BASE}/imaps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 993,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should support GET with query params', async () => {
      const response = await fetch(
        `${API_BASE}/imaps/connect?host=nonexistent.invalid&port=993&timeout=5000`
      );

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });

    it('should default to port 993', async () => {
      const response = await fetch(`${API_BASE}/imaps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });
  });

  describe('POST /api/imaps/list', () => {
    it('should reject missing credentials', async () => {
      const response = await fetch(`${API_BASE}/imaps/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'imap.example.com',
          port: 993,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('username');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/imaps/list`);

      expect(response.status).toBe(405);
    });
  });

  describe('POST /api/imaps/select', () => {
    it('should reject missing mailbox', async () => {
      const response = await fetch(`${API_BASE}/imaps/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'imap.example.com',
          port: 993,
          username: 'user',
          password: 'pass',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('mailbox');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/imaps/select`);

      expect(response.status).toBe(405);
    });
  });
});
