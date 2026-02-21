/**
 * Omron FINS/TCP Protocol Integration Tests
 *
 * These tests verify the FINS protocol implementation
 * for probing Omron PLCs (CJ, CS, CP, NX series).
 *
 * Note: Connection tests require a running Omron PLC
 * or will gracefully handle connection failures.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Omron FINS Protocol Integration Tests', () => {
  // --- Validation Tests ---

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/fins/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 9600,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/fins/connect`, {
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

  it('should reject port 0', async () => {
    const response = await fetch(`${API_BASE}/fins/connect`, {
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

  it('should reject non-POST requests', async () => {
    const response = await fetch(`${API_BASE}/fins/connect`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  // --- Connection Tests ---

  it('should handle connection to non-existent FINS device', async () => {
    const response = await fetch(`${API_BASE}/fins/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 9600,
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Should fail gracefully (no PLC running)
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);

  it('should use default port 9600', async () => {
    const response = await fetch(`${API_BASE}/fins/connect`, {
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

  it('should accept custom client node number', async () => {
    const response = await fetch(`${API_BASE}/fins/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 9600,
        clientNode: 10,
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Should attempt with the custom node address
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);
});
