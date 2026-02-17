import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Bitcoin P2P Protocol Integration Tests', () => {
  describe('POST /api/bitcoin/connect', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/bitcoin/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 8333 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject unknown network', async () => {
      const response = await fetch(`${API_BASE}/bitcoin/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          network: 'fakenet',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Unknown network');
    });

    it('should handle unreachable host gracefully', async () => {
      const response = await fetch(`${API_BASE}/bitcoin/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 8333,
          network: 'mainnet',
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should support GET with query params', async () => {
      const response = await fetch(
        `${API_BASE}/bitcoin/connect?host=nonexistent.invalid&port=8333&timeout=3000`
      );

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });

    it('should default to port 8333 and mainnet', async () => {
      const response = await fetch(`${API_BASE}/bitcoin/connect`, {
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

  describe('POST /api/bitcoin/getaddr', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/bitcoin/getaddr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 8333 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should handle unreachable host', async () => {
      const response = await fetch(`${API_BASE}/bitcoin/getaddr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 8333,
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    });
  });
});
