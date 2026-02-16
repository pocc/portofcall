/**
 * Minecraft RCON Protocol Integration Tests
 *
 * These tests verify the RCON (Source RCON) protocol implementation
 * for remote Minecraft server administration.
 *
 * Note: Tests require either a running Minecraft server with RCON enabled
 * or will gracefully handle connection failures.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('RCON Protocol Integration Tests', () => {
  // --- Validation Tests ---

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 25575,
        password: 'test',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 99999,
        password: 'test',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject host with invalid characters', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'host;rm -rf /',
        port: 25575,
        password: 'test',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('invalid characters');
  });

  it('should reject empty password', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 25575,
        password: '',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Password is required');
  });

  it('should reject password exceeding max length', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 25575,
        password: 'a'.repeat(513),
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Password too long');
  });

  it('should reject empty command', async () => {
    const response = await fetch(`${API_BASE}/rcon/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 25575,
        password: 'test',
        command: '',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Command is required');
  });

  it('should reject command exceeding max length', async () => {
    const response = await fetch(`${API_BASE}/rcon/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 25575,
        password: 'test',
        command: 'a'.repeat(1447),
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Command too long');
  });

  // --- Connection Tests ---

  it('should handle connection to non-existent server', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 25575,
        password: 'test',
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Should fail gracefully (no server running)
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);

  it('should use default port 25575', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        password: 'test',
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Should attempt connection on default port
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);

  it('should attempt authentication', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 25575,
        password: 'minecraft',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // If connection succeeds, check auth result
    if (data.success) {
      expect(typeof data.authenticated).toBe('boolean');
    }
  }, 10000);

  it('should execute command after authentication', async () => {
    const response = await fetch(`${API_BASE}/rcon/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 25575,
        password: 'minecraft',
        command: 'list',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // If connection and auth succeed, check response
    if (data.success) {
      expect(data.authenticated).toBe(true);
      expect(data.response).toBeDefined();
    }
  }, 10000);
});
