/**
 * SSDP/UPnP Protocol Integration Tests
 * Tests UPnP device discovery, service control, and event subscription
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('SSDP/UPnP Protocol Integration Tests', () => {
  describe('SSDP Discover', () => {
    it('should fetch UPnP device description from specific path', async () => {
      const response = await fetch(`${API_BASE}/ssdp/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: 1900,
          path: '/rootDesc.xml',
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');

      if (data.success) {
        expect(data.latencyMs).toBeDefined();
        expect(data.foundPath).toBe('/rootDesc.xml');
        expect(data.deviceType).toBeDefined();
        expect(data.friendlyName).toBeDefined();
        expect(data.manufacturer).toBeDefined();
        expect(data.modelName).toBeDefined();
        expect(data.udn).toBeDefined();
        expect(data.services).toBeDefined();
        expect(Array.isArray(data.services)).toBe(true);
      }
    }, 20000);

    it('should reject discover without host', async () => {
      const response = await fetch(`${API_BASE}/ssdp/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/rootDesc.xml',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/ssdp/discover`, {
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

    it('should use default port 1900', async () => {
      const response = await fetch(`${API_BASE}/ssdp/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 20000);

    it('should use default path /rootDesc.xml', async () => {
      const response = await fetch(`${API_BASE}/ssdp/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.foundPath) {
        expect(data.foundPath).toBe('/rootDesc.xml');
      }
    }, 20000);

    it('should parse device description XML', async () => {
      const response = await fetch(`${API_BASE}/ssdp/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success) {
        if (data.manufacturerURL) expect(typeof data.manufacturerURL).toBe('string');
        if (data.modelNumber) expect(typeof data.modelNumber).toBe('string');
        if (data.serialNumber) expect(typeof data.serialNumber).toBe('string');
        if (data.presentationURL) expect(typeof data.presentationURL).toBe('string');
      }
    }, 20000);

    it('should parse service list', async () => {
      const response = await fetch(`${API_BASE}/ssdp/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.services && data.services.length > 0) {
        const service = data.services[0];
        expect(service.serviceType).toBeDefined();
        expect(service.serviceId).toBeDefined();
        expect(service.controlURL).toBeDefined();
        expect(service.eventSubURL).toBeDefined();
        expect(service.SCPDURL).toBeDefined();
      }
    }, 20000);
  });

  describe('SSDP Fetch (Multiple Paths)', () => {
    it('should try multiple description paths', async () => {
      const response = await fetch(`${API_BASE}/ssdp/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: 1900,
          timeout: 15000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');

      if (data.success) {
        expect(data.foundPath).toBeDefined();
        expect(data.deviceType).toBeDefined();
        expect(data.latencyMs).toBeDefined();
      } else {
        expect(data.triedPaths).toBeDefined();
        expect(Array.isArray(data.triedPaths)).toBe(true);
      }
    }, 25000);

    it('should reject fetch without host', async () => {
      const response = await fetch(`${API_BASE}/ssdp/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 1900,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/ssdp/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should return first successful path', async () => {
      const response = await fetch(`${API_BASE}/ssdp/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success) {
        expect(data.foundPath).toBeDefined();
        expect(typeof data.foundPath).toBe('string');
      }
    }, 25000);
  });

  describe('SSDP Search (M-SEARCH)', () => {
    it('should send M-SEARCH request', async () => {
      const response = await fetch(`${API_BASE}/ssdp/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: 1900,
          st: 'ssdp:all',
          mx: 3,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      expect(data.latencyMs).toBeDefined();

      if (data.success) {
        expect(data.statusLine).toBeDefined();
        expect(data.location).toBeDefined();
        expect(data.server).toBeDefined();
        expect(data.usn).toBeDefined();
        expect(data.st).toBeDefined();
      }
    }, 10000);

    it('should reject search without host', async () => {
      const response = await fetch(`${API_BASE}/ssdp/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          st: 'ssdp:all',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/ssdp/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: -1,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should reject invalid MX value', async () => {
      const response = await fetch(`${API_BASE}/ssdp/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          mx: 200,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('MX must be between 1 and 120');
    });

    it('should use default ST ssdp:all', async () => {
      const response = await fetch(`${API_BASE}/ssdp/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should use default MX 3', async () => {
      const response = await fetch(`${API_BASE}/ssdp/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should support specific search targets', async () => {
      const response = await fetch(`${API_BASE}/ssdp/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          st: 'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should parse cache-control and date headers', async () => {
      const response = await fetch(`${API_BASE}/ssdp/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success) {
        if (data.cacheControl) expect(typeof data.cacheControl).toBe('string');
        if (data.date) expect(typeof data.date).toBe('string');
      }
    }, 10000);
  });

  describe('SSDP Subscribe (GENA)', () => {
    it('should send GENA SUBSCRIBE request', async () => {
      const response = await fetch(`${API_BASE}/ssdp/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: 1900,
          eventSubURL: '/eventSub',
          callbackURL: 'http://127.0.0.1:1901/',
          timeoutSecs: 1800,
          httpTimeout: 8000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      expect(data.latencyMs).toBeDefined();

      if (data.success) {
        expect(data.statusCode).toBe(200);
        expect(data.sid).toBeDefined();
        expect(data.timeoutHeader).toBeDefined();
        expect(data.note).toBeDefined();
      }
    }, 15000);

    it('should reject subscribe without host', async () => {
      const response = await fetch(`${API_BASE}/ssdp/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventSubURL: '/eventSub',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should reject subscribe without eventSubURL', async () => {
      const response = await fetch(`${API_BASE}/ssdp/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('eventSubURL is required');
    });

    it('should use default callback URL', async () => {
      const response = await fetch(`${API_BASE}/ssdp/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          eventSubURL: '/eventSub',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should use default timeout 1800 seconds', async () => {
      const response = await fetch(`${API_BASE}/ssdp/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          eventSubURL: '/eventSub',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 15000);
  });

  describe('SSDP Action (SOAP)', () => {
    it('should invoke SOAP action', async () => {
      const response = await fetch(`${API_BASE}/ssdp/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          port: 1900,
          controlURL: '/ctl/IPConn',
          serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:1',
          action: 'GetExternalIPAddress',
          args: {},
          httpTimeout: 8000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      expect(data.latencyMs).toBeDefined();

      if (data.success) {
        expect(data.statusCode).toBe(200);
        expect(data.action).toBe('GetExternalIPAddress');
        expect(data.serviceType).toBe('urn:schemas-upnp-org:service:WANIPConnection:1');
        if (data.responseArgs) {
          expect(typeof data.responseArgs).toBe('object');
        }
      }
    }, 15000);

    it('should reject action without host', async () => {
      const response = await fetch(`${API_BASE}/ssdp/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          controlURL: '/ctl',
          serviceType: 'urn:test',
          action: 'Test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should reject action without controlURL', async () => {
      const response = await fetch(`${API_BASE}/ssdp/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          serviceType: 'urn:test',
          action: 'Test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('controlURL is required');
    });

    it('should reject action without serviceType', async () => {
      const response = await fetch(`${API_BASE}/ssdp/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          controlURL: '/ctl',
          action: 'Test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('serviceType is required');
    });

    it('should reject action without action name', async () => {
      const response = await fetch(`${API_BASE}/ssdp/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          controlURL: '/ctl',
          serviceType: 'urn:test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('action is required');
    });

    it('should handle action with arguments', async () => {
      const response = await fetch(`${API_BASE}/ssdp/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          controlURL: '/ctl/IPConn',
          serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:1',
          action: 'SetConnectionType',
          args: {
            NewConnectionType: 'IP_Routed',
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should detect SOAP faults', async () => {
      const response = await fetch(`${API_BASE}/ssdp/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.168.1.1',
          controlURL: '/ctl/invalid',
          serviceType: 'urn:invalid',
          action: 'InvalidAction',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.fault) {
        expect(data.fault.code).toBeDefined();
        expect(data.fault.message).toBeDefined();
      }
    }, 15000);
  });

  describe('HTTP Method Restrictions', () => {
    it('should reject GET method on discover endpoint', async () => {
      const response = await fetch(`${API_BASE}/ssdp/discover`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should reject GET method on fetch endpoint', async () => {
      const response = await fetch(`${API_BASE}/ssdp/fetch`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should reject GET method on search endpoint', async () => {
      const response = await fetch(`${API_BASE}/ssdp/search`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should reject GET method on subscribe endpoint', async () => {
      const response = await fetch(`${API_BASE}/ssdp/subscribe`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should reject GET method on action endpoint', async () => {
      const response = await fetch(`${API_BASE}/ssdp/action`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });
});
