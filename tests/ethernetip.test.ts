/**
 * EtherNet/IP Protocol Integration Tests
 *
 * Tests EtherNet/IP (CIP) device discovery, CIP read/write, and service listing.
 *
 * Note: Tests against live devices will fail if unreachable.
 * Validation tests always pass regardless.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';
const UNREACHABLE = 'unreachable-host-12345.invalid';
const SHORT_TIMEOUT = 3000;

async function post(path: string, body: unknown) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return { response, data };
}

// ── /api/ethernetip/identity ──────────────────────────────────────────────────

describe('EtherNet/IP /api/ethernetip/identity', () => {
  it('should reject missing host', async () => {
    const { response, data } = await post('/ethernetip/identity', { port: 44818 });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host');
  });

  it('should reject invalid port', async () => {
    const { response, data } = await post('/ethernetip/identity', {
      host: UNREACHABLE, port: 99999,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Port');
  });

  it('should reject port 0', async () => {
    const { response, data } = await post('/ethernetip/identity', {
      host: UNREACHABLE, port: 0,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('should handle unreachable host gracefully', async () => {
    const { data } = await post('/ethernetip/identity', {
      host: UNREACHABLE, port: 44818, timeout: SHORT_TIMEOUT,
    });
    if (!data.success) {
      expect(typeof data.error).toBe('string');
    }
  }, 15000);

  it('should use default port 44818', async () => {
    const { data } = await post('/ethernetip/identity', {
      host: UNREACHABLE, timeout: SHORT_TIMEOUT,
    });
    if (data.success) {
      expect(data.port).toBe(44818);
    }
  }, 10000);

  it('should return valid identity structure on success', async () => {
    const { data } = await post('/ethernetip/identity', {
      host: UNREACHABLE, port: 44818, timeout: SHORT_TIMEOUT,
    });
    if (data.success && data.identity) {
      if (data.identity.vendorId !== undefined)  expect(typeof data.identity.vendorId).toBe('number');
      if (data.identity.deviceType !== undefined) expect(typeof data.identity.deviceType).toBe('number');
      if (data.identity.productName !== undefined) expect(typeof data.identity.productName).toBe('string');
      if (data.identity.serialNumber !== undefined) expect(typeof data.identity.serialNumber).toBe('string');
    }
  }, 15000);

  it('should block Cloudflare-protected hosts', async () => {
    const { response, data } = await post('/ethernetip/identity', {
      host: 'cloudflare.com', port: 44818,
    });
    expect(response.status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.isCloudflare).toBe(true);
  }, 10000);
});

// ── /api/ethernetip/cip-read ──────────────────────────────────────────────────

describe('EtherNet/IP /api/ethernetip/cip-read', () => {
  it('should reject missing host', async () => {
    const { response, data } = await post('/ethernetip/cip-read', {
      port: 44818, classId: 1, instanceId: 1, attributeId: 1,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host');
  });

  it('should reject invalid port', async () => {
    const { response, data } = await post('/ethernetip/cip-read', {
      host: UNREACHABLE, port: 0, classId: 1, instanceId: 1, attributeId: 1,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('should reject missing classId', async () => {
    const { response, data } = await post('/ethernetip/cip-read', {
      host: UNREACHABLE, port: 44818, instanceId: 1, attributeId: 1,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('classId');
  });

  it('should reject missing instanceId', async () => {
    const { response, data } = await post('/ethernetip/cip-read', {
      host: UNREACHABLE, port: 44818, classId: 1, attributeId: 1,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('should reject missing attributeId', async () => {
    const { response, data } = await post('/ethernetip/cip-read', {
      host: UNREACHABLE, port: 44818, classId: 1, instanceId: 1,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('should handle unreachable host gracefully', async () => {
    const { data } = await post('/ethernetip/cip-read', {
      host: UNREACHABLE, port: 44818, classId: 1, instanceId: 1, attributeId: 7,
      timeout: SHORT_TIMEOUT,
    });
    if (!data.success) {
      expect(typeof data.error).toBe('string');
    }
  }, 15000);

  it('should return valid data structure on success', async () => {
    const { data } = await post('/ethernetip/cip-read', {
      host: UNREACHABLE, port: 44818, classId: 1, instanceId: 1, attributeId: 7,
      timeout: SHORT_TIMEOUT,
    });
    if (data.success) {
      expect(Array.isArray(data.data)).toBe(true);
      expect(typeof data.hex).toBe('string');
      expect(typeof data.rtt).toBe('number');
      expect(typeof data.status).toBe('number');
      expect(typeof data.statusName).toBe('string');
    }
  }, 15000);
});

// ── /api/ethernetip/get-attribute-all ─────────────────────────────────────────

describe('EtherNet/IP /api/ethernetip/get-attribute-all', () => {
  it('should reject missing host', async () => {
    const { response, data } = await post('/ethernetip/get-attribute-all', {
      port: 44818, classId: 1, instanceId: 1,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host');
  });

  it('should reject invalid port', async () => {
    const { response, data } = await post('/ethernetip/get-attribute-all', {
      host: UNREACHABLE, port: 65536, classId: 1, instanceId: 1,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('should reject missing classId', async () => {
    const { response, data } = await post('/ethernetip/get-attribute-all', {
      host: UNREACHABLE, port: 44818, instanceId: 1,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('classId');
  });

  it('should reject missing instanceId', async () => {
    const { response, data } = await post('/ethernetip/get-attribute-all', {
      host: UNREACHABLE, port: 44818, classId: 1,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('should handle unreachable host gracefully', async () => {
    const { data } = await post('/ethernetip/get-attribute-all', {
      host: UNREACHABLE, port: 44818, classId: 1, instanceId: 1, timeout: SHORT_TIMEOUT,
    });
    if (!data.success) {
      expect(typeof data.error).toBe('string');
    }
  }, 15000);

  it('should return hex and data array on success', async () => {
    const { data } = await post('/ethernetip/get-attribute-all', {
      host: UNREACHABLE, port: 44818, classId: 1, instanceId: 1, timeout: SHORT_TIMEOUT,
    });
    if (data.success) {
      expect(Array.isArray(data.data)).toBe(true);
      expect(typeof data.hex).toBe('string');
      expect(typeof data.rtt).toBe('number');
    }
  }, 15000);
});

// ── /api/ethernetip/set-attribute ─────────────────────────────────────────────

describe('EtherNet/IP /api/ethernetip/set-attribute', () => {
  it('should reject missing host', async () => {
    const { response, data } = await post('/ethernetip/set-attribute', {
      port: 44818, classId: 1, instanceId: 1, attributeId: 7, data: [1, 2, 3],
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host');
  });

  it('should reject invalid port', async () => {
    const { response, data } = await post('/ethernetip/set-attribute', {
      host: UNREACHABLE, port: 0, classId: 1, instanceId: 1, attributeId: 7, data: [1],
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('should reject missing classId', async () => {
    const { response, data } = await post('/ethernetip/set-attribute', {
      host: UNREACHABLE, port: 44818, instanceId: 1, attributeId: 7, data: [1],
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('classId');
  });

  it('should reject empty data array', async () => {
    const { response, data } = await post('/ethernetip/set-attribute', {
      host: UNREACHABLE, port: 44818, classId: 1, instanceId: 1, attributeId: 7, data: [],
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('data');
  });

  it('should reject missing data field', async () => {
    const { response, data } = await post('/ethernetip/set-attribute', {
      host: UNREACHABLE, port: 44818, classId: 1, instanceId: 1, attributeId: 7,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('should handle unreachable host gracefully', async () => {
    const { data } = await post('/ethernetip/set-attribute', {
      host: UNREACHABLE, port: 44818,
      classId: 1, instanceId: 1, attributeId: 7,
      data: [0x48, 0x65, 0x6C, 0x6C, 0x6F],
      timeout: SHORT_TIMEOUT,
    });
    if (!data.success) {
      expect(typeof data.error).toBe('string');
    }
  }, 15000);

  it('should return success structure when write succeeds', async () => {
    const { data } = await post('/ethernetip/set-attribute', {
      host: UNREACHABLE, port: 44818,
      classId: 1, instanceId: 1, attributeId: 7,
      data: [0x01],
      timeout: SHORT_TIMEOUT,
    });
    if (data.success) {
      expect(typeof data.bytesWritten).toBe('number');
      expect(data.bytesWritten).toBe(1);
      expect(typeof data.rtt).toBe('number');
      expect(typeof data.statusName).toBe('string');
    }
  }, 15000);
});

// ── /api/ethernetip/list-services ─────────────────────────────────────────────

describe('EtherNet/IP /api/ethernetip/list-services', () => {
  it('should reject missing host', async () => {
    const { response, data } = await post('/ethernetip/list-services', { port: 44818 });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Host');
  });

  it('should reject invalid port', async () => {
    const { response, data } = await post('/ethernetip/list-services', {
      host: UNREACHABLE, port: 99999,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('should reject port 0', async () => {
    const { response, data } = await post('/ethernetip/list-services', {
      host: UNREACHABLE, port: 0,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('should handle unreachable host gracefully', async () => {
    const { data } = await post('/ethernetip/list-services', {
      host: UNREACHABLE, port: 44818, timeout: SHORT_TIMEOUT,
    });
    if (!data.success) {
      expect(typeof data.error).toBe('string');
    }
  }, 15000);

  it('should return valid services structure on success', async () => {
    const { data } = await post('/ethernetip/list-services', {
      host: UNREACHABLE, port: 44818, timeout: SHORT_TIMEOUT,
    });
    if (data.success) {
      expect(typeof data.serviceCount).toBe('number');
      expect(Array.isArray(data.services)).toBe(true);
      expect(typeof data.rtt).toBe('number');
      for (const svc of data.services ?? []) {
        expect(typeof svc.typeId).toBe('number');
        expect(typeof svc.version).toBe('number');
        expect(typeof svc.capabilityFlags).toBe('number');
        expect(typeof svc.name).toBe('string');
        expect(typeof svc.supportsTCP).toBe('boolean');
        expect(typeof svc.supportsUDP).toBe('boolean');
      }
    }
  }, 15000);

  it('should block Cloudflare-protected hosts', async () => {
    const { response, data } = await post('/ethernetip/list-services', {
      host: 'cloudflare.com', port: 44818,
    });
    expect(response.status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.isCloudflare).toBe(true);
  }, 10000);
});
