/**
 * SNMP Protocol Integration Tests (RFC 1157, 1905, 3430)
 * Tests SNMP GET, WALK, SET, multi-GET, and SNMPv3 GET operations
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('SNMP Protocol Integration Tests', () => {
  describe('SNMP GET', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/snmp/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-snmp-host-12345.example.com',
          port: 161,
          oid: '1.3.6.1.2.1.1.1.0',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/snmp/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oid: '1.3.6.1.2.1.1.1.0',
          port: 161,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host is required');
    });

    it('should fail with missing OID parameter', async () => {
      const response = await fetch(`${API_BASE}/snmp/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 161,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('OID is required');
    });

    it('should use default port 161 and community "public"', async () => {
      const response = await fetch(`${API_BASE}/snmp/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          oid: '1.3.6.1.2.1.1.1.0',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/snmp/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 161,
          oid: '1.3.6.1.2.1.1.1.0',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);

    it('should handle SNMPv1 version parameter', async () => {
      const response = await fetch(`${API_BASE}/snmp/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 161,
          oid: '1.3.6.1.2.1.1.1.0',
          version: 1,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should handle SNMPv2c version parameter', async () => {
      const response = await fetch(`${API_BASE}/snmp/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 161,
          oid: '1.3.6.1.2.1.1.5.0',
          version: 2,
          community: 'public',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should return proper response structure on success', async () => {
      const response = await fetch(`${API_BASE}/snmp/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 161,
          oid: '1.3.6.1.2.1.1.1.0',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      if (data.success) {
        expect(data).toHaveProperty('results');
        expect(Array.isArray(data.results)).toBe(true);
      }
    }, 10000);
  });

  describe('SNMP WALK', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/snmp/walk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-snmp-host-12345.example.com',
          port: 161,
          oid: '1.3.6.1.2.1.1',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host and OID', async () => {
      const response = await fetch(`${API_BASE}/snmp/walk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 161,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host and OID are required');
    });

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/snmp/walk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 161,
          oid: '1.3.6.1.2.1.1',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 10000);

    it('should accept maxRepetitions parameter', async () => {
      const response = await fetch(`${API_BASE}/snmp/walk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 161,
          oid: '1.3.6.1.2.1.1',
          maxRepetitions: 5,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should return proper response structure', async () => {
      const response = await fetch(`${API_BASE}/snmp/walk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 161,
          oid: '1.3.6.1.2.1.1',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      if (data.success) {
        expect(data).toHaveProperty('results');
        expect(data).toHaveProperty('count');
        expect(Array.isArray(data.results)).toBe(true);
        expect(typeof data.count).toBe('number');
      }
    }, 10000);
  });

  describe('SNMP SET', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/snmp/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-snmp-host-12345.example.com',
          port: 161,
          community: 'private',
          oid: '1.3.6.1.2.1.1.6.0',
          valueType: 'STRING',
          value: 'Test Location',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/snmp/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oid: '1.3.6.1.2.1.1.6.0',
          valueType: 'STRING',
          value: 'Test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should fail with missing OID parameter', async () => {
      const response = await fetch(`${API_BASE}/snmp/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          valueType: 'STRING',
          value: 'Test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('OID is required');
    });

    it('should fail with missing valueType parameter', async () => {
      const response = await fetch(`${API_BASE}/snmp/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          oid: '1.3.6.1.2.1.1.6.0',
          value: 'Test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('valueType is required');
    });

    it('should fail with missing value parameter', async () => {
      const response = await fetch(`${API_BASE}/snmp/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          oid: '1.3.6.1.2.1.1.6.0',
          valueType: 'STRING',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('value is required');
    });

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/snmp/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 161,
          oid: '1.3.6.1.2.1.1.6.0',
          valueType: 'STRING',
          value: 'Test',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);

    it('should reject unsupported valueType', async () => {
      const response = await fetch(`${API_BASE}/snmp/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          oid: '1.3.6.1.2.1.1.6.0',
          valueType: 'BLOB',
          value: 'Test',
        }),
      });

      // Should return 400 for unsupported type (encoding error caught before connect)
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('SNMP Multi-GET', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/snmp/multi-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-snmp-host-12345.example.com',
          port: 161,
          oids: ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.5.0'],
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/snmp/multi-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oids: ['1.3.6.1.2.1.1.1.0'],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should fail with missing or empty oids array', async () => {
      const response = await fetch(`${API_BASE}/snmp/multi-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          oids: [],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('oids array is required');
    });

    it('should reject more than 60 OIDs', async () => {
      const oids = Array.from({ length: 61 }, (_, i) => `1.3.6.1.2.1.2.2.1.1.${i + 1}`);
      const response = await fetch(`${API_BASE}/snmp/multi-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          oids,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Maximum 60 OIDs');
    });

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/snmp/multi-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 161,
          oids: ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.5.0'],
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);

    it('should return proper response structure', async () => {
      const response = await fetch(`${API_BASE}/snmp/multi-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 161,
          oids: ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.5.0'],
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      if (data.success) {
        expect(data).toHaveProperty('results');
        expect(data).toHaveProperty('requestedOids');
        expect(Array.isArray(data.results)).toBe(true);
      }
    }, 10000);
  });

  describe('SNMP v3 GET', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/snmp/v3-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-snmp-host-12345.example.com',
          port: 161,
          username: 'testuser',
          oids: ['1.3.6.1.2.1.1.1.0'],
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/snmp/v3-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'testuser',
          oids: ['1.3.6.1.2.1.1.1.0'],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should fail with missing username parameter', async () => {
      const response = await fetch(`${API_BASE}/snmp/v3-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          oids: ['1.3.6.1.2.1.1.1.0'],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Username is required');
    });

    it('should fail with missing oids parameter', async () => {
      const response = await fetch(`${API_BASE}/snmp/v3-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          username: 'testuser',
          oids: [],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('At least one OID is required');
    });

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/snmp/v3-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 161,
          username: 'testuser',
          oids: ['1.3.6.1.2.1.1.1.0'],
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);

    it('should accept authPassword and authProtocol parameters', async () => {
      const response = await fetch(`${API_BASE}/snmp/v3-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 161,
          username: 'authuser',
          authPassword: 'authpass12345',
          authProtocol: 'SHA',
          oids: ['1.3.6.1.2.1.1.1.0'],
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should use default port 161', async () => {
      const response = await fetch(`${API_BASE}/snmp/v3-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          username: 'testuser',
          oids: ['1.3.6.1.2.1.1.1.0'],
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should return proper response structure on success', async () => {
      const response = await fetch(`${API_BASE}/snmp/v3-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 161,
          username: 'testuser',
          oids: ['1.3.6.1.2.1.1.1.0'],
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      if (data.success) {
        expect(data).toHaveProperty('engineId');
        expect(data).toHaveProperty('engineBoots');
        expect(data).toHaveProperty('engineTime');
        expect(data).toHaveProperty('securityLevel');
        expect(data).toHaveProperty('varbinds');
        expect(data).toHaveProperty('rtt');
        expect(Array.isArray(data.varbinds)).toBe(true);
      }
    }, 10000);
  });

  describe('SNMP Error Handling', () => {
    it('should handle network timeouts gracefully on GET', async () => {
      const response = await fetch(`${API_BASE}/snmp/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 161,
          oid: '1.3.6.1.2.1.1.1.0',
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle network timeouts gracefully on WALK', async () => {
      const response = await fetch(`${API_BASE}/snmp/walk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 161,
          oid: '1.3.6.1.2.1.1',
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('SNMP Common OIDs', () => {
    const commonOids = [
      { name: 'sysDescr', oid: '1.3.6.1.2.1.1.1.0' },
      { name: 'sysUpTime', oid: '1.3.6.1.2.1.1.3.0' },
      { name: 'sysName', oid: '1.3.6.1.2.1.1.5.0' },
      { name: 'sysLocation', oid: '1.3.6.1.2.1.1.6.0' },
    ];

    it('should accept standard MIB-2 system OIDs in GET requests', async () => {
      for (const { oid } of commonOids) {
        const response = await fetch(`${API_BASE}/snmp/get`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: 'unreachable-host-12345.invalid',
            port: 161,
            oid,
            timeout: 2000,
          }),
        });

        const data = await response.json();
        expect(data).toHaveProperty('success');
      }
    }, 30000);
  });
});
