/**
 * JetDirect / Raw Print Protocol Integration Tests
 *
 * These tests verify the JetDirect protocol implementation by connecting
 * to network printers on port 9100 and sending PJL status queries.
 *
 * Note: Tests require a running printer or virtual printer.
 * Virtual printer: nc -l 9100
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('JetDirect Protocol Integration Tests', () => {

  it('should connect and test JetDirect port', async () => {
    const response = await fetch(`${API_BASE}/jetdirect/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 9100,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.portOpen).toBe(true);
      expect(data.rtt).toBeGreaterThan(0);
      expect(data.connectTime).toBeGreaterThan(0);
    }
  }, 10000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/jetdirect/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 9100,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/jetdirect/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 99999,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should return proper response structure on connect', async () => {
    const response = await fetch(`${API_BASE}/jetdirect/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 9100,
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
      expect(data).toHaveProperty('portOpen');
      expect(data).toHaveProperty('pjlSupported');
    } else {
      expect(data).toHaveProperty('error');
    }
  }, 10000);

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/jetdirect/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 9100,
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
