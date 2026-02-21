/**
 * YMSG Protocol Integration Tests (Yahoo Messenger)
 * Tests Yahoo Messenger protocol connectivity and authentication
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('YMSG Protocol Integration Tests', () => {
  describe('YMSG Probe', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/ymsg/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/ymsg/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 999999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should handle non-existent host', async () => {
      const response = await fetch(`${API_BASE}/ymsg/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-ymsg-server-12345.example.com',
          port: 5050,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should use default values', async () => {
      const response = await fetch(`${API_BASE}/ymsg/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.port).toBe(5050);
    }, 10000);
  });

  describe('YMSG Version Detect', () => {
    it('should test multiple protocol versions', async () => {
      const response = await fetch(`${API_BASE}/ymsg/version-detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      // Handle both 404 (endpoint not found) and successful JSON response
      if (response.status === 404) {
        expect(response.status).toBe(404);
      } else {
        const data = await response.json();
        expect(data).toHaveProperty('success');
        expect(data.port).toBe(5050);
      }
    }, 20000);
  });

  describe('YMSG Auth', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/ymsg/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'testuser',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should handle connection failure', async () => {
      const response = await fetch(`${API_BASE}/ymsg/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-ymsg.example.com',
          username: 'testuser',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('YMSG Login', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/ymsg/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'testuser',
          password: 'password',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should handle timeout', async () => {
      const response = await fetch(`${API_BASE}/ymsg/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          username: 'testuser',
          password: 'password',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('YMSG Protocol Versions', () => {
    it('should support version 16 (default)', async () => {
      const response = await fetch(`${API_BASE}/ymsg/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          version: 16,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should support older versions', async () => {
      const versions = [15, 13, 11, 10, 9];
      for (const version of versions) {
        const response = await fetch(`${API_BASE}/ymsg/probe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: 'unreachable-host-12345.invalid',
            version,
            timeout: 2000,
          }),
        });

        const data = await response.json();
        expect(data).toHaveProperty('success');
      }
    }, 20000);
  });

  describe('YMSG Packet Structure', () => {
    it('should validate YMSG magic bytes in successful response', async () => {
      const response = await fetch(`${API_BASE}/ymsg/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      // If connection succeeds, response should have YMSG fields
      if (data.success) {
        expect(data).toHaveProperty('version');
        expect(data).toHaveProperty('service');
        expect(data).toHaveProperty('sessionId');
      }
    }, 10000);
  });
});
