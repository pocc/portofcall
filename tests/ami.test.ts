/**
 * AMI (Asterisk Manager Interface) Integration Tests
 *
 * These tests verify the AMI protocol implementation
 * by testing validation, error handling, and input safety.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('AMI Integration Tests', () => {
  // Probe endpoint tests
  it('should reject empty host for probe', async () => {
    const response = await fetch(`${API_BASE}/ami/probe`, {
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
    const response = await fetch(`${API_BASE}/ami/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'pbx.example.com',
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
    const response = await fetch(`${API_BASE}/ami/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'pbx.example.com; rm -rf /',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid host format');
  });

  // Command endpoint tests
  it('should reject empty host for command', async () => {
    const response = await fetch(`${API_BASE}/ami/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        username: 'admin',
        secret: 'password',
        action: 'Ping',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject empty username for command', async () => {
    const response = await fetch(`${API_BASE}/ami/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'pbx.example.com',
        username: '',
        secret: 'password',
        action: 'Ping',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Username is required');
  });

  it('should reject empty secret for command', async () => {
    const response = await fetch(`${API_BASE}/ami/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'pbx.example.com',
        username: 'admin',
        secret: '',
        action: 'Ping',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Secret is required');
  });

  it('should reject empty action for command', async () => {
    const response = await fetch(`${API_BASE}/ami/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'pbx.example.com',
        username: 'admin',
        secret: 'password',
        action: '',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Action is required');
  });

  it('should reject unsafe actions', async () => {
    const response = await fetch(`${API_BASE}/ami/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'pbx.example.com',
        username: 'admin',
        secret: 'password',
        action: 'Originate',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('not allowed');
  });

  it('should handle connection failure gracefully for probe', async () => {
    const response = await fetch(`${API_BASE}/ami/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid', // TEST-NET address, should timeout/fail
        port: 5038,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should handle connection failure gracefully for command', async () => {
    const response = await fetch(`${API_BASE}/ami/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid',
        port: 5038,
        username: 'admin',
        secret: 'password',
        action: 'Ping',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);
});
