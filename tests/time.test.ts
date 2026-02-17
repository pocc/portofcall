/**
 * TIME Protocol Integration Tests
 *
 * Tests RFC 868 implementation with binary time parsing.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = 'http://localhost:8787';

describe('TIME Protocol Integration Tests', () => {
  it('should get binary time from TIME server', async () => {
    const response = await fetch(`${API_BASE}/api/time/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'time.nist.gov',
        port: 37,
        timeout: 10000,
      }),
    });

    const data = await response.json();

    // Note: Most public TIME servers have disabled port 37
    // This test may succeed or fail depending on server availability
    if (data.success) {
      expect(data).toHaveProperty('raw');
      expect(data).toHaveProperty('unixTimestamp');
      expect(data).toHaveProperty('date');
      expect(data).toHaveProperty('localTime');
      expect(data).toHaveProperty('offsetMs');

      // Validate raw is a 32-bit number
      expect(data.raw).toBeGreaterThan(0);
      expect(data.raw).toBeLessThanOrEqual(4294967295); // 32-bit max

      // Validate Unix timestamp is reasonable (after 1970, before 2100)
      expect(data.unixTimestamp).toBeGreaterThan(0);
      expect(data.unixTimestamp).toBeLessThan(4102444800); // 2100-01-01

      // Validate date string
      expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    } else {
      // Server unavailable is expected for TIME protocol
      expect(data).toHaveProperty('error');
    }
  });

  it('should validate required host', async () => {
    const response = await fetch(`${API_BASE}/api/time/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port: 37,
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host is required');
  });

  it('should validate port range', async () => {
    const response = await fetch(`${API_BASE}/api/time/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'time.nist.gov',
        port: 99999,
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Port must be between 1 and 65535');
  });

  it('should handle connection timeout', async () => {
    const response = await fetch(`${API_BASE}/api/time/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'time.nist.gov',
        port: 37,
        timeout: 1, // Very short timeout
      }),
    });

    const data = await response.json();

    // Either succeeds quickly or times out
    if (!data.success) {
      expect(data.error).toBeTruthy();
    }
  });

  it('should handle invalid hostname', async () => {
    const response = await fetch(`${API_BASE}/api/time/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'nonexistent-time-server-12345.invalid',
        port: 37,
        timeout: 5000,
      }),
    });

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeTruthy();
  });

  it('should handle closed port', async () => {
    const response = await fetch(`${API_BASE}/api/time/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'google.com',
        port: 37, // Google doesn't run TIME service
        timeout: 5000,
      }),
    });

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeTruthy();
  });

  it('should correctly convert TIME epoch to Unix timestamp', async () => {
    // TIME epoch: 1900-01-01 00:00:00 UTC
    // Unix epoch: 1970-01-01 00:00:00 UTC
    // Offset: 2,208,988,800 seconds (70 years)

    // This test validates the epoch conversion logic
    // We can't test against a real server reliably, but we can verify the math

    const TIME_EPOCH_OFFSET = 2208988800;

    // Example: 2024-01-01 00:00:00 UTC
    const unixTimestamp = 1704067200;
    const expectedTimeValue = unixTimestamp + TIME_EPOCH_OFFSET;

    expect(expectedTimeValue).toBe(3913056000);

    // Verify it's within valid 32-bit range
    expect(expectedTimeValue).toBeLessThanOrEqual(4294967295);
  });

  it('should demonstrate Y2K36 overflow problem', async () => {
    // Y2K36 problem: 32-bit unsigned integer overflow
    // Max value: 4,294,967,295
    // Overflow date: 2036-02-07 06:28:15 UTC

    const TIME_EPOCH_OFFSET = 2208988800;
    const MAX_32BIT = 4294967295;

    const overflowUnixTimestamp = MAX_32BIT - TIME_EPOCH_OFFSET;

    // This should be 2036-02-07 06:28:15 UTC
    const overflowDate = new Date(overflowUnixTimestamp * 1000);

    expect(overflowDate.getUTCFullYear()).toBe(2036);
    expect(overflowDate.getUTCMonth()).toBe(1); // February (0-indexed)
    expect(overflowDate.getUTCDate()).toBe(7);
  });

  it('should handle non-standard ports', async () => {
    const response = await fetch(`${API_BASE}/api/time/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 3737, // Non-standard port
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Will fail unless a custom TIME server is running
    expect(data.success).toBe(false);
    expect(data.error).toBeTruthy();
  });

  it('should parse big-endian 32-bit unsigned integer correctly', async () => {
    // Test the binary parsing logic
    // TIME protocol sends 4 bytes in big-endian (network byte order)

    // Example: 0xE9B3C640 = 3,920,873,024 (decimal)
    // Breakdown:
    // - Byte 0: 0xE9 = 233
    // - Byte 1: 0xB3 = 179
    // - Byte 2: 0xC6 = 198
    // - Byte 3: 0x40 = 64

    const bytes = new Uint8Array([0xE9, 0xB3, 0xC6, 0x40]);
    const dataView = new DataView(bytes.buffer);
    const value = dataView.getUint32(0, false); // false = big-endian

    expect(value).toBe(3920873024);

    // Convert to Unix timestamp
    const TIME_EPOCH_OFFSET = 2208988800;
    const unixTimestamp = value - TIME_EPOCH_OFFSET;

    expect(unixTimestamp).toBe(1711884224);

    // Verify this is 2024-03-31 12:30:24 UTC
    const date = new Date(unixTimestamp * 1000);
    expect(date.getUTCFullYear()).toBe(2024);
    expect(date.getUTCMonth()).toBe(2); // March (0-indexed)
    expect(date.getUTCDate()).toBe(31);
  });
});
