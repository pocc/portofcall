/**
 * Napster Protocol Integration Tests
 *
 * These tests verify the Napster P2P file sharing protocol implementation.
 * Since public Napster/OpenNap servers are extremely rare, most tests
 * validate input handling and connection attempts.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Napster Protocol Integration Tests', () => {
  describe('Napster Connect Endpoint', () => {
    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/napster/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should use default port 6699', async () => {
      const response = await fetch(`${API_BASE}/napster/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.port).toBe(6699);
    }, 8000);

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/napster/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'napster.example.com',
          port: 99999,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/napster/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6699,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 8000);
  });

  describe('Napster Login Endpoint', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/napster/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'testuser',
          password: 'testpass',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject missing credentials', async () => {
      const response = await fetch(`${API_BASE}/napster/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'napster.example.com',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Username and password are required');
    });

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/napster/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6699,
          username: 'testuser',
          password: 'testpass',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 8000);
  });

  describe('Napster Stats Endpoint', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/napster/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/napster/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6699,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 8000);
  });
});
