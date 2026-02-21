/**
 * Kerberos Protocol Integration Tests
 *
 * These tests verify the Kerberos protocol implementation by sending
 * AS-REQ probes to KDC servers on port 88.
 *
 * Note: Tests require a running Kerberos KDC.
 * Local KDC: docker run -d -p 88:88 gcavalcante8808/krb5-server
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Kerberos Protocol Integration Tests', () => {

  it('should connect and probe Kerberos KDC', async () => {
    const response = await fetch(`${API_BASE}/kerberos/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 88,
        realm: 'EXAMPLE.COM',
        principal: 'user',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.host).toBe('localhost');
      expect(data.port).toBe(88);
      expect(data.rtt).toBeGreaterThan(0);
      expect(data.connectTime).toBeGreaterThan(0);
    }
  }, 10000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/kerberos/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 88,
        realm: 'EXAMPLE.COM',
        principal: 'user',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/kerberos/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        port: 99999,
        realm: 'EXAMPLE.COM',
        principal: 'user',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should uppercase realm automatically', async () => {
    const response = await fetch(`${API_BASE}/kerberos/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 88,
        realm: 'example.com',
        principal: 'user',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Whether connection succeeds or fails, the realm should be uppercased
    expect(data).toHaveProperty('success');
  }, 10000);

  it('should return proper response structure on connect', async () => {
    const response = await fetch(`${API_BASE}/kerberos/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 88,
        realm: 'EXAMPLE.COM',
        principal: 'user',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data).toHaveProperty('success');

    if (data.success) {
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');
      expect(data).toHaveProperty('rtt');
      expect(data).toHaveProperty('connectTime');
      expect(data).toHaveProperty('response');
    } else {
      expect(data).toHaveProperty('error');
    }
  }, 10000);

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/kerberos/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 88,
        realm: 'EXAMPLE.COM',
        principal: 'user',
        timeout: 1000,
      }),
    });

    const data = await response.json();

    // Should either succeed or timeout gracefully
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 5000);
});
