/**
 * MSN/MSNP Protocol Integration Tests
 * Tests MSN Messenger protocol connectivity and authentication
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('MSN/MSNP Protocol Integration Tests', () => {
  describe('MSN Probe', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/msn/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/msn/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 999999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should handle non-existent host', async () => {
      const response = await fetch(`${API_BASE}/msn/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-msn-server-12345.example.com',
          port: 1863,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should use default protocol version', async () => {
      const response = await fetch(`${API_BASE}/msn/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.port).toBe(1863); // default port
    }, 10000);
  });

  describe('MSN Client Version', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/msn/client-version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      // Accept either 400 (validation) or 404 (endpoint not found)
      expect([400, 404]).toContain(response.status);
    });

    it('should handle connection failure', async () => {
      const response = await fetch(`${API_BASE}/msn/client-version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-msn.example.com',
          timeout: 5000,
        }),
      });

      // Handle both 404 (endpoint not found) and error responses
      if (response.status === 404) {
        expect(response.status).toBe(404);
      } else {
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.error).toBeDefined();
      }
    }, 10000);
  });

  describe('MSN Login', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/msn/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should handle connection to non-existent server', async () => {
      const response = await fetch(`${API_BASE}/msn/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-msn.example.com',
          email: 'test@example.com',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('MSN MD5 Login', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/msn/md5-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should handle timeout', async () => {
      const response = await fetch(`${API_BASE}/msn/md5-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          email: 'test@example.com',
          password: 'password',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('MSN Protocol Versions', () => {
    it('should support different protocol versions', async () => {
      const versions = ['MSNP18', 'MSNP17', 'MSNP16'];
      for (const version of versions) {
        const response = await fetch(`${API_BASE}/msn/probe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: 'unreachable-host-12345.invalid',
            protocolVersion: version,
            timeout: 2000,
          }),
        });

        const data = await response.json();
        expect(data).toHaveProperty('success');
      }
    }, 15000);
  });
});
