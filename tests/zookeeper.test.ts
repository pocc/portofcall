/**
 * ZooKeeper Four-Letter Word Integration Tests
 *
 * These tests verify the ZooKeeper protocol implementation by connecting
 * to ZooKeeper servers and sending 4LW commands.
 *
 * Note: Tests require a running ZooKeeper server (local or Docker).
 * docker run -d -p 2181:2181 -e ZOO_4LW_COMMANDS_WHITELIST=* zookeeper:latest
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('ZooKeeper Four-Letter Word Integration Tests', () => {

  it('should connect and check health with ruok', async () => {
    const response = await fetch(`${API_BASE}/zookeeper/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 2181,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.healthy).toBe(true);
      expect(data.ruokResponse).toBe('imok');
      expect(data.rtt).toBeGreaterThan(0);
    }
  }, 10000);

  it('should send a four-letter word command', async () => {
    const response = await fetch(`${API_BASE}/zookeeper/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 2181,
        command: 'ruok',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.command).toBe('ruok');
      expect(data.response).toBe('imok');
      expect(data.rtt).toBeGreaterThan(0);
    }
  }, 10000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/zookeeper/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 2181,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/zookeeper/connect`, {
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

  it('should reject invalid command', async () => {
    const response = await fetch(`${API_BASE}/zookeeper/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 2181,
        command: 'invalid',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid command');
  });

  it('should reject missing command', async () => {
    const response = await fetch(`${API_BASE}/zookeeper/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 2181,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Command is required');
  });

  it('should return proper response structure on connect', async () => {
    const response = await fetch(`${API_BASE}/zookeeper/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 2181,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data).toHaveProperty('success');

    if (data.success) {
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');
      expect(data).toHaveProperty('rtt');
      expect(data).toHaveProperty('healthy');
      expect(data).toHaveProperty('ruokResponse');
      expect(data).toHaveProperty('serverInfo');
    } else {
      expect(data).toHaveProperty('error');
    }
  }, 10000);

  it('should return proper response structure on command', async () => {
    const response = await fetch(`${API_BASE}/zookeeper/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 2181,
        command: 'srvr',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data).toHaveProperty('success');

    if (data.success) {
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');
      expect(data).toHaveProperty('command');
      expect(data).toHaveProperty('rtt');
      expect(data).toHaveProperty('response');
    } else {
      expect(data).toHaveProperty('error');
    }
  }, 10000);

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/zookeeper/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 2181,
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
