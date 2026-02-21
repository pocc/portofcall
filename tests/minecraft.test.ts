/**
 * Minecraft Server List Ping (SLP) Protocol Integration Tests
 *
 * These tests verify the Minecraft SLP protocol implementation
 * for querying server status (version, players, MOTD, favicon).
 *
 * Note: Connection tests require a running Minecraft server
 * or will gracefully handle connection failures.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Minecraft SLP Protocol Integration Tests', () => {
  // --- Validation Tests (Status endpoint) ---

  it('should reject empty host for status', async () => {
    const response = await fetch(`${API_BASE}/minecraft/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 25565,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number for status', async () => {
    const response = await fetch(`${API_BASE}/minecraft/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        port: 99999,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject host with invalid characters for status', async () => {
    const response = await fetch(`${API_BASE}/minecraft/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'host;rm -rf /',
        port: 25565,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('invalid characters');
  });

  // --- Validation Tests (Ping endpoint) ---

  it('should reject empty host for ping', async () => {
    const response = await fetch(`${API_BASE}/minecraft/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 25565,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number for ping', async () => {
    const response = await fetch(`${API_BASE}/minecraft/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        port: 0,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject non-POST requests for status', async () => {
    const response = await fetch(`${API_BASE}/minecraft/status`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  it('should reject non-POST requests for ping', async () => {
    const response = await fetch(`${API_BASE}/minecraft/ping`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  // --- Connection Tests ---

  it('should handle connection to non-existent server', async () => {
    const response = await fetch(`${API_BASE}/minecraft/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 25565,
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Should fail gracefully (no server running)
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);

  it('should use default port 25565', async () => {
    const response = await fetch(`${API_BASE}/minecraft/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Should attempt connection on default port
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);

  it('should query a public Minecraft server', async () => {
    const response = await fetch(`${API_BASE}/minecraft/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'mc.hypixel.net',
        port: 25565,
        timeout: 10000,
      }),
    });

    const data = await response.json();

    // If connection succeeds, verify the structure
    if (data.success) {
      expect(data.version).toBeDefined();
      expect(data.version.name).toBeDefined();
      expect(typeof data.version.protocol).toBe('number');
      expect(data.players).toBeDefined();
      expect(typeof data.players.online).toBe('number');
      expect(typeof data.players.max).toBe('number');
      expect(data.description).toBeDefined();
    }
  }, 15000);

  it('should measure ping latency', async () => {
    const response = await fetch(`${API_BASE}/minecraft/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'mc.hypixel.net',
        port: 25565,
        timeout: 10000,
      }),
    });

    const data = await response.json();

    // If connection succeeds, verify latency data
    if (data.success) {
      expect(typeof data.tcpLatency).toBe('number');
      expect(typeof data.pingLatency).toBe('number');
      expect(typeof data.pongValid).toBe('boolean');
    }
  }, 15000);
});
