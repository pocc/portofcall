/**
 * Rsync Daemon Protocol Integration Tests
 *
 * These tests verify the rsync daemon protocol implementation by connecting
 * to rsync servers and exchanging protocol versions / listing modules.
 *
 * Note: Tests require a running rsync daemon (local or Docker).
 * docker run -d -p 873:873 axiom/rsync-server
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Rsync Daemon Protocol Integration Tests', () => {

  it('should connect and exchange protocol versions', async () => {
    const response = await fetch(`${API_BASE}/rsync/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 873,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.serverVersion).toBeDefined();
      expect(data.clientVersion).toBe('30.0');
      expect(data.greeting).toContain('@RSYNCD:');
      expect(data.rtt).toBeGreaterThan(0);
      expect(data.connectTime).toBeGreaterThan(0);
      expect(data.modules).toBeDefined();
      expect(Array.isArray(data.modules)).toBe(true);
    }
  }, 10000);

  it('should check a specific module', async () => {
    const response = await fetch(`${API_BASE}/rsync/module`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 873,
        module: 'data',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.module).toBe('data');
      expect(data.serverVersion).toBeDefined();
      expect(data.rtt).toBeGreaterThan(0);
      // moduleOk or authRequired should be set
      expect(typeof data.moduleOk).toBe('boolean');
      expect(typeof data.authRequired).toBe('boolean');
    }
  }, 10000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/rsync/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 873,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/rsync/connect`, {
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

  it('should reject missing module name for module check', async () => {
    const response = await fetch(`${API_BASE}/rsync/module`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        port: 873,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Module name is required');
  });

  it('should return proper response structure on connect', async () => {
    const response = await fetch(`${API_BASE}/rsync/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 873,
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
      expect(data).toHaveProperty('serverVersion');
      expect(data).toHaveProperty('clientVersion');
      expect(data).toHaveProperty('greeting');
      expect(data).toHaveProperty('modules');
      expect(data).toHaveProperty('moduleCount');
    } else {
      expect(data).toHaveProperty('error');
    }
  }, 10000);

  it('should return proper response structure on module check', async () => {
    const response = await fetch(`${API_BASE}/rsync/module`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 873,
        module: 'test',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data).toHaveProperty('success');

    if (data.success) {
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');
      expect(data).toHaveProperty('module');
      expect(data).toHaveProperty('rtt');
      expect(data).toHaveProperty('serverVersion');
      expect(data).toHaveProperty('moduleOk');
      expect(data).toHaveProperty('authRequired');
    } else {
      expect(data).toHaveProperty('error');
    }
  }, 10000);

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/rsync/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 873,
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
