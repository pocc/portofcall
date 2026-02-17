/**
 * DRDA (IBM DB2) Protocol Integration Tests
 *
 * Tests: EXCSAT handshake, probe, authentication, query execution, DDL/DML.
 * All tests use unreachable/invalid hosts to exercise error-handling paths;
 * real DB2/Derby connectivity requires a live server.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';
const UNREACHABLE = 'unreachable-host-12345.invalid';

// ── /api/drda/connect ─────────────────────────────────────────────────────────

describe('DRDA Connect (EXCSAT handshake)', () => {
  it('should handle connection to non-existent host', async () => {
    const response = await fetch(`${API_BASE}/drda/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'non-existent-db2-12345.example.com', port: 50000, timeout: 5000 }),
    });
    expect(response.ok).toBe(false);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);

  it('should return 400 with missing host', async () => {
    const response = await fetch(`${API_BASE}/drda/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 50000 }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('host');
  });

  it('should return 400 for invalid port', async () => {
    const response = await fetch(`${API_BASE}/drda/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'example.com', port: 99999 }),
    });
    expect(response.status).toBe(400);
  });

  it('should accept default port when not specified', async () => {
    const response = await fetch(`${API_BASE}/drda/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: UNREACHABLE, timeout: 3000 }),
    });
    const data = await response.json();
    expect(data).toHaveProperty('success');
    expect(data.success).toBe(false);
  }, 10000);

  it('should accept custom port (Derby 1527)', async () => {
    const response = await fetch(`${API_BASE}/drda/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: UNREACHABLE, port: 1527, timeout: 3000 }),
    });
    const data = await response.json();
    expect(data).toHaveProperty('success');
  }, 10000);

  it('should return 405 for GET requests', async () => {
    const response = await fetch(`${API_BASE}/drda/connect`, { method: 'GET' });
    expect(response.status).toBe(405);
  });

  it('should return 403 for Cloudflare-protected host', async () => {
    const response = await fetch(`${API_BASE}/drda/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'cloudflare.com', port: 50000 }),
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.isCloudflare).toBe(true);
  }, 10000);

  it('should include error string in failure response', async () => {
    const response = await fetch(`${API_BASE}/drda/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: UNREACHABLE, timeout: 3000 }),
    });
    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(typeof data.error).toBe('string');
  }, 10000);
});

// ── /api/drda/probe ───────────────────────────────────────────────────────────

describe('DRDA Probe (lightweight)', () => {
  it('should handle probe to non-existent host', async () => {
    const response = await fetch(`${API_BASE}/drda/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: UNREACHABLE, port: 50000, timeout: 5000 }),
    });
    expect(response.ok).toBe(false);
    const data = await response.json();
    expect(data.success).toBe(false);
  }, 15000);

  it('should return 400 with missing host', async () => {
    const response = await fetch(`${API_BASE}/drda/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 50000 }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('host');
  });

  it('should return 405 for GET requests', async () => {
    const response = await fetch(`${API_BASE}/drda/probe`, { method: 'GET' });
    expect(response.status).toBe(405);
  });

  it('should return 403 for Cloudflare-protected host', async () => {
    const response = await fetch(`${API_BASE}/drda/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'cloudflare.com', port: 50000 }),
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.isCloudflare).toBe(true);
  }, 10000);
});

// ── /api/drda/login ───────────────────────────────────────────────────────────

describe('DRDA Login (EXCSAT + ACCSEC + SECCHK + ACCRDB)', () => {
  it('should return 400 with missing host', async () => {
    const response = await fetch(`${API_BASE}/drda/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: 'MYDB', username: 'user', password: 'pass' }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('host');
  });

  it('should return 400 with missing database', async () => {
    const response = await fetch(`${API_BASE}/drda/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'example.com', username: 'user', password: 'pass' }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('database');
  });

  it('should return 400 with missing username', async () => {
    const response = await fetch(`${API_BASE}/drda/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'example.com', database: 'MYDB', password: 'pass' }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('username');
  });

  it('should fail gracefully on unreachable host', async () => {
    const response = await fetch(`${API_BASE}/drda/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: UNREACHABLE, database: 'MYDB', username: 'user', password: 'pass', timeout: 3000 }),
    });
    expect(response.ok).toBe(false);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should return 405 for GET requests', async () => {
    const response = await fetch(`${API_BASE}/drda/login`, { method: 'GET' });
    expect(response.status).toBe(405);
  });

  it('should return 403 for Cloudflare-protected host', async () => {
    const response = await fetch(`${API_BASE}/drda/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'cloudflare.com', port: 50000, database: 'DB', username: 'u', password: 'p' }),
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.isCloudflare).toBe(true);
  }, 10000);
});

// ── /api/drda/query ───────────────────────────────────────────────────────────

describe('DRDA Query (SELECT execution)', () => {
  it('should return 400 with missing required fields', async () => {
    const response = await fetch(`${API_BASE}/drda/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'example.com' }),
    });
    expect(response.status).toBe(400);
  });

  it('should return 400 when sql is missing', async () => {
    const response = await fetch(`${API_BASE}/drda/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'example.com', database: 'MYDB', username: 'u', password: 'p' }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('sql');
  });

  it('should reject non-SELECT SQL', async () => {
    const response = await fetch(`${API_BASE}/drda/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'example.com', database: 'MYDB', username: 'u', password: 'p',
        sql: 'INSERT INTO foo VALUES (1)',
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('SELECT');
  });

  it('should accept VALUES as a query', async () => {
    const response = await fetch(`${API_BASE}/drda/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: UNREACHABLE, database: 'MYDB', username: 'u', password: 'p',
        sql: 'VALUES (1, 2, 3)', timeout: 3000,
      }),
    });
    // Either fails on connect (unreachable) — not a 400 from SQL validation
    expect(response.status).not.toBe(400);
  }, 10000);

  it('should fail gracefully on unreachable host', async () => {
    const response = await fetch(`${API_BASE}/drda/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: UNREACHABLE, database: 'MYDB', username: 'user', password: 'pass',
        sql: 'SELECT 1 FROM SYSIBM.SYSDUMMY1', timeout: 3000,
      }),
    });
    expect(response.ok).toBe(false);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should return 405 for GET requests', async () => {
    const response = await fetch(`${API_BASE}/drda/query`, { method: 'GET' });
    expect(response.status).toBe(405);
  });

  it('should return 403 for Cloudflare-protected host', async () => {
    const response = await fetch(`${API_BASE}/drda/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'cloudflare.com', database: 'DB', username: 'u', password: 'p',
        sql: 'SELECT 1 FROM SYSIBM.SYSDUMMY1',
      }),
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.isCloudflare).toBe(true);
  }, 10000);
});

// ── /api/drda/execute ─────────────────────────────────────────────────────────

describe('DRDA Execute (DDL/DML)', () => {
  it('should return 400 with missing host', async () => {
    const response = await fetch(`${API_BASE}/drda/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: 'MYDB', username: 'u', password: 'p', sql: 'DROP TABLE foo' }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('host');
  });

  it('should return 400 with missing sql', async () => {
    const response = await fetch(`${API_BASE}/drda/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'example.com', database: 'MYDB', username: 'u', password: 'p' }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('sql');
  });

  it('should fail gracefully on unreachable host', async () => {
    const response = await fetch(`${API_BASE}/drda/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: UNREACHABLE, database: 'MYDB', username: 'user', password: 'pass',
        sql: 'CREATE TABLE test (id INT)', timeout: 3000,
      }),
    });
    expect(response.ok).toBe(false);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should return 405 for GET requests', async () => {
    const response = await fetch(`${API_BASE}/drda/execute`, { method: 'GET' });
    expect(response.status).toBe(405);
  });

  it('should return 403 for Cloudflare-protected host', async () => {
    const response = await fetch(`${API_BASE}/drda/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'cloudflare.com', database: 'DB', username: 'u', password: 'p',
        sql: 'INSERT INTO foo VALUES (1)',
      }),
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.isCloudflare).toBe(true);
  }, 10000);
});

// ── /api/drda/prepare ─────────────────────────────────────────────────────────

describe('DRDA Prepare (PRPSQLSTT)', () => {
  it('should return 400 with missing host', async () => {
    const response = await fetch(`${API_BASE}/drda/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: 'MYDB', username: 'u', password: 'p', sql: 'SELECT 1 FROM SYSIBM.SYSDUMMY1' }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('host');
  });

  it('should return 400 with missing sql', async () => {
    const response = await fetch(`${API_BASE}/drda/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'example.com', database: 'MYDB', username: 'u', password: 'p' }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('sql');
  });

  it('should fail gracefully on unreachable host', async () => {
    const response = await fetch(`${API_BASE}/drda/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: UNREACHABLE, database: 'MYDB', username: 'user', password: 'pass',
        sql: 'SELECT ? FROM SYSIBM.SYSDUMMY1', timeout: 3000,
      }),
    });
    expect(response.ok).toBe(false);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should return 405 for GET requests', async () => {
    const response = await fetch(`${API_BASE}/drda/prepare`, { method: 'GET' });
    expect(response.status).toBe(405);
  });

  it('should return 403 for Cloudflare-protected host', async () => {
    const response = await fetch(`${API_BASE}/drda/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'cloudflare.com', database: 'DB', username: 'u', password: 'p',
        sql: 'SELECT ? FROM SYSIBM.SYSDUMMY1',
      }),
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.isCloudflare).toBe(true);
  }, 10000);
});

// ── /api/drda/call ────────────────────────────────────────────────────────────

describe('DRDA Call (stored procedure + multiple result sets)', () => {
  it('should return 400 with missing host', async () => {
    const response = await fetch(`${API_BASE}/drda/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: 'MYDB', username: 'u', password: 'p', procedure: 'CALL myproc()' }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('host');
  });

  it('should return 400 with missing procedure', async () => {
    const response = await fetch(`${API_BASE}/drda/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'example.com', database: 'MYDB', username: 'u', password: 'p' }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('procedure');
  });

  it('should return 400 if procedure is not a CALL statement', async () => {
    const response = await fetch(`${API_BASE}/drda/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'example.com', database: 'MYDB', username: 'u', password: 'p',
        procedure: 'SELECT 1 FROM dual',
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('CALL');
  });

  it('should fail gracefully on unreachable host', async () => {
    const response = await fetch(`${API_BASE}/drda/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: UNREACHABLE, database: 'MYDB', username: 'user', password: 'pass',
        procedure: 'CALL myschema.myproc()', timeout: 3000,
      }),
    });
    expect(response.ok).toBe(false);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should return 405 for GET requests', async () => {
    const response = await fetch(`${API_BASE}/drda/call`, { method: 'GET' });
    expect(response.status).toBe(405);
  });

  it('should return 403 for Cloudflare-protected host', async () => {
    const response = await fetch(`${API_BASE}/drda/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'cloudflare.com', database: 'DB', username: 'u', password: 'p',
        procedure: 'CALL myschema.myproc()',
      }),
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.isCloudflare).toBe(true);
  }, 10000);

  it('should accept params array for parameterized CALL', async () => {
    const response = await fetch(`${API_BASE}/drda/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: UNREACHABLE, database: 'MYDB', username: 'u', password: 'p',
        procedure: 'CALL myschema.myproc(?, ?)',
        params: [42, 'hello'], timeout: 3000,
      }),
    });
    // Should fail on connect (unreachable), not on param validation
    expect(response.status).not.toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty('success');
  }, 10000);
});
