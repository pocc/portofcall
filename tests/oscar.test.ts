/**
 * OSCAR Protocol Integration Tests (AOL Instant Messenger / ICQ)
 * Tests OSCAR/AIM connectivity and authentication
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('OSCAR Protocol Integration Tests', () => {
  describe('OSCAR Probe', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/oscar/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/oscar/probe`, {
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
      const response = await fetch(`${API_BASE}/oscar/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-oscar-server-12345.example.com',
          port: 5190,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('OSCAR Ping', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/oscar/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/oscar/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: -1,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Port must be between 1 and 65535');
    });
  });

  describe('OSCAR Auth', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/oscar/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenName: 'testuser',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/oscar/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should handle connection failure', async () => {
      const response = await fetch(`${API_BASE}/oscar/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-oscar.example.com',
          screenName: 'testuser',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('OSCAR Login', () => {
    it('should fail with missing required fields', async () => {
      const response = await fetch(`${API_BASE}/oscar/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      // Error message includes all required fields
      expect(data.error).toContain('password are required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/oscar/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 70000,
          screenName: 'test',
          password: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Port must be between 1 and 65535');
    });
  });

  describe('OSCAR Buddy List', () => {
    it('should fail with missing required fields', async () => {
      const response = await fetch(`${API_BASE}/oscar/buddy-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      // Error message includes all required fields
      expect(data.error).toContain('password are required');
    });
  });

  describe('OSCAR Send IM', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/oscar/send-im`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenName: 'test',
          password: 'test',
          targetScreenName: 'target',
          message: 'Hello',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host required');
    });

    it('should fail with missing screenName', async () => {
      const response = await fetch(`${API_BASE}/oscar/send-im`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          password: 'test',
          targetScreenName: 'target',
          message: 'Hello',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('screenName required');
    });

    it('should fail with missing password', async () => {
      const response = await fetch(`${API_BASE}/oscar/send-im`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          screenName: 'test',
          targetScreenName: 'target',
          message: 'Hello',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('password required');
    });

    it('should fail with missing targetScreenName', async () => {
      const response = await fetch(`${API_BASE}/oscar/send-im`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          screenName: 'test',
          password: 'test',
          message: 'Hello',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('targetScreenName required');
    });

    it('should fail with missing message', async () => {
      const response = await fetch(`${API_BASE}/oscar/send-im`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          screenName: 'test',
          password: 'test',
          targetScreenName: 'target',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('message required');
    });
  });
});
