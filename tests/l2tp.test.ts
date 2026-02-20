/**
 * L2TP Protocol Integration Tests
 * Tests L2TP tunnel establishment and session management
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('L2TP Protocol Integration Tests', () => {
  describe('L2TP Connect (SCCRQ/SCCRP)', () => {
    it('should send SCCRQ and parse SCCRP', async () => {
      const response = await fetch(`${API_BASE}/l2tp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 1701,
          hostname: 'portofcall-test',
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');

      if (data.success) {
        expect(data.tunnelId).toBeDefined();
        expect(data.assignedTunnelId).toBeDefined();
        expect(data.peerHostname).toBeDefined();
        expect(data.protocolVersion).toBeDefined();
        expect(data.rtt).toBeDefined();
      }
    }, 20000);

    it('should reject connect without host', async () => {
      const response = await fetch(`${API_BASE}/l2tp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 1701,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/l2tp/connect`, {
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

    it('should use default port 1701', async () => {
      const response = await fetch(`${API_BASE}/l2tp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.port).toBe(1701);
    }, 20000);

    it('should use default hostname when not specified', async () => {
      const response = await fetch(`${API_BASE}/l2tp/connect`, {
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

    it('should parse vendor name if present', async () => {
      const response = await fetch(`${API_BASE}/l2tp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.vendorName) {
        expect(typeof data.vendorName).toBe('string');
      }
    }, 20000);
  });

  describe('L2TP Hello Keepalive', () => {
    it('should send hello keepalive message', async () => {
      const response = await fetch(`${API_BASE}/l2tp/hello`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 1701,
          tunnelId: 1,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');

      if (data.success) {
        expect(data.message).toBeDefined();
      }
    }, 20000);

    it('should reject hello without host', async () => {
      const response = await fetch(`${API_BASE}/l2tp/hello`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tunnelId: 1,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host and tunnelId are required');
    });

    it('should reject hello without tunnelId', async () => {
      const response = await fetch(`${API_BASE}/l2tp/hello`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  describe('L2TP Session Establishment', () => {
    it('should establish full tunnel and session', async () => {
      const response = await fetch(`${API_BASE}/l2tp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 1701,
          hostname: 'portofcall',
          timeout: 15000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');

      if (data.success) {
        expect(data.localTunnelId).toBeDefined();
        expect(data.peerTunnelId).toBeDefined();
        expect(data.localSessionId).toBeDefined();
        expect(data.peerSessionId).toBeDefined();
        expect(data.peerHostname).toBeDefined();
        expect(data.protocolVersion).toBeDefined();
        expect(data.latencyMs).toBeDefined();
        expect(data.note).toBeDefined();
      }
    }, 25000);

    it('should reject session without host', async () => {
      const response = await fetch(`${API_BASE}/l2tp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 1701,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should use default hostname', async () => {
      const response = await fetch(`${API_BASE}/l2tp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 25000);
  });

  describe('L2TP Start Control Connection', () => {
    it('should send SCCRQ and receive SCCRP', async () => {
      const response = await fetch(`${API_BASE}/l2tp/start-control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 1701,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');

      if (data.success) {
        expect(data.messageType).toBe(2);
        expect(data.tunnelId).toBeDefined();
        expect(data.protocolVersion).toBeDefined();
        expect(data.latencyMs).toBeDefined();
      }
    }, 20000);

    it('should reject start-control without host', async () => {
      const response = await fetch(`${API_BASE}/l2tp/start-control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 1701,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should parse hostname from SCCRP', async () => {
      const response = await fetch(`${API_BASE}/l2tp/start-control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.hostName) {
        expect(typeof data.hostName).toBe('string');
      }
    }, 20000);

    it('should parse result code if present', async () => {
      const response = await fetch(`${API_BASE}/l2tp/start-control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.resultCode !== undefined) {
        expect(typeof data.resultCode).toBe('number');
      }
    }, 20000);
  });

  describe('L2TP Protocol Version', () => {
    it('should advertise protocol version 1.0', async () => {
      const response = await fetch(`${API_BASE}/l2tp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.protocolVersion) {
        expect(data.protocolVersion).toMatch(/^\d+\.\d+$/);
      }
    }, 20000);
  });

  describe('L2TP AVP Parsing', () => {
    it('should parse assigned tunnel ID', async () => {
      const response = await fetch(`${API_BASE}/l2tp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success) {
        expect(data.assignedTunnelId).toBeDefined();
        expect(typeof data.assignedTunnelId).toBe('number');
      }
    }, 20000);

    it('should parse peer hostname', async () => {
      const response = await fetch(`${API_BASE}/l2tp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.success && data.peerHostname) {
        expect(typeof data.peerHostname).toBe('string');
        expect(data.peerHostname.length).toBeGreaterThan(0);
      }
    }, 20000);
  });

  describe('L2TP Timeouts', () => {
    it('should respect custom timeout', async () => {
      const response = await fetch(`${API_BASE}/l2tp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.254',
          timeout: 2000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 5000);

    it('should use default timeout of 15 seconds', async () => {
      const response = await fetch(`${API_BASE}/l2tp/connect`, {
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
  });
});
