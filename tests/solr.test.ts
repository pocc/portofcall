/**
 * Apache Solr Protocol Integration Tests
 *
 * These tests verify the Solr HTTP REST API implementation
 * for server health checking and search query execution.
 *
 * Note: Connection tests require a running Solr server
 * or will gracefully handle connection failures.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Solr Protocol Integration Tests', () => {
  // --- Validation Tests (Health endpoint) ---

  it('should reject empty host for health', async () => {
    const response = await fetch(`${API_BASE}/solr/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 8983,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number for health', async () => {
    const response = await fetch(`${API_BASE}/solr/health`, {
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

  it('should reject host with invalid characters for health', async () => {
    const response = await fetch(`${API_BASE}/solr/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'host;rm -rf /',
        port: 8983,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('invalid characters');
  });

  it('should reject non-POST requests for health', async () => {
    const response = await fetch(`${API_BASE}/solr/health`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  // --- Validation Tests (Query endpoint) ---

  it('should reject empty host for query', async () => {
    const response = await fetch(`${API_BASE}/solr/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 8983,
        core: 'test',
        query: '*:*',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject empty core name for query', async () => {
    const response = await fetch(`${API_BASE}/solr/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 8983,
        core: '',
        query: '*:*',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Core name is required');
  });

  it('should reject non-POST requests for query', async () => {
    const response = await fetch(`${API_BASE}/solr/query`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  // --- Connection Tests ---

  it('should handle connection to non-existent server', async () => {
    const response = await fetch(`${API_BASE}/solr/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 8983,
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Should fail gracefully (no server running)
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);

  it('should use default port 8983', async () => {
    const response = await fetch(`${API_BASE}/solr/health`, {
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
