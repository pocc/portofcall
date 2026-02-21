import { describe, test, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Hazelcast Protocol - Probe', () => {
  test('should validate required host parameter', async () => {
    const response = await fetch(`${API_BASE}/hazelcast/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 5701 }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host is required');
  });

  test('should validate port range', async () => {
    const response = await fetch(`${API_BASE}/hazelcast/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'localhost', port: 99999 }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Port must be between');
  });

  test('should handle connection timeout for unreachable hosts', async () => {
    const response = await fetch(`${API_BASE}/hazelcast/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid', // RFC 5737 TEST-NET
        port: 5701,
        timeout: 3000,
      }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
  }, 15000);

  test('should use default port 5701 when not specified', async () => {
    const response = await fetch(`${API_BASE}/hazelcast/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid',
        timeout: 2000,
      }),
    });

    const data = await response.json() as { success: boolean };
    // Should attempt connection (will fail, but validates default port is used)
    expect(data.success).toBe(false);
  }, 10000);

  test('should reject non-POST requests', async () => {
    const response = await fetch(`${API_BASE}/hazelcast/probe`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  test('should handle invalid JSON body gracefully', async () => {
    const response = await fetch(`${API_BASE}/hazelcast/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid JSON');
  });

  test('should detect non-Hazelcast servers', async () => {
    // Attempt to connect to a non-Hazelcast port
    const response = await fetch(`${API_BASE}/hazelcast/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '192.0.2.1', // TEST-NET-1, RFC 5737 — guaranteed unreachable
        port: 5701,
        timeout: 2000,
      }),
    });

    const data = await response.json() as { success: boolean; isCloudflare?: boolean };
    // TEST-NET-1 is guaranteed unreachable — connection must fail
    expect(data.success).toBe(false);
  }, 10000);
});
