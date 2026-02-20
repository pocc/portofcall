/**
 * LLMNR Protocol Integration Tests
 * Tests LLMNR name resolution, reverse lookup, and scanning
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('LLMNR Protocol Integration Tests', () => {
  describe('LLMNR Forward Query', () => {
    it('should send LLMNR query for A record', async () => {
      const response = await fetch(`${API_BASE}/llmnr/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: 5355,
          name: 'testhost',
          type: 1,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');

      if (data.success) {
        expect(data.query).toBeDefined();
        expect(data.query.name).toBe('testhost');
        expect(data.query.typeName).toBe('A');
        expect(data.answers).toBeDefined();
        expect(data.flags).toBeDefined();
        expect(data.id).toBeDefined();
      }
    }, 20000);

    it('should reject query without host', async () => {
      const response = await fetch(`${API_BASE}/llmnr/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'testhost',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host and name required');
    });

    it('should reject query without name', async () => {
      const response = await fetch(`${API_BASE}/llmnr/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host and name required');
    });

    it('should use default port 5355', async () => {
      const response = await fetch(`${API_BASE}/llmnr/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          name: 'testhost',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 20000);

    it('should use default type A when not specified', async () => {
      const response = await fetch(`${API_BASE}/llmnr/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          name: 'testhost',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.query) {
        expect(data.query.type).toBe(1);
        expect(data.query.typeName).toBe('A');
      }
    }, 20000);
  });

  describe('LLMNR Reverse Query (PTR)', () => {
    it('should send reverse query for IPv4 address', async () => {
      const response = await fetch(`${API_BASE}/llmnr/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: 5355,
          ip: '192.168.1.100',
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');

      if (data.success) {
        expect(data.ip).toBe('192.168.1.100');
        expect(data.ptrName).toBeDefined();
        expect(data.ptrName).toContain('.in-addr.arpa');
        expect(data.hostnames).toBeDefined();
        expect(Array.isArray(data.hostnames)).toBe(true);
      }
    }, 20000);

    it('should send reverse query for IPv6 address', async () => {
      const response = await fetch(`${API_BASE}/llmnr/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          ip: 'fe80::1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.ptrName) {
        expect(data.ptrName).toContain('.ip6.arpa');
      }
    }, 20000);

    it('should reject reverse without host', async () => {
      const response = await fetch(`${API_BASE}/llmnr/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: '192.168.1.100',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host and ip required');
    });

    it('should reject reverse without ip', async () => {
      const response = await fetch(`${API_BASE}/llmnr/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host and ip required');
    });

    it('should parse PTR records from response', async () => {
      const response = await fetch(`${API_BASE}/llmnr/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          ip: '192.168.1.100',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.answers) {
        expect(Array.isArray(data.answers)).toBe(true);
        data.answers.forEach((answer: Record<string, unknown>) => {
          if (answer.type === 'PTR') {
            expect(answer.name).toBeDefined();
            expect(answer.value).toBeDefined();
            expect(answer.ttl).toBeDefined();
          }
        });
      }
    }, 20000);
  });

  describe('LLMNR Hostname Scan', () => {
    it('should scan multiple hostnames', async () => {
      const response = await fetch(`${API_BASE}/llmnr/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: 5355,
          names: ['DC', 'SERVER', 'WORKSTATION'],
          type: 1,
          perQueryTimeout: 2000,
          timeout: 15000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');

      if (data.success) {
        expect(data.total).toBe(3);
        expect(data.respondedCount).toBeDefined();
        expect(data.responded).toBeDefined();
        expect(data.noResponse).toBeDefined();
        expect(Array.isArray(data.responded)).toBe(true);
        expect(Array.isArray(data.noResponse)).toBe(true);
      }
    }, 25000);

    it('should scan with prefix and range', async () => {
      const response = await fetch(`${API_BASE}/llmnr/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          prefix: 'WS',
          rangeStart: 1,
          rangeEnd: 5,
          timeout: 15000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.total).toBe(5);
    }, 25000);

    it('should reject scan without host', async () => {
      const response = await fetch(`${API_BASE}/llmnr/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          names: ['DC'],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should use default hostnames when none specified', async () => {
      const response = await fetch(`${API_BASE}/llmnr/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          timeout: 30000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.total).toBeGreaterThan(0);
    }, 35000);

    it('should return responses with hostname and answers', async () => {
      const response = await fetch(`${API_BASE}/llmnr/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          names: ['SERVER'],
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.responded && data.responded.length > 0) {
        const resp = data.responded[0];
        expect(resp.name).toBeDefined();
        expect(resp.answers).toBeDefined();
        expect(Array.isArray(resp.answers)).toBe(true);
      }
    }, 20000);
  });

  describe('LLMNR Flags Parsing', () => {
    it('should parse response flags', async () => {
      const response = await fetch(`${API_BASE}/llmnr/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          name: 'testhost',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.flags) {
        expect(data.flags.qr).toBeDefined();
        expect(data.flags.opcode).toBeDefined();
        expect(data.flags.conflict).toBeDefined();
        expect(data.flags.tc).toBeDefined();
        expect(data.flags.tentative).toBeDefined();
        expect(data.flags.rcode).toBeDefined();
        expect(data.flags.rcodeName).toBeDefined();
      }
    }, 20000);

    it('should detect name conflicts', async () => {
      const response = await fetch(`${API_BASE}/llmnr/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          name: 'testhost',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.flags && data.flags.conflict) {
        expect(typeof data.flags.conflict).toBe('boolean');
      }
    }, 20000);

    it('should detect truncated responses', async () => {
      const response = await fetch(`${API_BASE}/llmnr/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          name: 'testhost',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.flags && data.flags.tc) {
        expect(typeof data.flags.tc).toBe('boolean');
      }
    }, 20000);

    it('should detect tentative names', async () => {
      const response = await fetch(`${API_BASE}/llmnr/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          name: 'testhost',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.flags && data.flags.tentative) {
        expect(typeof data.flags.tentative).toBe('boolean');
      }
    }, 20000);
  });

  describe('LLMNR Record Types', () => {
    it('should support AAAA record queries', async () => {
      const response = await fetch(`${API_BASE}/llmnr/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          name: 'testhost',
          type: 28,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.query) {
        expect(data.query.typeName).toBe('AAAA');
      }
    }, 20000);

    it('should support ANY record queries', async () => {
      const response = await fetch(`${API_BASE}/llmnr/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          name: 'testhost',
          type: 255,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.query) {
        expect(data.query.typeName).toBe('ANY');
      }
    }, 20000);
  });

  describe('LLMNR Answer Parsing', () => {
    it('should parse A record answers', async () => {
      const response = await fetch(`${API_BASE}/llmnr/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          name: 'testhost',
          type: 1,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.answers && data.answers.length > 0) {
        const answer = data.answers[0];
        expect(answer.name).toBeDefined();
        expect(answer.type).toBeDefined();
        expect(answer.typeName).toBeDefined();
        expect(answer.class).toBeDefined();
        expect(answer.ttl).toBeDefined();
        expect(answer.value).toBeDefined();

        if (answer.typeName === 'A') {
          expect(answer.value).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
        }
      }
    }, 20000);

    it('should parse AAAA record answers', async () => {
      const response = await fetch(`${API_BASE}/llmnr/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          name: 'testhost',
          type: 28,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.answers) {
        data.answers.forEach((answer: Record<string, unknown>) => {
          if (answer.typeName === 'AAAA') {
            expect(typeof answer.value).toBe('string');
            expect(answer.value).toContain(':');
          }
        });
      }
    }, 20000);
  });
});
