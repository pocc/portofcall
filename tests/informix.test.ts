/**
 * Informix SQLI Protocol Integration Tests
 * Tests Informix Dynamic Server connectivity via SQLI wire protocol (port 9088)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Informix Protocol Integration Tests', () => {
  // ===== PROBE =====
  describe('Informix Probe', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/informix/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-informix-host-12345.example.com',
          port: 9088,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/informix/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 9088 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port out of range', async () => {
      const response = await fetch(`${API_BASE}/informix/probe`, {
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
      const response = await fetch(`${API_BASE}/informix/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9088,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should use default port 9088 for Informix', async () => {
      const response = await fetch(`${API_BASE}/informix/probe`, {
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

    it('should accept port 9088 (Informix default)', async () => {
      const response = await fetch(`${API_BASE}/informix/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9088,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== VERSION =====
  describe('Informix Version', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/informix/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-informix-host-12345.example.com',
          port: 9088,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/informix/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 9088 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should handle timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/informix/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9088,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== QUERY =====
  describe('Informix Query', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/informix/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-informix-host-12345.example.com',
          port: 9088,
          username: 'informix',
          password: 'in4mix',
          database: 'sysmaster',
          query: 'SELECT tabname FROM systables WHERE tabid < 10',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/informix/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'informix',
          password: 'test',
          database: 'sysmaster',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should fail with missing username and password', async () => {
      const response = await fetch(`${API_BASE}/informix/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9088,
          database: 'sysmaster',
          query: 'SELECT 1',
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle timeout on query', async () => {
      const response = await fetch(`${API_BASE}/informix/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9088,
          username: 'informix',
          password: 'in4mix',
          database: 'sysmaster',
          query: 'SELECT 1',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept database parameter', async () => {
      const response = await fetch(`${API_BASE}/informix/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9088,
          username: 'informix',
          password: 'in4mix',
          database: 'sysmaster',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== ERROR HANDLING =====
  describe('Informix Error Handling', () => {
    it('should return 400 for missing host on probe', async () => {
      const response = await fetch(`${API_BASE}/informix/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 9088 }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully on probe', async () => {
      const response = await fetch(`${API_BASE}/informix/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9088,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should handle network errors gracefully on version', async () => {
      const response = await fetch(`${API_BASE}/informix/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9088,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should handle network errors gracefully on query', async () => {
      const response = await fetch(`${API_BASE}/informix/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9088,
          username: 'informix',
          password: 'test',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });
});
