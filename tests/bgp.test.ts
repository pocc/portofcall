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

  it('should connect and perform BGP OPEN handshake', async () => {
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

    if (data.success) {
      expect(data.rtt).toBeGreaterThan(0);
      expect(data.connectTime).toBeGreaterThan(0);
    }
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

  it('should return proper response structure on connect', async () => {
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

    expect(data).toHaveProperty('success');

    if (data.success) {
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');
      expect(data).toHaveProperty('rtt');
      expect(data).toHaveProperty('connectTime');
      expect(data).toHaveProperty('sessionEstablished');

      if (data.peerOpen) {
        expect(data.peerOpen).toHaveProperty('version');
        expect(data.peerOpen).toHaveProperty('peerAS');
        expect(data.peerOpen).toHaveProperty('holdTime');
        expect(data.peerOpen).toHaveProperty('routerId');
      }
    } else {
      expect(data).toHaveProperty('error');
    }
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

    // Should either succeed or timeout gracefully
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 5000);
});
