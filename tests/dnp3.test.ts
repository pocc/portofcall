/**
 * DNP3 (Distributed Network Protocol 3) Integration Tests
 * Tests DNP3 over TCP connectivity and class data reading
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('DNP3 Protocol Integration Tests', () => {
  describe('DNP3 Connect (Link Status Probe)', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/dnp3/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-dnp3-outstation-12345.example.com',
          port: 20000,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/dnp3/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 20000,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('host');
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/dnp3/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20000,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should accept custom destination and source addresses', async () => {
      const response = await fetch(`${API_BASE}/dnp3/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20000,
          destination: 10,
          source: 5,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('DNP3 Read (Class Data Integrity Poll)', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/dnp3/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classNum: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('host');
    });

    it('should reject invalid classNum (too high)', async () => {
      const response = await fetch(`${API_BASE}/dnp3/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          classNum: 5,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('classNum');
    });

    it('should reject invalid classNum (negative)', async () => {
      const response = await fetch(`${API_BASE}/dnp3/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          classNum: -1,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('classNum');
    });

    it('should handle Class 0 read to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/dnp3/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20000,
          destination: 1,
          source: 3,
          classNum: 0,
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle Class 1 read to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/dnp3/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20000,
          classNum: 1,
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle Class 2 read to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/dnp3/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20000,
          classNum: 2,
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle Class 3 read to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/dnp3/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20000,
          classNum: 3,
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('DNP3 Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/dnp3/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 20000,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);

    it('should block read from Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/dnp3/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 20000,
          classNum: 0,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  describe('DNP3 Port Support', () => {
    it('should accept default port 20000', async () => {
      const response = await fetch(`${API_BASE}/dnp3/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20000,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept custom ports', async () => {
      const response = await fetch(`${API_BASE}/dnp3/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20001,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('DNP3 Address Validation', () => {
    it('should accept default addresses (dest=1, src=3)', async () => {
      const response = await fetch(`${API_BASE}/dnp3/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20000,
          classNum: 0,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept custom addresses', async () => {
      const response = await fetch(`${API_BASE}/dnp3/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20000,
          destination: 100,
          source: 50,
          classNum: 0,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });
});
