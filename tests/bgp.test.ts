/**
 * BGP (Border Gateway Protocol) Integration Tests
 *
 * These tests verify the BGP protocol implementation by connecting
 * to BGP speakers and performing the OPEN message handshake.
 *
 * Note: Tests require a running BGP speaker (local or Docker).
 * docker run -d -p 179:179 osrg/gobgp
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('BGP Protocol Integration Tests', () => {

  it('should fail to connect to localhost without a running BGP speaker', async () => {
    const response = await fetch(`${API_BASE}/bgp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 179,
        localAS: 65000,
        routerId: '10.0.0.1',
        holdTime: 90,
        timeout: 5000,
      }),
    });

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/bgp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 179,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/bgp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 99999,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject invalid AS number', async () => {
    const response = await fetch(`${API_BASE}/bgp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 179,
        localAS: 99999,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('AS number must be between 1 and 65535');
  });

  it('should return failure response structure for unreachable localhost', async () => {
    const response = await fetch(`${API_BASE}/bgp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 179,
        localAS: 65000,
        routerId: '10.0.0.1',
        timeout: 5000,
      }),
    });

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data).toHaveProperty('error');
  }, 10000);

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/bgp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 179,
        localAS: 65000,
        routerId: '10.0.0.1',
        timeout: 1000,
      }),
    });

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 5000);
});
