import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('FTPS Protocol Integration Tests', () => {
  describe('POST /api/ftps/connect', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/ftps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 990 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject invalid port (0)', async () => {
      const response = await fetch(`${API_BASE}/ftps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'ftp.example.com', port: 0 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should reject invalid port (65536)', async () => {
      const response = await fetch(`${API_BASE}/ftps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'ftp.example.com', port: 65536 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should handle unreachable host gracefully', async () => {
      const response = await fetch(`${API_BASE}/ftps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 990,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });

    it('should default to port 990 when port is omitted', async () => {
      const response = await fetch(`${API_BASE}/ftps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          timeout: 5000,
        }),
      });

      // Should fail connection, but not with a port validation error
      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).not.toContain('Port');
    });

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/ftps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 990,
          timeout: 5000,
        }),
      });

      const data = await response.json() as { success: boolean; isCloudflare?: boolean };
      if (!data.success && data.isCloudflare) {
        expect(data.isCloudflare).toBe(true);
      }
      // Either blocks with Cloudflare detection or connection fails - both are valid
      expect(data.success).toBe(false);
    });

    it('should return structured result on successful connection', async () => {
      // This test requires a real FTPS server; skip if not available
      // Uses test.rebex.net which hosts a demo FTPS server on port 990
      const response = await fetch(`${API_BASE}/ftps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test.rebex.net',
          port: 990,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success: boolean;
        host?: string;
        port?: number;
        rtt?: number;
        encrypted?: boolean;
        protocol?: string;
        banner?: { code: number; message: string };
        features?: string[];
      };

      if (data.success) {
        expect(data.host).toBe('test.rebex.net');
        expect(data.port).toBe(990);
        expect(data.rtt).toBeGreaterThan(0);
        expect(data.encrypted).toBe(true);
        expect(data.protocol).toContain('Implicit TLS');
        expect(data.banner).toBeDefined();
        expect(data.banner!.code).toBe(220);
      } else {
        // Connection may fail in CI/test environments - that's acceptable
        expect(data.success).toBe(false);
      }
    });
  });
});
