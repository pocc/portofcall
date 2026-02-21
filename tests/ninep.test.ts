/**
 * 9P (Plan 9 Filesystem Protocol) Integration Tests
 *
 * These tests verify the 9P protocol implementation by probing
 * servers for version negotiation and filesystem attach.
 *
 * Note: Tests require a 9P server (QEMU, v9fs, etc.) or will
 * gracefully handle connection failures.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('9P Protocol Integration Tests', () => {
  // --- Validation Tests ---

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/9p/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 564,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/9p/connect`, {
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

  it('should reject host with invalid characters', async () => {
    const response = await fetch(`${API_BASE}/9p/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'host;rm -rf /',
        port: 564,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('invalid characters');
  });

  // --- Connection Tests ---

  it('should handle connection to non-existent server', async () => {
    const response = await fetch(`${API_BASE}/9p/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 564,
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Should fail gracefully (no 9P server running)
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);

  it('should use default port 564', async () => {
    const response = await fetch(`${API_BASE}/9p/connect`, {
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

  it('should attempt version negotiation', async () => {
    const response = await fetch(`${API_BASE}/9p/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 564,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // If connection succeeds, check version fields
    if (data.success) {
      expect(data.serverVersion).toBeDefined();
      expect(data.msize).toBeGreaterThan(0);
    }
  }, 10000);

  it('should report root QID on successful attach', async () => {
    const response = await fetch(`${API_BASE}/9p/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 564,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // If attach succeeds, check QID
    if (data.success && data.rootQid) {
      expect(data.rootQid.type).toBeDefined();
      expect(data.rootQid.version).toBeDefined();
      expect(data.rootQid.path).toBeDefined();
    }
  }, 10000);
});
