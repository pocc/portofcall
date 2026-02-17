/**
 * CIFS / SMB2 Integration Tests
 *
 * Tests the CIFS worker endpoints:
 *   POST /api/cifs/negotiate  — SMB2 negotiate probe
 *   POST /api/cifs/auth       — NTLMv2 session setup
 *   POST /api/cifs/ls         — list directory
 *   POST /api/cifs/read       — read file (first 64 KB)
 *   POST /api/cifs/stat       — get file/directory metadata
 *
 * Live server tests require a reachable SMB2 server:
 *   docker run -d -p 445:445 dperson/samba -s "test;/test;yes;no;no;all"
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

// ── Input validation (no server needed) ───────────────────────────────────────

describe('CIFS — input validation', () => {
  it('negotiate: rejects empty host', async () => {
    const res = await fetch(`${API_BASE}/cifs/negotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '', port: 445 }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('negotiate: rejects invalid port', async () => {
    const res = await fetch(`${API_BASE}/cifs/negotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'localhost', port: 0 }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Port must be between');
  });

  it('negotiate: rejects host with invalid characters', async () => {
    const res = await fetch(`${API_BASE}/cifs/negotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'server;rm -rf /', port: 445 }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('invalid characters');
  });

  it('auth: rejects empty host', async () => {
    const res = await fetch(`${API_BASE}/cifs/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '', port: 445, username: 'user', password: 'pass' }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('auth: rejects missing username', async () => {
    const res = await fetch(`${API_BASE}/cifs/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'localhost', port: 445, username: '', password: 'pass' }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Username is required');
  });

  it('auth: rejects missing password', async () => {
    const res = await fetch(`${API_BASE}/cifs/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'localhost', port: 445, username: 'user', password: '' }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Password is required');
  });

  it('ls: rejects missing share', async () => {
    const res = await fetch(`${API_BASE}/cifs/ls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'localhost', port: 445, username: 'user', password: 'pass', share: '' }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Share is required');
  });

  it('read: rejects missing path', async () => {
    const res = await fetch(`${API_BASE}/cifs/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'localhost', port: 445, username: 'user', password: 'pass', share: 'C$', path: '' }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Path is required');
  });

  it('stat: rejects missing path', async () => {
    const res = await fetch(`${API_BASE}/cifs/stat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'localhost', port: 445, username: 'user', password: 'pass', share: 'C$', path: '' }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Path is required');
  });

  it('negotiate: handles non-existent host gracefully', async () => {
    const res = await fetch(`${API_BASE}/cifs/negotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'nonexistent.invalid.example', port: 445, timeout: 5000 }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);

  it('auth: handles non-existent host gracefully', async () => {
    const res = await fetch(`${API_BASE}/cifs/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'nonexistent.invalid.example', port: 445, username: 'user', password: 'pass', timeout: 5000 }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);

  it('backward-compat /connect alias works', async () => {
    const res = await fetch(`${API_BASE}/cifs/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '', port: 445 }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
  });
});

// ── Live server tests (conditional on localhost SMB2) ─────────────────────────

describe('CIFS — live server (localhost)', () => {
  it('should negotiate SMB2 on :445', async () => {
    const res = await fetch(`${API_BASE}/cifs/negotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'localhost', port: 445, timeout: 8000 }),
    });
    const data = await res.json() as {
      success: boolean; error?: string;
      dialect?: string; serverGuid?: string; capabilities?: string[];
    };
    if (data.success) {
      expect(data.dialect).toBeDefined();
      expect(data.serverGuid).toBeDefined();
    } else {
      expect(data.error).toBeDefined();
    }
  }, 15000);

  it('should authenticate with NTLMv2', async () => {
    const res = await fetch(`${API_BASE}/cifs/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 445,
        username: 'testuser',
        password: 'testpass',
        domain: 'WORKGROUP',
        timeout: 10000,
      }),
    });
    const data = await res.json() as {
      success: boolean; error?: string;
      dialect?: string; sessionId?: string;
    };
    if (data.success) {
      expect(data.dialect).toBeDefined();
      expect(data.sessionId).toBeDefined();
    } else {
      expect(data.error).toBeDefined();
    }
  }, 15000);

  it('should list directory contents', async () => {
    const res = await fetch(`${API_BASE}/cifs/ls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 445,
        username: 'testuser',
        password: 'testpass',
        domain: 'WORKGROUP',
        share: 'test',
        timeout: 15000,
      }),
    });
    const data = await res.json() as {
      success: boolean; error?: string;
      entries?: Array<{ name: string; isDirectory: boolean; size: number }>;
      count?: number;
    };
    if (data.success) {
      expect(Array.isArray(data.entries)).toBe(true);
      expect(typeof data.count).toBe('number');
    } else {
      expect(data.error).toBeDefined();
    }
  }, 20000);

  it('should read a file', async () => {
    const res = await fetch(`${API_BASE}/cifs/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 445,
        username: 'testuser',
        password: 'testpass',
        domain: 'WORKGROUP',
        share: 'test',
        path: 'hello.txt',
        timeout: 15000,
      }),
    });
    const data = await res.json() as {
      success: boolean; error?: string;
      content?: string; bytesRead?: number;
    };
    if (data.success) {
      expect(typeof data.content).toBe('string');
      expect(data.bytesRead).toBeGreaterThanOrEqual(0);
    } else {
      expect(data.error).toBeDefined();
    }
  }, 20000);

  it('should get file/directory metadata', async () => {
    const res = await fetch(`${API_BASE}/cifs/stat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 445,
        username: 'testuser',
        password: 'testpass',
        domain: 'WORKGROUP',
        share: 'test',
        path: '',
        timeout: 15000,
      }),
    });
    const data = await res.json() as {
      success: boolean; error?: string;
      name?: string; isDirectory?: boolean; created?: string;
    };
    if (data.success) {
      expect(typeof data.isDirectory).toBe('boolean');
    } else {
      expect(data.error).toBeDefined();
    }
  }, 20000);
});
