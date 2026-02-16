/**
 * OpenFlow Protocol Integration Tests
 *
 * Tests the OpenFlow SDN control protocol implementation.
 * OpenFlow uses a binary TCP protocol on port 6653 (legacy 6633).
 *
 * Note: Tests may fail without a reachable OpenFlow switch or controller.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('OpenFlow Protocol Integration Tests', () => {
  describe('POST /api/openflow/probe', () => {
    it('should probe an OpenFlow switch', async () => {
      const response = await fetch(`${API_BASE}/openflow/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 6653,
          version: 4,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.host).toBe('localhost');
        expect(data.port).toBe(6653);
        expect(data.rtt).toBeDefined();
        expect(data.protocol).toBe('OpenFlow');
        expect(data.serverVersionName).toBeDefined();
        expect(data.negotiatedVersion).toBeDefined();
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/openflow/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 6653,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/openflow/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 99999,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should handle connection timeout gracefully', async () => {
      const response = await fetch(`${API_BASE}/openflow/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 6653,
          timeout: 1000,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 5000);

    it('should support legacy port 6633', async () => {
      const response = await fetch(`${API_BASE}/openflow/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 6633,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.port).toBe(6633);
        expect(data.protocol).toBe('OpenFlow');
      }
    }, 10000);
  });

  describe('POST /api/openflow/echo', () => {
    it('should send echo request and measure RTT', async () => {
      const response = await fetch(`${API_BASE}/openflow/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 6653,
          version: 4,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.echoReceived).toBe(true);
        expect(data.echoRtt).toBeDefined();
        expect(data.rtt).toBeDefined();
        expect(data.protocol).toBe('OpenFlow');
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/openflow/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 6653,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/openflow/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 0,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });
  });
});
