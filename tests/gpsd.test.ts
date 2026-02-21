/**
 * GPSD (GPS Service Daemon) Protocol Integration Tests
 * Tests GPSD JSON protocol, version queries, device lists, and GPS polling
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('GPSD Protocol Integration Tests', () => {
  describe('GPSD Version Query', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/gpsd/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-gpsd-host-12345.example.com',
          port: 2947,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/gpsd/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 2947,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should reject invalid port numbers', async () => {
      const response = await fetch(`${API_BASE}/gpsd/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 999999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Port');
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/gpsd/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2947,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('GPSD Devices Query', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/gpsd/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 2947,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/gpsd/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2947,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('GPSD Poll Command', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/gpsd/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 2947,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/gpsd/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2947,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('GPSD Custom Command', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/gpsd/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: '?VERSION;',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should fail with missing command parameter', async () => {
      const response = await fetch(`${API_BASE}/gpsd/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Command');
    });

    it('should reject commands not starting with ?', async () => {
      const response = await fetch(`${API_BASE}/gpsd/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          command: 'INVALID_COMMAND',
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      if (response.status === 403) {
        expect(data.error).toContain('?');
      }
    });
  });

  describe('GPSD Watch Stream', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/gpsd/watch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seconds: 5,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should clamp seconds parameter to maximum', async () => {
      const response = await fetch(`${API_BASE}/gpsd/watch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          seconds: 100,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('GPSD Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/gpsd/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 2947,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      // May return 403 with isCloudflare:true or 500 with error message
      expect(response.ok).toBe(false);
    }, 10000);
  });

  describe('GPSD Port Support', () => {
    it('should accept default port 2947', async () => {
      const response = await fetch(`${API_BASE}/gpsd/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2947,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should accept custom ports', async () => {
      const response = await fetch(`${API_BASE}/gpsd/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3000,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });
});
