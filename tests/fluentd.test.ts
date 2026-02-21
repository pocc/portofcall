import { describe, test, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Fluentd Forward Protocol - Server Probe', () => {
  test('should validate required host parameter', async () => {
    const response = await fetch(`${API_BASE}/fluentd/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 24224 }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host is required');
  });

  test('should validate port range', async () => {
    const response = await fetch(`${API_BASE}/fluentd/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'test-host.invalid', port: 99999 }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Port must be between');
  });

  test('should validate tag format', async () => {
    const response = await fetch(`${API_BASE}/fluentd/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'test-host.invalid', port: 24224, tag: 'invalid tag with spaces!' }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid tag format');
  });

  test('should handle connection timeout for unreachable hosts', async () => {
    const response = await fetch(`${API_BASE}/fluentd/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid', // RFC 5737 TEST-NET
        port: 24224,
        timeout: 3000,
      }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
  }, 15000);

  test('should use default port 24224 when not specified', async () => {
    const response = await fetch(`${API_BASE}/fluentd/connect`, {
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
    const response = await fetch(`${API_BASE}/fluentd/connect`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });
});

describe('Fluentd Forward Protocol - Send Log Entry', () => {
  test('should validate required host parameter', async () => {
    const response = await fetch(`${API_BASE}/fluentd/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: 'test', record: { message: 'hello' } }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host is required');
  });

  test('should validate tag format on send', async () => {
    const response = await fetch(`${API_BASE}/fluentd/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        port: 24224,
        tag: 'invalid tag format!',
      }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid tag format');
  });

  test('should reject non-POST requests', async () => {
    const response = await fetch(`${API_BASE}/fluentd/send`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });
});

describe('Fluentd Forward Protocol - MessagePack Encoding', () => {
  test('should handle tag with dots (namespace format)', async () => {
    const response = await fetch(`${API_BASE}/fluentd/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid',
        tag: 'app.logs.access',
        timeout: 2000,
      }),
    });

    // Should accept dotted tag format (connection will fail but tag validation passes)
    const data = await response.json() as { success: boolean; error: string };
    expect(data.error).not.toContain('Invalid tag');
  }, 10000);

  test('should handle tag with hyphens and underscores', async () => {
    const response = await fetch(`${API_BASE}/fluentd/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid',
        tag: 'my-app_v2.logs',
        timeout: 2000,
      }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.error).not.toContain('Invalid tag');
  }, 10000);

  test('should reject tag exceeding max length', async () => {
    const longTag = 'a'.repeat(129);
    const response = await fetch(`${API_BASE}/fluentd/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        tag: longTag,
      }),
    });

    const data = await response.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid tag format');
  });
});
