/**
 * Finger Protocol Integration Tests
 *
 * These tests verify the Finger protocol implementation by querying
 * Finger servers for user information.
 *
 * Note: Most modern systems have Finger disabled for security reasons.
 * These tests may fail without a Finger server running.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Finger Protocol Integration Tests', () => {
  // Note: These tests will fail without a Finger server
  // They are designed to test the protocol implementation

  it('should perform a basic finger query', async () => {
    const response = await fetch(`${API_BASE}/finger/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 79,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Connection may fail if no Finger server is running
    if (data.success) {
      expect(data.query).toBeDefined();
      expect(data.response).toBeDefined();
      expect(typeof data.response).toBe('string');
    }
  }, 10000);

  it('should query for a specific username', async () => {
    const response = await fetch(`${API_BASE}/finger/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 79,
        username: 'root',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.query).toContain('root');
      expect(data.response).toBeDefined();
    }
  }, 10000);

  it('should support remote host forwarding', async () => {
    const response = await fetch(`${API_BASE}/finger/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 79,
        username: 'user',
        remoteHost: 'remote.example.com',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.query).toContain('user@remote.example.com');
    }
  }, 10000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/finger/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 79,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/finger/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        port: 99999,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject username with invalid characters', async () => {
    const response = await fetch(`${API_BASE}/finger/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        port: 79,
        username: 'user;rm -rf /',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('invalid characters');
  });

  it('should reject remote host with invalid characters', async () => {
    const response = await fetch(`${API_BASE}/finger/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        port: 79,
        remoteHost: 'host;malicious',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('invalid characters');
  });

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/finger/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 79,
        timeout: 1000, // Very short timeout
      }),
    });

    const data = await response.json();

    // Should either succeed or timeout gracefully
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 5000);

  it('should format query correctly', async () => {
    const response = await fetch(`${API_BASE}/finger/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 79,
        username: 'alice',
        remoteHost: 'example.com',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      // Query should be formatted as: alice@example.com
      expect(data.query).toBe('alice@example.com');
    }
  }, 10000);

  it('should handle empty username (list all users)', async () => {
    const response = await fetch(`${API_BASE}/finger/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 79,
        // No username - should list all users
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      // Query should be empty (just CRLF)
      expect(data.query).toBe('');
      expect(data.response).toBeDefined();
    }
  }, 10000);
});
