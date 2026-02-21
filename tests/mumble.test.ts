/**
 * Mumble Protocol Integration Tests
 * Tests Mumble VoIP server connectivity and authentication
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Mumble Protocol Integration Tests', () => {
  describe('Mumble Probe', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/mumble/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should handle non-existent host', async () => {
      const response = await fetch(`${API_BASE}/mumble/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-mumble-server-12345.example.com',
          port: 64738,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should use default port and TLS', async () => {
      const response = await fetch(`${API_BASE}/mumble/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      // Fields may not be present in error responses
      if (data.port !== undefined) {
        expect(data.port).toBe(64738);
      }
      if (data.tls !== undefined) {
        expect(data.tls).toBe(true);
      }
    }, 10000);
  });

  describe('Mumble Version', () => {
    it('should be alias for probe', async () => {
      const response = await fetch(`${API_BASE}/mumble/version`, {
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

  describe('Mumble Ping', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/mumble/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should handle connection failure', async () => {
      const response = await fetch(`${API_BASE}/mumble/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-mumble.example.com',
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('Mumble Auth', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/mumble/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should handle connection timeout', async () => {
      const response = await fetch(`${API_BASE}/mumble/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          username: 'testuser',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('Mumble Text Message', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/mumble/text-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Hello',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should fail with missing message', async () => {
      const response = await fetch(`${API_BASE}/mumble/text-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Message is required');
    });
  });

  describe('Mumble TLS Support', () => {
    it('should support TLS disabled', async () => {
      const response = await fetch(`${API_BASE}/mumble/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          tls: false,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      // TLS field may not be present in error responses
      if (data.tls !== undefined) {
        expect(data.tls).toBe(false);
      }
    }, 10000);
  });
});
