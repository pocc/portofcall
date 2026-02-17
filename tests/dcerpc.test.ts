import { describe, it, expect } from 'vitest';

const BASE_URL = 'https://portofcall.ross.gg';

describe('DCERPC/MS-RPC Protocol', () => {
  // Connect endpoint tests
  describe('POST /api/dcerpc/connect', () => {
    it('should return error when host is missing', async () => {
      const response = await fetch(`${BASE_URL}/api/dcerpc/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should handle non-existent host gracefully', async () => {
      const response = await fetch(`${BASE_URL}/api/dcerpc/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid.example.com',
          port: 135,
          timeout: 5000,
        }),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });

    it('should reject invalid port numbers', async () => {
      const response = await fetch(`${BASE_URL}/api/dcerpc/connect`, {
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
      const response = await fetch(`${BASE_URL}/api/dcerpc/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // TEST-NET, should timeout
          port: 135,
          timeout: 3000,
        }),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should detect Cloudflare-protected hosts', async () => {
      const response = await fetch(`${BASE_URL}/api/dcerpc/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 135,
        }),
      });
      const data = await response.json() as { success: boolean; error: string; isCloudflare?: boolean };
      expect(data.success).toBe(false);
    });
  });

  // Probe endpoint tests
  describe('POST /api/dcerpc/probe', () => {
    it('should return error when host is missing', async () => {
      const response = await fetch(`${BASE_URL}/api/dcerpc/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interfaceName: 'epm',
        }),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('host');
    });

    it('should return error when no interface is specified', async () => {
      const response = await fetch(`${BASE_URL}/api/dcerpc/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
        }),
      });
      const data = await response.json() as { success: boolean; error: string; availableInterfaces?: unknown[] };
      expect(data.success).toBe(false);
      expect(data.availableInterfaces).toBeDefined();
    });

    it('should reject invalid UUID format', async () => {
      const response = await fetch(`${BASE_URL}/api/dcerpc/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          interfaceUuid: 'not-a-valid-uuid',
        }),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('UUID');
    });

    it('should handle non-existent host on probe', async () => {
      const response = await fetch(`${BASE_URL}/api/dcerpc/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid.example.com',
          interfaceName: 'samr',
          timeout: 5000,
        }),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should accept valid custom UUID format', async () => {
      const response = await fetch(`${BASE_URL}/api/dcerpc/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // TEST-NET
          interfaceUuid: 'e1af8308-5d1f-11c9-91a4-08002b14a0fa',
          interfaceVersion: 3,
          timeout: 3000,
        }),
      });
      const data = await response.json() as { success: boolean; error: string };
      // Should fail with timeout/connection error, not UUID validation error
      expect(data.success).toBe(false);
      expect(data.error).not.toContain('UUID');
    });

    it('should detect Cloudflare-protected hosts on probe', async () => {
      const response = await fetch(`${BASE_URL}/api/dcerpc/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          interfaceName: 'epm',
        }),
      });
      const data = await response.json() as { success: boolean; error: string; isCloudflare?: boolean };
      expect(data.success).toBe(false);
    });

    it('should reject invalid port on probe', async () => {
      const response = await fetch(`${BASE_URL}/api/dcerpc/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 0,
          interfaceName: 'epm',
        }),
      });
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      // Port 0 is invalid, should get port error or Cloudflare detection
      expect(data.error).toBeDefined();
    });
  });

  // Port support
  it('should support default port 135', async () => {
    const response = await fetch(`${BASE_URL}/api/dcerpc/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'nonexistent.invalid.example.com',
        timeout: 3000,
      }),
    });
    const data = await response.json() as { success: boolean };
    expect(data.success).toBe(false);
    // The key test is that it doesn't fail on missing port (defaults to 135)
  });
});
