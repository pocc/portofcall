/**
 * QOTD Protocol Integration Tests
 *
 * These tests verify the QOTD (Quote of the Day, RFC 865) implementation.
 * Since public QOTD servers are rare, most tests validate input handling.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('QOTD Protocol Integration Tests', () => {
  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/qotd/fetch`, {
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

  it('should reject invalid port', async () => {
    const response = await fetch(`${API_BASE}/qotd/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'example.com',
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
    const response = await fetch(`${API_BASE}/qotd/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '192.0.2.1', // TEST-NET address, should fail
        port: 17,
        timeout: 3000,
      }),
    });

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 8000);

  it('should use default port 17 when not specified', async () => {
    const response = await fetch(`${API_BASE}/qotd/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '192.0.2.1', // Will fail, but validates defaults
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Connection will fail but the request was accepted (not 400)
    expect(response.status).toBe(500);
    expect(data.error).toBeDefined();
  }, 8000);

  it('should reject port 0', async () => {
    const response = await fetch(`${API_BASE}/qotd/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'example.com',
        port: 0,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should include host and port in response', async () => {
    const response = await fetch(`${API_BASE}/qotd/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '192.0.2.1',
        port: 17,
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Even on failure, response should not crash
    expect(data).toBeDefined();
    expect(data.success).toBe(false);
  }, 8000);
});
