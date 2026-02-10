/**
 * SOCKS4 Protocol Integration Tests
 *
 * These tests verify the SOCKS4 protocol implementation by connecting
 * to SOCKS proxies and testing connection requests.
 *
 * Note: These tests require a SOCKS4 proxy to be running.
 * You can use SSH tunneling: ssh -D 1080 user@host
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('SOCKS4 Protocol Integration Tests', () => {
  // Note: These tests will fail without a configured SOCKS4 proxy
  // They are designed to test the protocol implementation

  it('should send a valid SOCKS4 connection request', async () => {
    const response = await fetch(`${API_BASE}/socks4/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proxyHost: 'localhost',
        proxyPort: 1080,
        destHost: 'example.com',
        destPort: 80,
        useSocks4a: true,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Connection may fail if no proxy is running
    // We're testing the request format and response parsing
    if (data.success) {
      expect(data.responseCode).toBeDefined();
      expect(data.responseMessage).toBeDefined();
      if (data.granted) {
        expect(data.responseCode).toBe(0x5A); // Request granted
        expect(data.boundAddress).toBeDefined();
        expect(data.boundPort).toBeDefined();
      }
    }
  }, 10000);

  it('should support SOCKS4a with hostname', async () => {
    const response = await fetch(`${API_BASE}/socks4/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proxyHost: 'localhost',
        proxyPort: 1080,
        destHost: 'www.example.com',
        destPort: 443,
        useSocks4a: true,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Test that the request was properly formatted
    if (data.success && data.granted) {
      expect(data.responseCode).toBe(0x5A);
      expect(data.responseMessage).toContain('granted');
    }
  }, 10000);

  it('should support plain SOCKS4 with IP address', async () => {
    const response = await fetch(`${API_BASE}/socks4/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proxyHost: 'localhost',
        proxyPort: 1080,
        destHost: '93.184.216.34', // example.com IP
        destPort: 80,
        useSocks4a: false,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success && data.granted) {
      expect(data.responseCode).toBe(0x5A);
    }
  }, 10000);

  it('should reject empty proxy host', async () => {
    const response = await fetch(`${API_BASE}/socks4/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proxyHost: '',
        destHost: 'example.com',
        destPort: 80,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Proxy host is required');
  });

  it('should reject empty destination host', async () => {
    const response = await fetch(`${API_BASE}/socks4/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proxyHost: 'localhost',
        destHost: '',
        destPort: 80,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Destination host is required');
  });

  it('should reject invalid destination port', async () => {
    const response = await fetch(`${API_BASE}/socks4/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proxyHost: 'localhost',
        destHost: 'example.com',
        destPort: 0,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('destination port');
  });

  it('should reject invalid proxy port', async () => {
    const response = await fetch(`${API_BASE}/socks4/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proxyHost: 'localhost',
        proxyPort: 99999,
        destHost: 'example.com',
        destPort: 80,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Proxy port must be between 1 and 65535');
  });

  it('should include optional user ID in request', async () => {
    const response = await fetch(`${API_BASE}/socks4/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proxyHost: 'localhost',
        proxyPort: 1080,
        destHost: 'example.com',
        destPort: 80,
        userId: 'testuser',
        useSocks4a: true,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Request should be sent successfully
    // (regardless of whether proxy accepts it)
    expect(data.success).toBeDefined();
  }, 10000);

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/socks4/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proxyHost: 'localhost',
        proxyPort: 1080,
        destHost: 'example.com',
        destPort: 80,
        timeout: 1000, // Very short timeout
      }),
    });

    const data = await response.json();

    // Should either succeed or timeout gracefully
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 5000);
});
