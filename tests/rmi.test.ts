/**
 * Java RMI Protocol Integration Tests
 *
 * Tests the RMI (Remote Method Invocation) implementation.
 * RMI uses the JRMI wire protocol on port 1099 (default).
 *
 * Note: Tests may fail without a reachable RMI registry endpoint.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('RMI Protocol Integration Tests', () => {
  describe('POST /api/rmi/probe', () => {
    it('should probe an RMI endpoint', async () => {
      const response = await fetch(`${API_BASE}/rmi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 1099,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.host).toBe('localhost');
        expect(data.port).toBe(1099);
        expect(data.rtt).toBeDefined();
        expect(data.protocol).toBe('RMI');
        if (data.isRMI) {
          expect(data.protocolAck).toBe(true);
        }
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/rmi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 1099,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/rmi/probe`, {
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
      const response = await fetch(`${API_BASE}/rmi/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 1099,
          timeout: 1000,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 5000);
  });

  describe('POST /api/rmi/list', () => {
    it('should attempt to list registry bindings', async () => {
      const response = await fetch(`${API_BASE}/rmi/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 1099,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.host).toBe('localhost');
        expect(data.port).toBe(1099);
        expect(data.rtt).toBeDefined();
        expect(data.protocol).toBe('RMI');
        expect(data.isRMI).toBe(true);
        expect(data.listAttempted).toBe(true);
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/rmi/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 1099,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/rmi/list`, {
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
  });
});
