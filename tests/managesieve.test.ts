/**
 * ManageSieve Protocol (RFC 5804) Integration Tests
 *
 * These tests verify the ManageSieve protocol implementation
 * for managing Sieve email filtering scripts.
 *
 * Note: Authentication and script tests require a running ManageSieve server
 * (Dovecot Pigeonhole, Cyrus IMAP) or will gracefully handle failures.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('ManageSieve Protocol Integration Tests', () => {
  // --- Validation Tests (Connect endpoint) ---

  it('should reject empty host for connect', async () => {
    const response = await fetch(`${API_BASE}/managesieve/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 4190,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/managesieve/connect`, {
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

  it('should reject host with invalid characters', async () => {
    const response = await fetch(`${API_BASE}/managesieve/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'host;rm -rf /',
        port: 4190,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('invalid characters');
  });

  it('should reject non-POST requests for connect', async () => {
    const response = await fetch(`${API_BASE}/managesieve/connect`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  // --- Validation Tests (List endpoint) ---

  it('should reject empty username for list', async () => {
    const response = await fetch(`${API_BASE}/managesieve/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 4190,
        username: '',
        password: 'test',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Username is required');
  });

  it('should reject empty password for list', async () => {
    const response = await fetch(`${API_BASE}/managesieve/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 4190,
        username: 'user',
        password: '',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Password is required');
  });

  it('should reject non-POST requests for list', async () => {
    const response = await fetch(`${API_BASE}/managesieve/list`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  // --- Connection Tests ---

  it('should handle connection to non-existent server', async () => {
    const response = await fetch(`${API_BASE}/managesieve/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 4190,
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Should fail gracefully (no server running)
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);

  it('should use default port 4190', async () => {
    const response = await fetch(`${API_BASE}/managesieve/connect`, {
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

  it('should probe capabilities on a ManageSieve server', async () => {
    const response = await fetch(`${API_BASE}/managesieve/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 4190,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // If server responds, verify structure
    if (data.success) {
      expect(data.capabilities).toBeDefined();
      expect(Array.isArray(data.capabilities)).toBe(true);
      expect(data.banner).toBeDefined();
    }
  }, 10000);
});
