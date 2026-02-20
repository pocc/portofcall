/**
 * SIP Protocol Integration Tests
 *
 * These tests verify the SIP protocol implementation by probing
 * SIP servers with OPTIONS and REGISTER requests.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('SIP Protocol Integration Tests', () => {
  it('should reject empty host for OPTIONS', async () => {
    const response = await fetch(`${API_BASE}/sip/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject empty host for REGISTER', async () => {
    const response = await fetch(`${API_BASE}/sip/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port for OPTIONS', async () => {
    const response = await fetch(`${API_BASE}/sip/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'sip.example.com',
        port: 99999,
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject invalid port for REGISTER', async () => {
    const response = await fetch(`${API_BASE}/sip/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'sip.example.com',
        port: 99999,
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject invalid host format', async () => {
    const response = await fetch(`${API_BASE}/sip/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'invalid host with spaces',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid host format');
  });

  it('should reject invalid username format for REGISTER', async () => {
    const response = await fetch(`${API_BASE}/sip/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'sip.example.com',
        username: 'user!@#invalid format',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid username format');
  });

  it('should handle connection failure gracefully', async () => {
    const response = await fetch(`${API_BASE}/sip/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid', // TEST-NET address, should timeout/fail
        port: 5060,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Should fail gracefully, not crash
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should use default port when not specified', async () => {
    // Just validate the request structure - we can't guarantee a SIP server is available
    const response = await fetch(`${API_BASE}/sip/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid', // TEST-NET address
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // The request was accepted (not a validation error)
    // It will fail on connection but that's expected
    expect(response.status).toBe(500); // Connection failure
    expect(data.error).toBeDefined();
  }, 8000);
});
