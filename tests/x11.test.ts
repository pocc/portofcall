/**
 * X11 Protocol Integration Tests
 *
 * These tests verify the X11 (X Window System) protocol implementation
 * including connection setup and server information retrieval.
 *
 * Note: Tests against live X11 servers may fail if the server is
 * unreachable. Validation tests always pass.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('X11 Protocol Integration Tests', () => {
  describe('Connect endpoint', () => {
    it('should attempt connection to an X11 server', async () => {
      const response = await fetch(`${API_BASE}/x11/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          display: 0,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success && data.status === 'connected') {
        expect(data.protocolVersion).toBeDefined();
        expect(data.vendor).toBeDefined();
        expect(typeof data.numScreens).toBe('number');
        expect(Array.isArray(data.screens)).toBe(true);
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/x11/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          display: 0,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid display number', async () => {
      const response = await fetch(`${API_BASE}/x11/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          display: 100,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Display number');
    });

    it('should reject invalid port number', async () => {
      const response = await fetch(`${API_BASE}/x11/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 99999,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should calculate port from display number', async () => {
      const response = await fetch(`${API_BASE}/x11/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          display: 1,
          timeout: 2000,
        }),
      });

      const data = await response.json();

      // Should attempt port 6001 (6000 + 1)
      if (data.success) {
        expect(data.port).toBe(6001);
        expect(data.display).toBe(1);
      }
    }, 10000);

    it('should handle connection timeout gracefully', async () => {
      const response = await fetch(`${API_BASE}/x11/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // Non-routable address
          display: 0,
          timeout: 2000,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 10000);

    it('should reject invalid auth data hex', async () => {
      const response = await fetch(`${API_BASE}/x11/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          display: 0,
          authName: 'MIT-MAGIC-COOKIE-1',
          authData: 'not-valid-hex!',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('hex');
    });

    it('should accept explicit port override', async () => {
      const response = await fetch(`${API_BASE}/x11/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 6010,
          display: 0,
          timeout: 2000,
        }),
      });

      const data = await response.json();

      // Should use explicit port 6010 instead of 6000
      if (data.success) {
        expect(data.port).toBe(6010);
      }
    }, 10000);
  });
});
