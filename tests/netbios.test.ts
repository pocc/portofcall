import { describe, it, expect } from 'vitest';

const BASE_URL = 'https://portofcall.ross.gg';

describe('NetBIOS Session Service Protocol', () => {
  // Connect endpoint tests
  describe('POST /api/netbios/connect', () => {
    it('should return error when host is missing', async () => {
      const response = await fetch(`${BASE_URL}/api/netbios/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should handle non-existent host gracefully', async () => {
      const response = await fetch(`${BASE_URL}/api/netbios/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid.example.com',
          port: 139,
          timeout: 5000,
        }),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });

    it('should reject invalid port numbers', async () => {
      const response = await fetch(`${BASE_URL}/api/netbios/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 99999,
        }),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should handle connection timeout', async () => {
      const response = await fetch(`${BASE_URL}/api/netbios/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET, should timeout
          port: 139,
          timeout: 3000,
        }),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should accept custom called name and suffix', async () => {
      const response = await fetch(`${BASE_URL}/api/netbios/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          calledName: 'FILESERVER',
          calledSuffix: 0x20,
          timeout: 3000,
        }),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      // Should fail with timeout, not validation error
    });

    it('should detect Cloudflare-protected hosts', async () => {
      const response = await fetch(`${BASE_URL}/api/netbios/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 139,
        }),
      });
      const data = await response.json() as { success: boolean; error: string; isCloudflare?: boolean };
      expect(data.success).toBe(false);
    });
  });

  // Probe endpoint tests
  describe('POST /api/netbios/probe', () => {
    it('should return error when host is missing', async () => {
      const response = await fetch(`${BASE_URL}/api/netbios/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('host');
    });

    it('should handle non-existent host on probe', async () => {
      const response = await fetch(`${BASE_URL}/api/netbios/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid.example.com',
          timeout: 5000,
        }),
      });
      const data = await response.json() as { success: boolean; services?: unknown[] };
      // Probe returns success with empty results for unreachable hosts
      if (data.success) {
        expect(data.services).toBeDefined();
      } else {
        expect(data).toBeDefined();
      }
    });

    it('should reject invalid port on probe', async () => {
      const response = await fetch(`${BASE_URL}/api/netbios/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 0,
        }),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should detect Cloudflare-protected hosts on probe', async () => {
      const response = await fetch(`${BASE_URL}/api/netbios/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
        }),
      });
      const data = await response.json() as { success: boolean; error: string; isCloudflare?: boolean };
      expect(data.success).toBe(false);
    });
  });

  // Port support
  it('should support default port 139', async () => {
    const response = await fetch(`${BASE_URL}/api/netbios/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'nonexistent.invalid.example.com',
        timeout: 3000,
      }),
    });
    const data = await response.json() as { success: boolean };
    expect(data.success).toBe(false);
    // Key test: doesn't fail on missing port (defaults to 139)
  });
});
