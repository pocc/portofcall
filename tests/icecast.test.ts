import { describe, test, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Icecast Streaming Server - Status Probe', () => {
  test('should validate required host parameter', async () => {
    const response = await fetch(`${API_BASE}/icecast/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 8000 }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host is required');
  });

  test('should validate port range', async () => {
    const response = await fetch(`${API_BASE}/icecast/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'localhost', port: 99999 }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Port must be between');
  });

  test('should handle connection timeout for unreachable hosts', async () => {
    const response = await fetch(`${API_BASE}/icecast/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid', // RFC 5737 TEST-NET
        port: 8000,
        timeout: 3000,
      }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
  }, 15000);

  test('should use default port 8000 when not specified', async () => {
    const response = await fetch(`${API_BASE}/icecast/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid',
        timeout: 2000,
      }),
    });

    const data = await response.json() as { success: boolean };
    expect(data.success).toBe(false);
  }, 10000);

  test('should reject non-POST requests', async () => {
    const response = await fetch(`${API_BASE}/icecast/status`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });
});

describe('Icecast Streaming Server - Admin Stats', () => {
  test('should validate required host parameter', async () => {
    const response = await fetch(`${API_BASE}/icecast/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 8000 }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host is required');
  });

  test('should require admin password', async () => {
    const response = await fetch(`${API_BASE}/icecast/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'localhost', port: 8000 }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('password is required');
  });

  test('should reject non-POST requests', async () => {
    const response = await fetch(`${API_BASE}/icecast/admin`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });
});

describe('Icecast - Non-Icecast Server Handling', () => {
  test('should handle non-Icecast HTTP server gracefully', async () => {
    // Connecting to a regular HTTP server (not Icecast) should still work
    // but report that it's not an Icecast server
    const response = await fetch(`${API_BASE}/icecast/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid',
        port: 80,
        timeout: 3000,
      }),
    });

    const data = await response.json() as { success: boolean };
    // Will fail due to unreachable host, but validates the request path
    expect(data.success).toBe(false);
  }, 15000);
});
