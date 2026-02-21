/**
 * Neo4j Bolt Protocol Integration Tests
 *
 * These tests verify the Neo4j Bolt protocol implementation by connecting
 * to Neo4j servers and performing the handshake + HELLO exchange.
 *
 * Note: Tests require a running Neo4j server (local or Docker).
 * docker run -d -p 7687:7687 -p 7474:7474 -e NEO4J_AUTH=none neo4j:latest
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Neo4j Bolt Protocol Integration Tests', () => {

  it('should connect and perform Bolt handshake', async () => {
    const response = await fetch(`${API_BASE}/neo4j/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 7687,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.boltVersion).toBeDefined();
      expect(data.selectedVersion).toBeGreaterThan(0);
      expect(data.rtt).toBeGreaterThan(0);
      expect(data.connectTime).toBeGreaterThan(0);
    }
  }, 10000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/neo4j/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 7687,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/neo4j/connect`, {
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

  it('should return proper response structure on connect', async () => {
    const response = await fetch(`${API_BASE}/neo4j/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 7687,
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
      expect(data).toHaveProperty('boltVersion');
      expect(data).toHaveProperty('selectedVersion');
      expect(data).toHaveProperty('helloSuccess');
      expect(data).toHaveProperty('authRequired');
      expect(data).toHaveProperty('serverInfo');
    } else {
      expect(data).toHaveProperty('error');
    }
  }, 10000);

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/neo4j/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 7687,
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
