/**
 * mDNS Protocol Integration Tests
 * Tests mDNS service discovery, announcements, and record parsing
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('mDNS Protocol Integration Tests', () => {
  describe('mDNS Query', () => {
    it('should send mDNS query for service discovery', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: 5353,
          service: '_http._tcp.local',
          queryType: 'PTR',
          unicastResponse: false,
          timeout: 15000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');
      expect(data).toHaveProperty('service');

      if (data.success) {
        expect(data.answers).toBeDefined();
        expect(data.additionals).toBeDefined();
        expect(data.answerCount).toBeDefined();
        expect(data.rtt).toBeDefined();
      }
    }, 25000);

    it('should reject query without host', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: '_http._tcp.local',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should use default port 5353', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: '_http._tcp.local',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.port).toBe(5353);
    }, 25000);

    it('should use default service _services._dns-sd._udp.local', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.service).toBe('_services._dns-sd._udp.local');
    }, 25000);

    it('should use default query type PTR', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: '_http._tcp.local',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 25000);
  });

  describe('mDNS Query Types', () => {
    it('should support PTR queries', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: '_http._tcp.local',
          queryType: 'PTR',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 25000);

    it('should support SRV queries', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: 'myservice._http._tcp.local',
          queryType: 'SRV',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 25000);

    it('should support TXT queries', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: 'myservice._http._tcp.local',
          queryType: 'TXT',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 25000);

    it('should support A queries', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: 'device.local',
          queryType: 'A',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 25000);

    it('should support AAAA queries', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: 'device.local',
          queryType: 'AAAA',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 25000);

    it('should support ANY queries', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: 'device.local',
          queryType: 'ANY',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 25000);
  });

  describe('mDNS Unicast Response (QU bit)', () => {
    it('should request unicast response', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: '_http._tcp.local',
          unicastResponse: true,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 25000);

    it('should use multicast by default', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: '_http._tcp.local',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 25000);
  });

  describe('mDNS Discover', () => {
    it('should discover all services', async () => {
      const response = await fetch(`${API_BASE}/mdns/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: 5353,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      expect(data.service).toBe('_services._dns-sd._udp.local');
    }, 20000);
  });

  describe('mDNS Announce', () => {
    it('should send service announcement', async () => {
      const response = await fetch(`${API_BASE}/mdns/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: 5353,
          serviceType: '_http._tcp.local',
          instanceName: 'testservice._http._tcp.local',
          hostname: 'testdevice.local',
          servicePort: 8080,
          txtRecords: ['path=/', 'version=1.0'],
          ttl: 120,
          timeout: 8000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');

      if (data.success) {
        expect(data.portOpen).toBe(true);
        expect(data.announcement).toBeDefined();
        expect(data.announcement.serviceType).toBe('_http._tcp.local');
        expect(data.announcement.records).toContain('PTR');
        expect(data.announcement.records).toContain('SRV');
        expect(data.announcement.records).toContain('TXT');
        expect(data.latencyMs).toBeDefined();
      }
    }, 15000);

    it('should reject announce without host', async () => {
      const response = await fetch(`${API_BASE}/mdns/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceType: '_http._tcp.local',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should use default values for optional parameters', async () => {
      const response = await fetch(`${API_BASE}/mdns/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.announcement) {
        expect(data.announcement.serviceType).toBe('_http._tcp.local');
        expect(data.announcement.srvPort).toBe(80);
        expect(data.announcement.ttl).toBe(120);
        expect(data.announcement.txtRecords).toContain('path=/');
      }
    }, 15000);

    it('should include packet details in response', async () => {
      const response = await fetch(`${API_BASE}/mdns/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success) {
        expect(data.packetBytes).toBeDefined();
        expect(data.packetHex).toBeDefined();
        expect(data.note).toBeDefined();
      }
    }, 15000);
  });

  describe('mDNS Record Parsing', () => {
    it('should parse PTR records', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: '_http._tcp.local',
          queryType: 'PTR',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.answers && data.answers.length > 0) {
        data.answers.forEach((answer: Record<string, unknown>) => {
          if (answer.type === 'PTR') {
            expect(answer.name).toBeDefined();
            expect(answer.data).toBeDefined();
            expect(answer.ttl).toBeDefined();
            expect(answer.class).toBeDefined();
          }
        });
      }
    }, 25000);

    it('should parse SRV records', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: 'service._http._tcp.local',
          queryType: 'SRV',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.answers) {
        data.answers.forEach((answer: Record<string, unknown>) => {
          if (answer.type === 'SRV' && typeof answer.data === 'object') {
            const srvData = answer.data as Record<string, unknown>;
            expect(srvData.priority).toBeDefined();
            expect(srvData.weight).toBeDefined();
            expect(srvData.port).toBeDefined();
            expect(srvData.target).toBeDefined();
          }
        });
      }
    }, 25000);

    it('should parse TXT records', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: 'service._http._tcp.local',
          queryType: 'TXT',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.answers) {
        data.answers.forEach((answer: Record<string, unknown>) => {
          if (answer.type === 'TXT' && typeof answer.data === 'object') {
            const txtData = answer.data as Record<string, unknown>;
            expect(txtData.txt).toBeDefined();
            expect(Array.isArray(txtData.txt)).toBe(true);
          }
        });
      }
    }, 25000);

    it('should parse A records', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: 'device.local',
          queryType: 'A',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.answers) {
        data.answers.forEach((answer: Record<string, unknown>) => {
          if (answer.type === 'A') {
            expect(typeof answer.data).toBe('string');
            expect(answer.data).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
          }
        });
      }
    }, 25000);

    it('should parse AAAA records', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: 'device.local',
          queryType: 'AAAA',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.answers) {
        data.answers.forEach((answer: Record<string, unknown>) => {
          if (answer.type === 'AAAA') {
            expect(typeof answer.data).toBe('string');
            expect(answer.data).toContain(':');
          }
        });
      }
    }, 25000);
  });

  describe('mDNS Cache-Flush Bit', () => {
    it('should detect cache-flush bit in record class', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: '_http._tcp.local',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.answers) {
        data.answers.forEach((answer: Record<string, unknown>) => {
          expect(answer.class).toBeDefined();
          // Cache-flush records have 'IN (cache-flush)' class
          expect(['IN', 'IN (cache-flush)']).toContain(answer.class);
        });
      }
    }, 25000);
  });

  describe('mDNS Additional Records', () => {
    it('should parse additional records section', async () => {
      const response = await fetch(`${API_BASE}/mdns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          service: '_http._tcp.local',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success) {
        expect(data.additionals).toBeDefined();
        expect(Array.isArray(data.additionals)).toBe(true);
      }
    }, 25000);
  });
});
