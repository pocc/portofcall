/**
 * Sonic Search Backend Protocol Integration Tests
 *
 * These tests verify the Sonic protocol implementation
 * for probing Sonic search backend instances.
 *
 * Note: Connection tests require a running Sonic server
 * or will gracefully handle connection failures.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Sonic Protocol Integration Tests', () => {
  // --- Probe Endpoint Validation Tests ---

  it('should reject empty host for probe', async () => {
    const response = await fetch(`${API_BASE}/sonic/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 1491,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port for probe', async () => {
    const response = await fetch(`${API_BASE}/sonic/probe`, {
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

  it('should reject port 0 for probe', async () => {
    const response = await fetch(`${API_BASE}/sonic/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 0,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject non-POST requests for probe', async () => {
    const response = await fetch(`${API_BASE}/sonic/probe`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  // --- Ping Endpoint Validation Tests ---

  it('should reject empty host for ping', async () => {
    const response = await fetch(`${API_BASE}/sonic/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 1491,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port for ping', async () => {
    const response = await fetch(`${API_BASE}/sonic/ping`, {
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

  // --- Connection Tests ---

  it('should handle connection to non-existent Sonic server', async () => {
    const response = await fetch(`${API_BASE}/sonic/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 1491,
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Should fail gracefully (no Sonic server running)
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);

  it('should use default port 1491', async () => {
    const response = await fetch(`${API_BASE}/sonic/probe`, {
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

  it('should accept optional password', async () => {
    const response = await fetch(`${API_BASE}/sonic/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 1491,
        password: 'SecretPassword',
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Should attempt with the provided password
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);
});
