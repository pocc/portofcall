import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg';

describe('LMTP Protocol Integration Tests', () => {
  describe('POST /api/lmtp/connect', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/api/lmtp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 24,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should handle unreachable host gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/lmtp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 24,
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should support GET with query params', async () => {
      const response = await fetch(
        `${API_BASE}/api/lmtp/connect?host=nonexistent.invalid&port=24&timeout=3000`
      );

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });
  });

  describe('POST /api/lmtp/send', () => {
    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/lmtp/send`);

      expect(response.status).toBe(405);
    });

    it('should reject missing required fields', async () => {
      const response = await fetch(`${API_BASE}/api/lmtp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'mail.example.com',
          from: 'sender@example.com',
          // missing to, subject, body
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing');
    });

    it('should handle unreachable LMTP server', async () => {
      const response = await fetch(`${API_BASE}/api/lmtp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 24,
          from: 'sender@example.com',
          to: ['user@example.com'],
          subject: 'Test',
          body: 'Test body',
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should accept single recipient as string', async () => {
      const response = await fetch(`${API_BASE}/api/lmtp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 24,
          from: 'sender@example.com',
          to: 'user@example.com',
          subject: 'Test',
          body: 'Test body',
          timeout: 3000,
        }),
      });

      // Should fail with connection error, not validation error
      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });
  });
});
