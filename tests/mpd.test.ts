/**
 * MPD Protocol Integration Tests
 *
 * These tests verify the MPD protocol implementation by testing
 * validation, error handling, and command safety restrictions.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('MPD Protocol Integration Tests', () => {
  it('should reject empty host for status', async () => {
    const response = await fetch(`${API_BASE}/mpd/status`, {
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

  it('should reject empty host for command', async () => {
    const response = await fetch(`${API_BASE}/mpd/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        command: 'status',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject empty command', async () => {
    const response = await fetch(`${API_BASE}/mpd/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'mpd.example.com',
        command: '',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Command is required');
  });

  it('should reject invalid port for status', async () => {
    const response = await fetch(`${API_BASE}/mpd/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'mpd.example.com',
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
    const response = await fetch(`${API_BASE}/mpd/status`, {
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

  it('should reject unsafe commands', async () => {
    const response = await fetch(`${API_BASE}/mpd/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'mpd.example.com',
        command: 'play',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('not allowed');
  });

  it('should reject commands with newlines', async () => {
    const response = await fetch(`${API_BASE}/mpd/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'mpd.example.com',
        command: 'status\nplay',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Command must not contain newlines');
  });

  it('should handle connection failure gracefully', async () => {
    const response = await fetch(`${API_BASE}/mpd/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '192.0.2.1', // TEST-NET address, should timeout/fail
        port: 6600,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);
});
