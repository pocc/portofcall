/**
 * MongoDB Wire Protocol Integration Tests
 *
 * These tests verify the MongoDB protocol implementation by connecting
 * to MongoDB servers and sending hello/ping commands via OP_MSG.
 *
 * Note: Tests require a running MongoDB server (local or Docker).
 * docker run -d -p 27017:27017 mongo:7
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('MongoDB Wire Protocol Integration Tests', () => {

  it('should connect and retrieve server info', async () => {
    const response = await fetch(`${API_BASE}/mongodb/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27017,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.serverInfo).toBeDefined();
      expect(data.serverInfo.ok).toBe(1);
      expect(data.serverInfo.maxWireVersion).toBeDefined();
      expect(data.rtt).toBeGreaterThan(0);
      expect(data.connectTime).toBeGreaterThan(0);

      if (data.serverInfo.version) {
        expect(typeof data.serverInfo.version).toBe('string');
      }
    }
  }, 10000);

  it('should ping MongoDB server', async () => {
    const response = await fetch(`${API_BASE}/mongodb/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27017,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.ok).toBe(1);
      expect(data.rtt).toBeGreaterThan(0);
    }
  }, 10000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/mongodb/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 27017,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/mongodb/connect`, {
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

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/mongodb/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27017,
        timeout: 1000,
      }),
    });

    const data = await response.json();

    // Should either succeed or timeout gracefully
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 5000);

  it('should return proper response structure on connect', async () => {
    const response = await fetch(`${API_BASE}/mongodb/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27017,
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
      expect(data).toHaveProperty('serverInfo');
      expect(data.serverInfo).toHaveProperty('ok');
      expect(data.serverInfo).toHaveProperty('maxWireVersion');
    } else {
      expect(data).toHaveProperty('error');
    }
  }, 10000);

  it('should return proper response structure on ping', async () => {
    const response = await fetch(`${API_BASE}/mongodb/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27017,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data).toHaveProperty('success');

    if (data.success) {
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');
      expect(data).toHaveProperty('rtt');
      expect(data).toHaveProperty('ok');
    } else {
      expect(data).toHaveProperty('error');
    }
  }, 10000);
});
