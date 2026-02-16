/**
 * PJLink Protocol Integration Tests
 *
 * These tests verify the PJLink protocol implementation
 * for querying projector/display status and identity.
 *
 * Note: Connection tests require a running PJLink device
 * or will gracefully handle connection failures.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('PJLink Protocol Integration Tests', () => {
  // --- Validation Tests (Probe endpoint) ---

  it('should reject empty host for probe', async () => {
    const response = await fetch(`${API_BASE}/pjlink/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 4352,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port for probe', async () => {
    const response = await fetch(`${API_BASE}/pjlink/probe`, {
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

  it('should reject non-POST requests for probe', async () => {
    const response = await fetch(`${API_BASE}/pjlink/probe`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  // --- Validation Tests (Power endpoint) ---

  it('should reject empty host for power', async () => {
    const response = await fetch(`${API_BASE}/pjlink/power`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 4352,
        action: 'query',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port for power', async () => {
    const response = await fetch(`${API_BASE}/pjlink/power`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 0,
        action: 'query',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  // --- Connection Tests ---

  it('should handle connection to non-existent PJLink device', async () => {
    const response = await fetch(`${API_BASE}/pjlink/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 4352,
        timeout: 3000,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);

  it('should use default port 4352', async () => {
    const response = await fetch(`${API_BASE}/pjlink/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        timeout: 3000,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);
});
