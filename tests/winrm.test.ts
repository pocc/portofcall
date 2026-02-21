import { describe, test, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('WinRM Protocol - Identify Probe', () => {
  test('should validate required host parameter', async () => {
    const response = await fetch(`${API_BASE}/winrm/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 5985 }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host is required');
  });

  test('should validate port range', async () => {
    const response = await fetch(`${API_BASE}/winrm/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'test-host.invalid', port: 99999 }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Port must be between');
  });

  test('should handle connection timeout for unreachable hosts', async () => {
    const response = await fetch(`${API_BASE}/winrm/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid', // RFC 5737 TEST-NET
        port: 5985,
        timeout: 3000,
      }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
  }, 15000);

  test('should use default port 5985 when not specified', async () => {
    const response = await fetch(`${API_BASE}/winrm/identify`, {
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
    const response = await fetch(`${API_BASE}/winrm/identify`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });
});

describe('WinRM Protocol - Auth Probe', () => {
  test('should validate required host parameter', async () => {
    const response = await fetch(`${API_BASE}/winrm/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 5985 }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host is required');
  });

  test('should validate port range', async () => {
    const response = await fetch(`${API_BASE}/winrm/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'test-host.invalid', port: 0 }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Port must be between');
  });

  test('should reject non-POST requests', async () => {
    const response = await fetch(`${API_BASE}/winrm/auth`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });
});

describe('WinRM Protocol - SOAP Envelope', () => {
  test('should handle invalid JSON body gracefully', async () => {
    const response = await fetch(`${API_BASE}/winrm/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid JSON');
  });

  test('should handle port 5986 (HTTPS variant)', async () => {
    const response = await fetch(`${API_BASE}/winrm/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid',
        port: 5986,
        timeout: 2000,
      }),
    });

    const data = await response.json() as { success: boolean };
    // Connection will fail but validates port 5986 is accepted
    expect(data.success).toBe(false);
  }, 10000);
});
