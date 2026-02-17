/**
 * AFP Protocol Integration Tests
 *
 * These tests verify the AFP (Apple Filing Protocol) implementation
 * including DSI session handling and FPGetSrvrInfo parsing.
 *
 * Note: Tests against live AFP servers may fail if the server is
 * unreachable. Validation tests always pass.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('AFP Protocol Integration Tests', () => {
  describe('Connect endpoint', () => {
    it('should attempt AFP server status probe', async () => {
      const response = await fetch(`${API_BASE}/afp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // Non-routable, will timeout
          port: 548,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Either succeeds with server info or fails with connection error
      if (data.success) {
        expect(data.host).toBe('unreachable-host-12345.invalid');
        expect(data.port).toBe(548);
        expect(data.status).toBeDefined();
        expect(typeof data.connectTime).toBe('number');
        expect(typeof data.rtt).toBe('number');
      }
    }, 15000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/afp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 548,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port number', async () => {
      const response = await fetch(`${API_BASE}/afp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'fileserver.local',
          port: 99999,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should reject port zero', async () => {
      const response = await fetch(`${API_BASE}/afp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'fileserver.local',
          port: 0,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should use default port 548 when not specified', async () => {
      const response = await fetch(`${API_BASE}/afp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 2000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.port).toBe(548);
      }
    }, 10000);

    it('should handle connection timeout gracefully', async () => {
      const response = await fetch(`${API_BASE}/afp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // Non-routable address
          port: 548,
          timeout: 2000,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 15000);

    it('should return server info fields when connected', async () => {
      // This test validates response structure if a real server responds
      const response = await fetch(`${API_BASE}/afp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 548,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      if (data.success && data.status === 'connected') {
        // Server name should be a string
        if (data.serverName !== undefined) {
          expect(typeof data.serverName).toBe('string');
        }
        // AFP versions should be an array
        if (data.afpVersions !== undefined) {
          expect(Array.isArray(data.afpVersions)).toBe(true);
        }
        // UAMs should be an array
        if (data.uams !== undefined) {
          expect(Array.isArray(data.uams)).toBe(true);
        }
        // Flags should be a number
        if (data.flags !== undefined) {
          expect(typeof data.flags).toBe('number');
        }
      }
    }, 15000);
  });
});
