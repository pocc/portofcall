/**
 * Redis Sentinel Integration Tests
 *
 * These tests verify the Redis Sentinel protocol implementation
 * by testing validation, error handling, and input safety.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Redis Sentinel Integration Tests', () => {
  // Probe endpoint tests
  it('should reject empty host for probe', async () => {
    const response = await fetch(`${API_BASE}/sentinel/probe`, {
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

  it('should reject invalid port for probe', async () => {
    const response = await fetch(`${API_BASE}/sentinel/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'sentinel.example.com',
        port: 99999,
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject invalid host format for probe', async () => {
    const response = await fetch(`${API_BASE}/sentinel/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'sentinel.example.com; cat /etc/passwd',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid host format');
  });

  // Query endpoint tests
  it('should reject empty host for query', async () => {
    const response = await fetch(`${API_BASE}/sentinel/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        command: 'PING',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject empty command for query', async () => {
    const response = await fetch(`${API_BASE}/sentinel/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'sentinel.example.com',
        command: '',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Command is required');
  });

  it('should reject unsafe commands', async () => {
    const response = await fetch(`${API_BASE}/sentinel/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'sentinel.example.com',
        command: 'SENTINEL FAILOVER',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('not allowed');
  });

  it('should reject CONFIG SET command', async () => {
    const response = await fetch(`${API_BASE}/sentinel/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'sentinel.example.com',
        command: 'CONFIG SET',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('not allowed');
  });

  it('should handle connection failure gracefully for probe', async () => {
    const response = await fetch(`${API_BASE}/sentinel/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid', // TEST-NET address
        port: 26379,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should handle connection failure gracefully for query', async () => {
    const response = await fetch(`${API_BASE}/sentinel/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid',
        port: 26379,
        command: 'PING',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);
});
