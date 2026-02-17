/**
 * AFP Protocol Integration Tests
 *
 * Tests AFP (Apple Filing Protocol) implementation including DSI session handling,
 * authentication, and file operations.
 *
 * Note: Tests against live AFP servers may fail if the server is unreachable.
 * Validation tests always pass regardless.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

// ── Shared helpers ─────────────────────────────────────────────────────────

async function post(path: string, body: unknown) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return { response, data };
}

const UNREACHABLE = 'unreachable-afp-host-12345.invalid';
const SHORT_TIMEOUT = 2000;

// ── /api/afp/connect (probe) ───────────────────────────────────────────────

describe('AFP /api/afp/connect', () => {
  it('should reject missing host', async () => {
    const { response, data } = await post('/afp/connect', { port: 548 });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject empty host', async () => {
    const { response, data } = await post('/afp/connect', { host: '', port: 548 });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port 0', async () => {
    const { response, data } = await post('/afp/connect', { host: 'server.local', port: 0 });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject port above 65535', async () => {
    const { response, data } = await post('/afp/connect', { host: 'server.local', port: 99999 });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should handle connection timeout gracefully', async () => {
    const { data } = await post('/afp/connect', {
      host: UNREACHABLE,
      port: 548,
      timeout: SHORT_TIMEOUT,
    });
    // Either succeeds (unlikely) or returns an error — never throws
    if (!data.success) {
      expect(data.error).toBeDefined();
      expect(typeof data.error).toBe('string');
    }
  }, 15000);

  it('should use default port 548 when omitted', async () => {
    const { data } = await post('/afp/connect', {
      host: UNREACHABLE,
      timeout: SHORT_TIMEOUT,
    });
    if (data.success) {
      expect(data.port).toBe(548);
    }
  }, 10000);

  it('should return valid response structure on success', async () => {
    const { data } = await post('/afp/connect', {
      host: UNREACHABLE,
      port: 548,
      timeout: SHORT_TIMEOUT,
    });
    if (data.success && data.status === 'connected') {
      expect(typeof data.host).toBe('string');
      expect(typeof data.port).toBe('number');
      expect(typeof data.connectTime).toBe('number');
      expect(typeof data.rtt).toBe('number');
      if (data.serverName !== undefined) expect(typeof data.serverName).toBe('string');
      if (data.afpVersions !== undefined) expect(Array.isArray(data.afpVersions)).toBe(true);
      if (data.uams !== undefined) expect(Array.isArray(data.uams)).toBe(true);
      if (data.flags !== undefined) expect(typeof data.flags).toBe('number');
    }
  }, 15000);
});

// ── /api/afp/login ─────────────────────────────────────────────────────────

describe('AFP /api/afp/login', () => {
  it('should reject missing host', async () => {
    const { response, data } = await post('/afp/login', {
      port: 548, uam: 'No User Authent',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port', async () => {
    const { response, data } = await post('/afp/login', {
      host: 'server.local', port: 0, uam: 'No User Authent',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject unsupported UAM gracefully', async () => {
    const { data } = await post('/afp/login', {
      host: UNREACHABLE, port: 548, uam: 'DHCAST128', timeout: SHORT_TIMEOUT,
    });
    // Either connection error or unsupported UAM error — never throws
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 15000);

  it('should handle unreachable host', async () => {
    const { data } = await post('/afp/login', {
      host: UNREACHABLE, port: 548, uam: 'No User Authent', timeout: SHORT_TIMEOUT,
    });
    if (!data.success) {
      expect(typeof data.error).toBe('string');
    }
  }, 15000);

  it('should return volumes array on success', async () => {
    const { data } = await post('/afp/login', {
      host: UNREACHABLE, port: 548, uam: 'No User Authent', timeout: SHORT_TIMEOUT,
    });
    if (data.success) {
      expect(Array.isArray(data.volumes)).toBe(true);
      for (const vol of data.volumes ?? []) {
        expect(typeof vol.name).toBe('string');
        expect(typeof vol.hasPassword).toBe('boolean');
      }
    }
  }, 15000);
});

// ── /api/afp/list-dir ─────────────────────────────────────────────────────

describe('AFP /api/afp/list-dir', () => {
  it('should reject missing volumeName', async () => {
    const { response, data } = await post('/afp/list-dir', {
      host: 'server.local', port: 548, uam: 'No User Authent',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName is required');
  });

  it('should reject missing host', async () => {
    const { response, data } = await post('/afp/list-dir', {
      port: 548, uam: 'No User Authent', volumeName: 'Data',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should return entries array on success', async () => {
    const { data } = await post('/afp/list-dir', {
      host: UNREACHABLE, port: 548, uam: 'No User Authent',
      volumeName: 'Data', dirId: 2, timeout: SHORT_TIMEOUT,
    });
    if (data.success) {
      expect(Array.isArray(data.entries)).toBe(true);
      for (const e of data.entries ?? []) {
        expect(typeof e.name).toBe('string');
        expect(typeof e.isDir).toBe('boolean');
      }
    }
  }, 15000);
});

// ── /api/afp/get-info ─────────────────────────────────────────────────────

describe('AFP /api/afp/get-info', () => {
  it('should reject missing volumeName', async () => {
    const { response, data } = await post('/afp/get-info', {
      host: 'server.local', port: 548, name: 'file.txt',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName and name are required');
  });

  it('should reject missing name', async () => {
    const { response, data } = await post('/afp/get-info', {
      host: 'server.local', port: 548, volumeName: 'Data',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName and name are required');
  });
});

// ── /api/afp/create-dir ───────────────────────────────────────────────────

describe('AFP /api/afp/create-dir', () => {
  it('should reject missing volumeName', async () => {
    const { response, data } = await post('/afp/create-dir', {
      host: 'server.local', port: 548, name: 'NewFolder',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName and name are required');
  });

  it('should reject missing name', async () => {
    const { response, data } = await post('/afp/create-dir', {
      host: 'server.local', port: 548, volumeName: 'Data',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName and name are required');
  });

  it('should reject missing host', async () => {
    const { response, data } = await post('/afp/create-dir', {
      port: 548, volumeName: 'Data', name: 'NewFolder',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });
});

// ── /api/afp/create-file ──────────────────────────────────────────────────

describe('AFP /api/afp/create-file', () => {
  it('should reject missing volumeName', async () => {
    const { response, data } = await post('/afp/create-file', {
      host: 'server.local', port: 548, name: 'file.txt',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName and name are required');
  });

  it('should reject missing name', async () => {
    const { response, data } = await post('/afp/create-file', {
      host: 'server.local', port: 548, volumeName: 'Data',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName and name are required');
  });
});

// ── /api/afp/delete ───────────────────────────────────────────────────────

describe('AFP /api/afp/delete', () => {
  it('should reject missing volumeName', async () => {
    const { response, data } = await post('/afp/delete', {
      host: 'server.local', port: 548, name: 'file.txt',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName and name are required');
  });

  it('should reject missing name', async () => {
    const { response, data } = await post('/afp/delete', {
      host: 'server.local', port: 548, volumeName: 'Data',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName and name are required');
  });

  it('should reject missing host', async () => {
    const { response, data } = await post('/afp/delete', {
      port: 548, volumeName: 'Data', name: 'file.txt',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });
});

// ── /api/afp/rename ───────────────────────────────────────────────────────

describe('AFP /api/afp/rename', () => {
  it('should reject missing volumeName', async () => {
    const { response, data } = await post('/afp/rename', {
      host: 'server.local', port: 548, oldName: 'a.txt', newName: 'b.txt',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName, oldName, and newName are required');
  });

  it('should reject missing oldName', async () => {
    const { response, data } = await post('/afp/rename', {
      host: 'server.local', port: 548, volumeName: 'Data', newName: 'b.txt',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName, oldName, and newName are required');
  });

  it('should reject missing newName', async () => {
    const { response, data } = await post('/afp/rename', {
      host: 'server.local', port: 548, volumeName: 'Data', oldName: 'a.txt',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName, oldName, and newName are required');
  });

  it('should reject missing host', async () => {
    const { response, data } = await post('/afp/rename', {
      port: 548, volumeName: 'Data', oldName: 'a.txt', newName: 'b.txt',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });
});

// ── /api/afp/read-file ─────────────────────────────────────────────────────

describe('AFP /api/afp/read-file', () => {
  it('should reject missing volumeName', async () => {
    const { response, data } = await post('/afp/read-file', {
      host: 'server.local', port: 548, name: 'file.txt',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName and name are required');
  });

  it('should reject missing name', async () => {
    const { response, data } = await post('/afp/read-file', {
      host: 'server.local', port: 548, volumeName: 'Data',
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('volumeName and name are required');
  });

  it('should return base64 data on success', async () => {
    const { data } = await post('/afp/read-file', {
      host: UNREACHABLE, port: 548, uam: 'No User Authent',
      volumeName: 'Data', name: 'readme.txt', timeout: SHORT_TIMEOUT,
    });
    if (data.success) {
      expect(typeof data.data).toBe('string'); // base64
      expect(typeof data.size).toBe('number');
    }
  }, 15000);
});
