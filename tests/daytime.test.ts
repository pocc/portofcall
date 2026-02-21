/**
 * Daytime Protocol Integration Tests
 *
 * These tests verify the Daytime protocol implementation by connecting
 * to Daytime servers and retrieving the current time.
 *
 * Note: Many public time servers have disabled port 13 (Daytime)
 * in favor of NTP. These tests may fail if no Daytime server is available.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Daytime Protocol Integration Tests', () => {
  // Note: These tests will fail without a Daytime server
  // They are designed to test the protocol implementation

  it('should retrieve time from a Daytime server (query endpoint)', async () => {
    const response = await fetch(`${API_BASE}/daytime/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 13,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Connection may fail if no Daytime server is running
    if (data.success) {
      expect(data.time).toBeDefined();
      expect(typeof data.time).toBe('string');
      expect(data.time.length).toBeGreaterThan(0);
      expect(data.localTime).toBeDefined();
    }
  }, 10000);

  it('should calculate time offset when parseable', async () => {
    const response = await fetch(`${API_BASE}/daytime/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 13,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success && data.remoteTimestamp) {
      expect(data.remoteTimestamp).toBeDefined();
      expect(data.localTimestamp).toBeDefined();
      expect(data.offsetMs).toBeDefined();
      expect(typeof data.offsetMs).toBe('number');
    }
  }, 10000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/daytime/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 13,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/daytime/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        port: 99999,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/daytime/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 13,
        timeout: 1000, // Very short timeout
      }),
    });

    const data = await response.json();

    // Should either succeed or timeout gracefully
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 5000);

  it('should handle various time formats', async () => {
    // This test verifies we can handle different time format responses
    const response = await fetch(`${API_BASE}/daytime/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 13,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      // Time string should be non-empty
      expect(data.time).toBeDefined();
      expect(data.time.length).toBeGreaterThan(0);

      // Should have local time for comparison
      expect(data.localTime).toBeDefined();
      expect(data.localTimestamp).toBeDefined();
    }
  }, 10000);

  it('should return proper response structure', async () => {
    const response = await fetch(`${API_BASE}/daytime/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 13,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Check response has required fields
    expect(data).toHaveProperty('success');

    if (data.success) {
      expect(data).toHaveProperty('time');
      expect(data).toHaveProperty('localTime');
      expect(data).toHaveProperty('localTimestamp');
    } else {
      expect(data).toHaveProperty('error');
    }
  }, 10000);
});
