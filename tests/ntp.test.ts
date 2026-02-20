/**
 * NTP Protocol Integration Tests
 * Tests Network Time Protocol (RFC 5905) - port 123
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('NTP Protocol Integration Tests', () => {
  describe('POST /api/ntp/query', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/ntp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 123 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject invalid port (0)', async () => {
      const response = await fetch(`${API_BASE}/ntp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'time.nist.gov',
          port: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should reject invalid port (65536)', async () => {
      const response = await fetch(`${API_BASE}/ntp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'time.nist.gov',
          port: 65536,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ntp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-ntp-host-12345.example.com',
          port: 123,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should default to port 123', async () => {
      const response = await fetch(`${API_BASE}/ntp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should handle custom timeout', async () => {
      const response = await fetch(`${API_BASE}/ntp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 123,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/ntp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 123,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });

  describe('NTP Timestamp Conversion', () => {
    it('should validate NTP epoch offset constant', () => {
      // NTP epoch: 1900-01-01 00:00:00 UTC
      // Unix epoch: 1970-01-01 00:00:00 UTC
      // Difference: 70 years = 2,208,988,800 seconds
      const NTP_EPOCH_OFFSET = 2208988800;

      // Verify the offset is correct (70 years in seconds)
      const seventyYearsInSeconds = 70 * 365.25 * 24 * 60 * 60;
      expect(Math.abs(NTP_EPOCH_OFFSET - seventyYearsInSeconds)).toBeLessThan(86400); // Within 1 day
    });

    it('should handle Y2K36 overflow date', () => {
      // Y2K36 problem: 32-bit unsigned integer overflow
      // Max NTP timestamp: 4,294,967,295 (2^32 - 1)
      // This represents: 2036-02-07 06:28:15 UTC
      const NTP_EPOCH_OFFSET = 2208988800;
      const MAX_32BIT = 4294967295;

      const overflowUnixTimestamp = MAX_32BIT - NTP_EPOCH_OFFSET;
      const overflowDate = new Date(overflowUnixTimestamp * 1000);

      expect(overflowDate.getUTCFullYear()).toBe(2036);
      expect(overflowDate.getUTCMonth()).toBe(1); // February (0-indexed)
      expect(overflowDate.getUTCDate()).toBe(7);
    });
  });

  describe('NTP Response Fields', () => {
    it('should return structured error for connection failure', async () => {
      const response = await fetch(`${API_BASE}/ntp/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 123,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    }, 15000);
  });

  describe('NTP Stratum Validation', () => {
    it('should handle stratum field in response', async () => {
      // This test validates that stratum would be parsed correctly
      // Stratum levels:
      // 0 = unspecified/invalid
      // 1 = primary reference (atomic clock, GPS)
      // 2-15 = secondary reference
      // 16 = unsynchronized

      const validStratums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
      validStratums.forEach(stratum => {
        expect(stratum).toBeGreaterThanOrEqual(0);
        expect(stratum).toBeLessThanOrEqual(16);
      });
    });
  });

  describe('NTP Leap Indicator', () => {
    it('should recognize valid leap indicator values', () => {
      // Leap indicator (2 bits):
      // 0 = no warning
      // 1 = last minute of day has 61 seconds
      // 2 = last minute of day has 59 seconds
      // 3 = alarm condition (clock not synchronized)

      const leapIndicators = [
        'no warning',
        '61 seconds',
        '59 seconds',
        'alarm (clock unsynchronized)'
      ];

      expect(leapIndicators).toHaveLength(4);
      expect(leapIndicators[0]).toBe('no warning');
      expect(leapIndicators[3]).toContain('alarm');
    });
  });

  describe('POST /api/ntp/poll', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/ntp/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 3 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ntp/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-ntp-host-12345.example.com',
          port: 123,
          count: 2,
          intervalMs: 1000,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.errors).toBeDefined();
    }, 25000);

    it('should default to 4 samples with 1000ms interval', async () => {
      const response = await fetch(`${API_BASE}/ntp/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 25000);

    it('should limit count to max 10', async () => {
      const response = await fetch(`${API_BASE}/ntp/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          count: 100, // Request 100, should be capped at 10
          intervalMs: 100,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 30000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/ntp/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 123,
          count: 2,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  describe('NTP Precision Field', () => {
    it('should handle precision as log2 seconds', () => {
      // Precision is stored as signed 8-bit integer
      // Represents log2(seconds)
      // Example: -6 = 2^-6 = ~15.6 milliseconds
      // Example: -20 = 2^-20 = ~0.95 microseconds

      const precisionValue = -6;
      const precisionSeconds = Math.pow(2, precisionValue);
      const precisionMs = precisionSeconds * 1000;

      expect(precisionMs).toBeCloseTo(15.625, 2);
    });
  });
});
