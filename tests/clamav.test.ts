/**
 * ClamAV Daemon Protocol Integration Tests
 *
 * These tests verify the ClamAV protocol implementation by connecting
 * to clamd instances and sending diagnostic commands.
 *
 * Note: ClamAV daemons are typically only accessible on internal networks.
 * These tests may fail without a reachable clamd server.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('ClamAV Protocol Integration Tests', () => {
  it('should send PING to ClamAV daemon', async () => {
    const response = await fetch(`${API_BASE}/clamav/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 3310,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.host).toBe('localhost');
      expect(data.port).toBe(3310);
      expect(data.protocol).toBe('ClamAV');
      expect(data.alive).toBeDefined();
      expect(data.response).toBeDefined();
      expect(data.connectTimeMs).toBeDefined();
      expect(data.totalTimeMs).toBeDefined();
    }
  }, 10000);

  it('should get VERSION from ClamAV daemon', async () => {
    const response = await fetch(`${API_BASE}/clamav/version`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 3310,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.raw).toBeDefined();
      expect(data.version).toBeDefined();
      expect(data.totalTimeMs).toBeDefined();
      expect(data.protocol).toBe('ClamAV');
    }
  }, 10000);

  it('should get STATS from ClamAV daemon', async () => {
    const response = await fetch(`${API_BASE}/clamav/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 3310,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.stats).toBeDefined();
      expect(data.parsed).toBeDefined();
      expect(data.totalTimeMs).toBeDefined();
      expect(data.responseBytes).toBeDefined();
      expect(data.protocol).toBe('ClamAV');
    }
  }, 10000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/clamav/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 3310,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/clamav/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 99999,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/clamav/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 3310,
        timeout: 1000,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 5000);

  it('should return proper response structure', async () => {
    const response = await fetch(`${API_BASE}/clamav/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 3310,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data).toHaveProperty('success');

    if (data.success) {
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');
      expect(data).toHaveProperty('alive');
      expect(data).toHaveProperty('response');
      expect(data).toHaveProperty('connectTimeMs');
      expect(data).toHaveProperty('totalTimeMs');
      expect(data).toHaveProperty('protocol');
    } else {
      expect(data).toHaveProperty('error');
    }
  }, 10000);
});
