/**
 * Active Users Protocol Integration Tests (RFC 866)
 * Tests Active Users queries and response parsing
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Active Users Protocol Integration Tests', () => {
  describe('Active Users Test Endpoint', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/activeusers/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-activeusers-host-12345.example.com',
          port: 11,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/activeusers/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 11,
          // Missing host
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port numbers', async () => {
      const response = await fetch(`${API_BASE}/activeusers/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/activeusers/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 11,
          timeout: 3000,
        }),
      });

      // Should timeout or fail quickly
      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('Active Users Query Endpoint', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/activeusers/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-activeusers.example.com',
          port: 11,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/activeusers/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 11,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port numbers', async () => {
      const response = await fetch(`${API_BASE}/activeusers/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Port must be between 1 and 65535');
    });
  });

  describe('Active Users Raw Endpoint', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/activeusers/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-activeusers.example.com',
          port: 11,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/activeusers/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 11,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port numbers', async () => {
      const response = await fetch(`${API_BASE}/activeusers/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 70000,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Port must be between 1 and 65535');
    });
  });

  describe('Active Users Error Handling', () => {
    it('should handle network timeouts gracefully', async () => {
      const response = await fetch(`${API_BASE}/activeusers/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 11,
          timeout: 3000,
        }),
      });

      // Should return error response
      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);

    it('should accept default port 11', async () => {
      const response = await fetch(`${API_BASE}/activeusers/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
          // Port defaults to 11
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('Active Users Response Structure', () => {
    it('should return proper structure on test endpoint', async () => {
      const response = await fetch(`${API_BASE}/activeusers/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 11,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('response');
      expect(data).toHaveProperty('rtt');
      if (!data.success) {
        expect(data).toHaveProperty('error');
      }
    }, 10000);

    it('should return proper structure on query endpoint', async () => {
      const response = await fetch(`${API_BASE}/activeusers/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 11,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('users');
      expect(data).toHaveProperty('rawCount');
      expect(data).toHaveProperty('latencyMs');
    }, 10000);

    it('should return proper structure on raw endpoint', async () => {
      const response = await fetch(`${API_BASE}/activeusers/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 11,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('raw');
      expect(data).toHaveProperty('latencyMs');
    }, 10000);
  });
});
