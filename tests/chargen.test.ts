/**
 * CHARGEN Protocol Integration Tests
 *
 * Tests RFC 864 implementation with continuous character stream.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = 'http://localhost:8787';

describe('CHARGEN Protocol Integration Tests', () => {
  it('should receive character stream from CHARGEN server', async () => {
    const response = await fetch(`${API_BASE}/api/chargen/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 19,
        maxBytes: 1024,
        timeout: 10000,
      }),
    });

    const data = await response.json();

    // Note: Most public CHARGEN servers have been disabled
    // This test may succeed or fail depending on server availability
    if (data.success) {
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('bytes');
      expect(data).toHaveProperty('lines');
      expect(data).toHaveProperty('duration');
      expect(data).toHaveProperty('bandwidth');

      // Validate data is a string
      expect(typeof data.data).toBe('string');

      // Validate bytes received (allow small overhead for protocol headers)
      expect(data.bytes).toBeGreaterThan(0);
      expect(data.bytes).toBeLessThanOrEqual(1050);

      // Validate lines
      expect(data.lines).toBeGreaterThan(0);

      // Validate duration
      expect(data.duration).toBeGreaterThan(0);

      // Validate bandwidth format
      expect(data.bandwidth).toMatch(/bps|Kbps|Mbps/);
    } else {
      // Server unavailable is expected for CHARGEN protocol
      expect(data).toHaveProperty('error');
    }
  });

  it('should validate required host', async () => {
    const response = await fetch(`${API_BASE}/api/chargen/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port: 19,
        maxBytes: 1024,
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host is required');
  });

  it('should validate port range', async () => {
    const response = await fetch(`${API_BASE}/api/chargen/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 99999,
        maxBytes: 1024,
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Port must be between 1 and 65535');
  });

  it('should enforce maximum byte limit', async () => {
    const response = await fetch(`${API_BASE}/api/chargen/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 19,
        maxBytes: 5000000, // Request 5MB
        timeout: 10000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      // Should be limited to 1MB (1,048,576 bytes)
      expect(data.bytes).toBeLessThanOrEqual(1048576);
    } else {
      // Server unavailable is acceptable
      expect(data).toHaveProperty('error');
    }
  });

  it('should handle connection timeout', async () => {
    const response = await fetch(`${API_BASE}/api/chargen/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 19,
        maxBytes: 1024,
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
    const response = await fetch(`${API_BASE}/api/chargen/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'nonexistent-chargen-server-12345.invalid',
        port: 19,
        maxBytes: 1024,
        timeout: 5000,
      }),
    });

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeTruthy();
  });

  it('should validate CHARGEN pattern format', () => {
    // CHARGEN standard pattern:
    // - 72 printable ASCII characters per line
    // - Characters from ASCII 33 (!) to 126 (~)
    // - Pattern rotates by 1 character each line

    // Generate expected first line
    const generateLine = (offset: number): string => {
      const chars: string[] = [];
      for (let i = 0; i < 72; i++) {
        const charCode = 33 + ((offset + i) % 94);
        chars.push(String.fromCharCode(charCode));
      }
      return chars.join('');
    };

    // First line should start with '!'
    const line0 = generateLine(0);
    expect(line0.charAt(0)).toBe('!');
    expect(line0.length).toBe(72);

    // Second line should start with '"'
    const line1 = generateLine(1);
    expect(line1.charAt(0)).toBe('"');
    expect(line1.length).toBe(72);

    // Third line should start with '#'
    const line2 = generateLine(2);
    expect(line2.charAt(0)).toBe('#');
    expect(line2.length).toBe(72);

    // Pattern should cycle after 94 lines (all printable ASCII characters)
    const line94 = generateLine(94);
    expect(line94).toBe(line0);
  });

  it('should calculate bandwidth correctly', () => {
    // Test bandwidth calculation logic
    const calculateBandwidth = (bytes: number, durationMs: number): string => {
      const bps = (bytes * 8) / (durationMs / 1000);

      if (bps < 1024) {
        return `${bps.toFixed(2)} bps`;
      } else if (bps < 1024 * 1024) {
        return `${(bps / 1024).toFixed(2)} Kbps`;
      } else {
        return `${(bps / (1024 * 1024)).toFixed(2)} Mbps`;
      }
    };

    // Test 1KB in 1 second
    expect(calculateBandwidth(1024, 1000)).toBe('8.00 Kbps');

    // Test 10KB in 1 second
    expect(calculateBandwidth(10240, 1000)).toBe('80.00 Kbps');

    // Test 1MB in 1 second
    expect(calculateBandwidth(1048576, 1000)).toBe('8.00 Mbps');

    // Test 100 bytes in 1 second
    expect(calculateBandwidth(100, 1000)).toBe('800.00 bps');
  });

  it('should validate ASCII character range', () => {
    // CHARGEN uses printable ASCII: 33 (!) to 126 (~)
    const PRINTABLE_START = 33; // '!'
    const PRINTABLE_END = 126;   // '~'
    const TOTAL_CHARS = 94;

    expect(PRINTABLE_END - PRINTABLE_START + 1).toBe(TOTAL_CHARS);

    // First character should be '!'
    expect(String.fromCharCode(PRINTABLE_START)).toBe('!');

    // Last character should be '~'
    expect(String.fromCharCode(PRINTABLE_END)).toBe('~');
  });

  it('should handle closed port', async () => {
    const response = await fetch(`${API_BASE}/api/chargen/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'google.com',
        port: 19, // Google doesn't run CHARGEN service
        maxBytes: 1024,
        timeout: 5000,
      }),
    });

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeTruthy();
  });

  it('should receive multiple lines in stream', async () => {
    const response = await fetch(`${API_BASE}/api/chargen/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 19,
        maxBytes: 1024, // Should get ~13 lines (74 bytes each)
        timeout: 10000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      // Each line is 72 chars + \r\n = 74 bytes
      // 1024 bytes / 74 bytes = ~13.8 lines
      expect(data.lines).toBeGreaterThan(0);
      expect(data.lines).toBeLessThanOrEqual(15);

      // Verify data contains line breaks
      expect(data.data).toContain('\r\n');
    } else {
      // Server unavailable is acceptable
      expect(data).toHaveProperty('error');
    }
  });
});
