/**
 * HSRP Protocol Integration Tests
 * Tests HSRP router discovery and state detection
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('HSRP Protocol Integration Tests', () => {
  describe('HSRP Probe', () => {
    it('should fail HSRP probe to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 1985,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);

    it('should reject probe without host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 1985,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/hsrp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should use default port 1985', async () => {
      const response = await fetch(`${API_BASE}/hsrp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);
  });

  describe('HSRP Listen', () => {
    it('should fail HSRP listen request to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/listen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 1985,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);
  });

  describe('HSRP Coup', () => {
    it('should fail HSRP Coup message to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/coup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 1985,
          group: 0,
          priority: 255,
          authentication: 'cisco',
          timeout: 10000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);

    it('should reject coup without host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/coup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group: 0,
          priority: 255,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('host is required');
    });

    it('should fail with default values for optional parameters to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/coup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);
  });

  describe('HSRPv2 Probe', () => {
    it('should fail HSRPv2 probe to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/v2-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 1985,
          group: 0,
          priority: 50,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);

    it('should reject v2-probe without host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/v2-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('host is required');
    });

    it('should fail HSRPv2 probe with extended group numbers to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/v2-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 1985,
          group: 100,
          priority: 100,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);
  });

  describe('HSRP State Detection', () => {
    it('should fail to identify router states for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);

    it('should fail to identify op codes for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);
  });

  describe('HSRP Authentication', () => {
    it('should fail probe with authentication to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);

    it('should fail coup with custom authentication to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/coup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          authentication: 'testpass',
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);
  });

  describe('HSRP Group Numbers', () => {
    it('should fail with different group numbers to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/coup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          group: 10,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);

    it('should fail HSRPv2 extended group numbers to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/hsrp/v2-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          group: 4095,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);
  });
});
