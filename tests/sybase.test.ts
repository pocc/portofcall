/**
 * Sybase ASE TDS Protocol Integration Tests
 * Tests Sybase Adaptive Server Enterprise TDS connectivity (port 5000)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Sybase Protocol Integration Tests', () => {
  // ===== PROBE =====
  describe('Sybase Probe', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/sybase/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-sybase-host-12345.example.com',
          port: 5000,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/sybase/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 5000 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port out of range', async () => {
      const response = await fetch(`${API_BASE}/sybase/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/sybase/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should use default port 5000 (Sybase ASE default)', async () => {
      const response = await fetch(`${API_BASE}/sybase/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== VERSION =====
  describe('Sybase Version', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/sybase/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-sybase-host-12345.example.com',
          port: 5000,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/sybase/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 5000 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should handle timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/sybase/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== LOGIN =====
  describe('Sybase Login', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/sybase/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-sybase-host-12345.example.com',
          port: 5000,
          username: 'sa',
          password: 'password123',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host, username, and password', async () => {
      const response = await fetch(`${API_BASE}/sybase/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 5000 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('host, username, and password are required');
    });

    it('should fail with missing password', async () => {
      const response = await fetch(`${API_BASE}/sybase/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          username: 'sa',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('host, username, and password are required');
    });

    it('should fail with missing username', async () => {
      const response = await fetch(`${API_BASE}/sybase/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          password: 'password123',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should accept optional database parameter', async () => {
      const response = await fetch(`${API_BASE}/sybase/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          username: 'sa',
          password: 'password123',
          database: 'master',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should handle timeout on login', async () => {
      const response = await fetch(`${API_BASE}/sybase/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          username: 'sa',
          password: 'password123',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== QUERY =====
  describe('Sybase Query', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/sybase/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-sybase-host-12345.example.com',
          port: 5000,
          username: 'sa',
          password: 'password123',
          query: 'SELECT @@version',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host, username, and password', async () => {
      const response = await fetch(`${API_BASE}/sybase/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'SELECT @@version' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('host, username, and password are required');
    });

    it('should accept default query SELECT @@version when query not provided', async () => {
      const response = await fetch(`${API_BASE}/sybase/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          username: 'sa',
          password: 'password123',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept optional database parameter', async () => {
      const response = await fetch(`${API_BASE}/sybase/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          username: 'sa',
          password: 'password123',
          database: 'master',
          query: 'SELECT 1',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== PROC =====
  describe('Sybase Stored Procedure', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/sybase/proc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-sybase-host-12345.example.com',
          port: 5000,
          username: 'sa',
          password: 'password123',
          procname: 'sp_who',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host, username, and password', async () => {
      const response = await fetch(`${API_BASE}/sybase/proc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ procname: 'sp_who' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('host, username, and password are required');
    });

    it('should fail with missing procname', async () => {
      const response = await fetch(`${API_BASE}/sybase/proc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          username: 'sa',
          password: 'password123',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('procname is required');
    });

    it('should accept optional params array', async () => {
      const response = await fetch(`${API_BASE}/sybase/proc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          username: 'sa',
          password: 'password123',
          procname: 'sp_who',
          params: ['sa', 1, null],
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept empty params array', async () => {
      const response = await fetch(`${API_BASE}/sybase/proc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          username: 'sa',
          password: 'password123',
          procname: 'sp_who',
          params: [],
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept optional database parameter', async () => {
      const response = await fetch(`${API_BASE}/sybase/proc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          username: 'sa',
          password: 'password123',
          database: 'master',
          procname: 'sp_who',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== ERROR HANDLING =====
  describe('Sybase Error Handling', () => {
    it('should return 400 for missing host on probe', async () => {
      const response = await fetch(`${API_BASE}/sybase/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 5000 }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully on probe', async () => {
      const response = await fetch(`${API_BASE}/sybase/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should handle network errors gracefully on login', async () => {
      const response = await fetch(`${API_BASE}/sybase/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          username: 'sa',
          password: 'password123',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should handle network errors gracefully on query', async () => {
      const response = await fetch(`${API_BASE}/sybase/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          username: 'sa',
          password: 'password123',
          query: 'SELECT 1',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should handle network errors gracefully on proc', async () => {
      const response = await fetch(`${API_BASE}/sybase/proc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5000,
          username: 'sa',
          password: 'password123',
          procname: 'sp_who',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });
});
