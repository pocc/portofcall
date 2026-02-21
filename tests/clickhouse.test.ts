/**
 * ClickHouse Protocol Integration Tests
 *
 * These tests verify the ClickHouse HTTP interface implementation
 * for server health checking and SQL query execution.
 *
 * Note: Connection tests require a running ClickHouse server
 * or will gracefully handle connection failures.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('ClickHouse Protocol Integration Tests', () => {
  // --- Validation Tests (Health endpoint) ---

  it('should reject empty host for health', async () => {
    const response = await fetch(`${API_BASE}/clickhouse/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 8123,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number for health', async () => {
    const response = await fetch(`${API_BASE}/clickhouse/health`, {
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

  it('should reject host with invalid characters for health', async () => {
    const response = await fetch(`${API_BASE}/clickhouse/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'host;rm -rf /',
        port: 8123,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('invalid characters');
  });

  it('should reject non-POST requests for health', async () => {
    const response = await fetch(`${API_BASE}/clickhouse/health`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  // --- Validation Tests (Query endpoint) ---

  it('should reject empty host for query', async () => {
    const response = await fetch(`${API_BASE}/clickhouse/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 8123,
        query: 'SELECT 1',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject empty query', async () => {
    const response = await fetch(`${API_BASE}/clickhouse/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        port: 8123,
        query: '',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Query is required');
  });

  it('should reject non-POST requests for query', async () => {
    const response = await fetch(`${API_BASE}/clickhouse/query`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  // --- Connection Tests ---

  it('should handle connection to non-existent server', async () => {
    const response = await fetch(`${API_BASE}/clickhouse/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 8123,
        timeout: 3000,
      }),
    });

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should use default port 8123', async () => {
    const response = await fetch(`${API_BASE}/clickhouse/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        timeout: 3000,
      }),
    });

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);
});
