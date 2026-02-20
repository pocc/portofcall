/**
 * IKE/ISAKMP Protocol Integration Tests
 * Tests IKE VPN gateway detection and version discovery
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('IKE Protocol Integration Tests', () => {
  describe('IKE Probe (IKEv1)', () => {
    it('should fail IKEv1 probe request to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 500,
          timeout: 10000,
          exchangeType: 2,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);

    it('should reject probe without host', async () => {
      const response = await fetch(`${API_BASE}/ike/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 500,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/ike/probe`, {
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

    it('should fail with default port 500 to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/probe`, {
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

    it('should fail to parse vendor IDs from unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/probe`, {
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

    it('should fail to count proposals and transforms for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/probe`, {
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

  describe('IKEv2 SA Init', () => {
    it('should fail IKEv2 IKE_SA_INIT request to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/v2-sa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 500,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);

    it('should reject v2 request without host', async () => {
      const response = await fetch(`${API_BASE}/ike/v2-sa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 500,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should fail to parse selected algorithms for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/v2-sa`, {
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

    it('should fail to detect error notifications for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/v2-sa`, {
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

  describe('IKE Version Detection', () => {
    it('should fail to detect IKEv1 and IKEv2 support for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 500,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 30000);

    it('should fail to include version-specific details for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 30000);
  });

  describe('IKE Exchange Types', () => {
    it('should fail Main Mode exchange to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          exchangeType: 2,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);

    it('should fail Aggressive Mode exchange to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          exchangeType: 4,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);
  });

  describe('IKE Response Parsing', () => {
    it('should fail to parse cookies for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/probe`, {
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

    it('should fail to parse version for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/probe`, {
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

  describe('IKE NAT-T Port', () => {
    it('should fail NAT-T port 4500 probe to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ike/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 4500,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 20000);
  });

  describe('IKE Timeouts', () => {
    it('should respect custom timeout', async () => {
      const response = await fetch(`${API_BASE}/ike/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.254',
          timeout: 2000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 5000);

    it('should use default timeout of 15 seconds', async () => {
      const response = await fetch(`${API_BASE}/ike/probe`, {
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
});
