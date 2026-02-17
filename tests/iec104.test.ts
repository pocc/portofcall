/**
 * IEC 60870-5-104 Protocol Integration Tests
 * Tests IEC 104 telecontrol protocol connectivity probing
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('IEC 60870-5-104 Protocol Integration Tests', () => {
  describe('Probe Validation', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/iec104/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 2404,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should fail with invalid port', async () => {
      const response = await fetch(`${API_BASE}/iec104/probe`, {
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
      expect(data.error).toContain('Port');
    });

    it('should fail with port 0', async () => {
      const response = await fetch(`${API_BASE}/iec104/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  describe('Connection Tests', () => {
    it('should use default port 2404', async () => {
      const response = await fetch(`${API_BASE}/iec104/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/iec104/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2404,
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should handle non-existent hostname', async () => {
      const response = await fetch(`${API_BASE}/iec104/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-scada-12345.example.com',
          port: 2404,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should return proper response structure', async () => {
      const response = await fetch(`${API_BASE}/iec104/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2404,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('error');
    }, 10000);

    it('should accept custom port', async () => {
      const response = await fetch(`${API_BASE}/iec104/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2405,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/iec104/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 2404,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });
});
