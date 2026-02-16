import { describe, it, expect } from 'vitest';

const API_BASE = 'https://portofcall.ross.gg';

describe('Apache Ignite Thin Client API', () => {
  // --- /api/ignite/connect ---

  it('should return 400 when host is missing for connect', async () => {
    const res = await fetch(`${API_BASE}/api/ignite/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 10800 }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it('should fail gracefully for non-existent host on connect', async () => {
    const res = await fetch(`${API_BASE}/api/ignite/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'nonexistent.invalid', port: 10800, timeout: 5000 }),
    });
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  });

  it('should fail for invalid port on connect', async () => {
    const res = await fetch(`${API_BASE}/api/ignite/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', port: 99999, timeout: 5000 }),
    });
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('should timeout for unresponsive host on connect', async () => {
    const res = await fetch(`${API_BASE}/api/ignite/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '192.0.2.1', port: 10800, timeout: 3000 }),
    });
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  });

  it('should detect Cloudflare-protected hosts on connect', async () => {
    const res = await fetch(`${API_BASE}/api/ignite/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'cloudflare.com', port: 10800 }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.isCloudflare).toBe(true);
  });

  // --- /api/ignite/probe ---

  it('should return 400 when host is missing for probe', async () => {
    const res = await fetch(`${API_BASE}/api/ignite/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 10800 }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it('should fail gracefully for non-existent host on probe', async () => {
    const res = await fetch(`${API_BASE}/api/ignite/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'nonexistent.invalid', port: 10800, timeout: 5000 }),
    });
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  });

  it('should detect Cloudflare-protected hosts on probe', async () => {
    const res = await fetch(`${API_BASE}/api/ignite/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'cloudflare.com', port: 10800 }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.isCloudflare).toBe(true);
  });

  it('should use default port 10800 when not specified', async () => {
    const res = await fetch(`${API_BASE}/api/ignite/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '192.0.2.1', timeout: 3000 }),
    });
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('should fail for invalid port on probe', async () => {
    const res = await fetch(`${API_BASE}/api/ignite/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', port: 99999, timeout: 5000 }),
    });
    const data = await res.json();
    expect(data.success).toBe(false);
  });
});
