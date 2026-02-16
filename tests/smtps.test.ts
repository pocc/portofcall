import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg';

describe('SMTPS Protocol Integration Tests', () => {
  describe('POST /api/smtps/connect', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/api/smtps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 465 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should handle unreachable host gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/smtps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 465,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should support GET with query params', async () => {
      const response = await fetch(
        `${API_BASE}/api/smtps/connect?host=nonexistent.invalid&port=465&timeout=5000`
      );

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });

    it('should default to port 465', async () => {
      const response = await fetch(`${API_BASE}/api/smtps/connect`, {
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

  describe('POST /api/smtps/send', () => {
    it('should reject missing required fields', async () => {
      const response = await fetch(`${API_BASE}/api/smtps/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'smtp.example.com',
          port: 465,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('from');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/smtps/send`);

      expect(response.status).toBe(405);
    });

    it('should reject send with missing body', async () => {
      const response = await fetch(`${API_BASE}/api/smtps/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'smtp.example.com',
          port: 465,
          from: 'a@b.com',
          to: 'c@d.com',
          subject: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });
  });
});
