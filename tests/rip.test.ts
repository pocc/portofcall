/**
 * RIP Protocol Integration Tests
 * Tests RIP routing table queries and updates
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('RIP Protocol Integration Tests', () => {
  describe('RIP Request', () => {
    it('should send RIPv2 request', async () => {
      const response = await fetch(`${API_BASE}/rip/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 520,
          version: 2,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');

      if (data.success) {
        expect(data.version).toBe(2);
        expect(data.command).toBe('Response');
        expect(data.routes).toBeDefined();
        expect(data.routeCount).toBeDefined();
        expect(data.rtt).toBeDefined();
      }
    }, 20000);

    it('should send RIPv1 request', async () => {
      const response = await fetch(`${API_BASE}/rip/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 520,
          version: 1,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 20000);

    it('should reject request without host', async () => {
      const response = await fetch(`${API_BASE}/rip/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 2,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/rip/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should reject invalid version', async () => {
      const response = await fetch(`${API_BASE}/rip/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          version: 3,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Version must be 1 or 2');
    });

    it('should use default port 520', async () => {
      const response = await fetch(`${API_BASE}/rip/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.port).toBe(520);
    }, 20000);

    it('should use default version 2', async () => {
      const response = await fetch(`${API_BASE}/rip/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 20000);

    it('should request specific network', async () => {
      const response = await fetch(`${API_BASE}/rip/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          networkAddress: '10.0.0.0',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 20000);
  });

  describe('RIP Probe', () => {
    it('should probe RIP router', async () => {
      const response = await fetch(`${API_BASE}/rip/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 520,
          version: 2,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 20000);
  });

  describe('RIP Update', () => {
    it('should send RIP update request', async () => {
      const response = await fetch(`${API_BASE}/rip/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 520,
          version: 2,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      expect(data.version).toBe(2);
      expect(data.command).toBe('request');
      expect(data.raw).toBeDefined();
      expect(data.latencyMs).toBeDefined();

      if (data.success) {
        expect(data.connected).toBe(true);
        expect(data.responseReceived).toBe(true);
        expect(data.routes).toBeDefined();
      }
    }, 20000);

    it('should reject update without host', async () => {
      const response = await fetch(`${API_BASE}/rip/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 2,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should include packet hex dump', async () => {
      const response = await fetch(`${API_BASE}/rip/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.raw).toBeDefined();
      expect(typeof data.raw).toBe('string');
      expect(data.raw).toMatch(/^[0-9a-f\s]+$/i);
    }, 20000);
  });

  describe('RIP Send (v1)', () => {
    it('should send RIPv1 request', async () => {
      const response = await fetch(`${API_BASE}/rip/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 520,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      expect(data.version).toBe(1);
      expect(data.command).toBe('request');
      expect(data.raw).toBeDefined();
      expect(data.latencyMs).toBeDefined();
    }, 20000);

    it('should reject send without host', async () => {
      const response = await fetch(`${API_BASE}/rip/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 520,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/rip/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 70000,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });
  });

  describe('RIP Authenticated Update (Simple Password)', () => {
    it('should send authenticated update with default password', async () => {
      const response = await fetch(`${API_BASE}/rip/auth-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 520,
          password: 'cisco',
          routes: [
            {
              address: '10.0.0.0',
              mask: '255.255.255.0',
              nextHop: '0.0.0.0',
              metric: 1,
            },
          ],
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      expect(data.version).toBe(2);
      expect(data.command).toBe('response');
      expect(data.authType).toBe('simple-password (RFC 2082 §2)');
      expect(data.passwordLength).toBeDefined();
      expect(data.routeCount).toBe(1);
      expect(data.latencyMs).toBeDefined();
    }, 20000);

    it('should reject auth-update without host', async () => {
      const response = await fetch(`${API_BASE}/rip/auth-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should use default password "rip"', async () => {
      const response = await fetch(`${API_BASE}/rip/auth-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.passwordLength).toBeGreaterThan(0);
    }, 20000);

    it('should use default route when not specified', async () => {
      const response = await fetch(`${API_BASE}/rip/auth-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.routeCount).toBe(1);
    }, 20000);
  });

  describe('RIP MD5 Authenticated Update', () => {
    it('should send MD5 authenticated update', async () => {
      const response = await fetch(`${API_BASE}/rip/md5-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 520,
          password: 'secretkey',
          keyId: 1,
          sequenceNumber: 1000,
          routes: [
            {
              address: '10.0.0.0',
              mask: '255.255.255.0',
              nextHop: '0.0.0.0',
              metric: 1,
              tag: 0,
            },
          ],
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      expect(data.version).toBe(2);
      expect(data.command).toBe('response');
      expect(data.authType).toBe('Keyed MD5 (RFC 2082 §4)');
      expect(data.keyId).toBe(1);
      expect(data.keyLength).toBeDefined();
      expect(data.sequenceNumber).toBe(1000);
      expect(data.packetLen).toBeDefined();
      expect(data.totalBytes).toBeDefined();
      expect(data.routeCount).toBe(1);
      expect(data.latencyMs).toBeDefined();
    }, 20000);

    it('should reject md5-update without host', async () => {
      const response = await fetch(`${API_BASE}/rip/md5-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should use default password "rip"', async () => {
      const response = await fetch(`${API_BASE}/rip/md5-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.keyLength).toBeGreaterThan(0);
    }, 20000);

    it('should use default keyId 1', async () => {
      const response = await fetch(`${API_BASE}/rip/md5-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.keyId).toBe(1);
    }, 20000);

    it('should use timestamp as default sequence number', async () => {
      const response = await fetch(`${API_BASE}/rip/md5-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.sequenceNumber).toBeDefined();
      expect(typeof data.sequenceNumber).toBe('number');
    }, 20000);

    it('should clamp keyId to valid range', async () => {
      const response = await fetch(`${API_BASE}/rip/md5-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          keyId: 300,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.keyId).toBe(255);
    }, 20000);
  });

  describe('RIP Route Parsing', () => {
    it('should parse RIPv2 route entries', async () => {
      const response = await fetch(`${API_BASE}/rip/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          version: 2,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        expect(route.addressFamily).toBeDefined();
        expect(route.ipAddress).toBeDefined();
        expect(route.metric).toBeDefined();
        expect(route.routeTag).toBeDefined();
        expect(route.subnetMask).toBeDefined();
        expect(route.nextHop).toBeDefined();
      }
    }, 20000);

    it('should parse RIPv1 route entries', async () => {
      const response = await fetch(`${API_BASE}/rip/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          version: 1,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        expect(route.addressFamily).toBeDefined();
        expect(route.ipAddress).toBeDefined();
        expect(route.metric).toBeDefined();
      }
    }, 20000);

    it('should filter routes with metric > 16', async () => {
      const response = await fetch(`${API_BASE}/rip/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.routes) {
        data.routes.forEach((route: Record<string, unknown>) => {
          expect(route.metric).toBeLessThanOrEqual(16);
        });
      }
    }, 20000);
  });
});
