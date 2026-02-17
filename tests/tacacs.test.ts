import { describe, it, expect } from 'vitest';

const API_BASE = 'http://localhost:8787';

describe('TACACS+ Protocol (Port 49)', () => {
  describe('Probe - Input Validation', () => {
    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/tacacs/probe`, {
        method: 'GET',
      });
      expect(response.status).toBe(405);
    });

    it('should require host', async () => {
      const response = await fetch(`${API_BASE}/api/tacacs/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject invalid ports', async () => {
      const response = await fetch(`${API_BASE}/api/tacacs/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 99999,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });
  });

  describe('Authenticate - Input Validation', () => {
    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/tacacs/authenticate`, {
        method: 'GET',
      });
      expect(response.status).toBe(405);
    });

    it('should require host', async () => {
      const response = await fetch(`${API_BASE}/api/tacacs/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'test' }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should require username', async () => {
      const response = await fetch(`${API_BASE}/api/tacacs/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com' }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Username');
    });
  });

  describe('Connection Tests', () => {
    it('should handle unreachable hosts gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/tacacs/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 49,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should detect Cloudflare-protected hosts', async () => {
      const response = await fetch(`${API_BASE}/api/tacacs/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 49,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle wrong port (non-TACACS+ service)', async () => {
      const response = await fetch(`${API_BASE}/api/tacacs/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'google.com',
          port: 80,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      // Should either fail or get invalid response
      if (data.success) {
        // If it connects, the response won't be valid TACACS+
        expect(data.serverVersion).toBeDefined();
      } else {
        expect(data.error).toBeDefined();
      }
    }, 10000);
  });

  describe('Response Structure', () => {
    it('should return proper error format for probe failures', async () => {
      const response = await fetch(`${API_BASE}/api/tacacs/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 49,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    }, 8000);

    it('should return proper error format for auth failures', async () => {
      const response = await fetch(`${API_BASE}/api/tacacs/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 49,
          username: 'admin',
          password: 'test',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error');
    }, 8000);
  });
});
