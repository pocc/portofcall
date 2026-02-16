import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg';

describe('Nomad Protocol Integration Tests', () => {
  describe('POST /api/nomad/health', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/api/nomad/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 4646 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should handle unreachable host gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/nomad/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 4646,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/nomad/health`);

      expect(response.status).toBe(405);
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/api/nomad/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nomad.example.com',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });
  });

  describe('POST /api/nomad/jobs', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/api/nomad/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 4646 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/nomad/jobs`);

      expect(response.status).toBe(405);
    });
  });

  describe('POST /api/nomad/nodes', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/api/nomad/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 4646 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/nomad/nodes`);

      expect(response.status).toBe(405);
    });
  });
});
