/**
 * ZMTP Protocol Integration Tests
 *
 * Tests the ZMTP (ZeroMQ Message Transport Protocol) implementation.
 * ZMTP uses a binary greeting handshake on port 5555 (default).
 *
 * Note: Tests may fail without a reachable ZeroMQ endpoint.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('ZMTP Protocol Integration Tests', () => {
  describe('POST /api/zmtp/probe', () => {
    it('should probe a ZeroMQ endpoint', async () => {
      const response = await fetch(`${API_BASE}/zmtp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 5555,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.host).toBe('localhost');
        expect(data.port).toBe(5555);
        expect(data.rtt).toBeDefined();
        expect(data.protocol).toBe('ZMTP');
        if (data.isZMTP) {
          expect(data.version).toBeDefined();
          expect(data.mechanism).toBeDefined();
        }
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/zmtp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 5555,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/zmtp/probe`, {
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
      const response = await fetch(`${API_BASE}/zmtp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 5555,
          timeout: 1000,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 5000);
  });

  describe('POST /api/zmtp/handshake', () => {
    it('should attempt full handshake', async () => {
      const response = await fetch(`${API_BASE}/zmtp/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 5555,
          socketType: 'DEALER',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.host).toBe('localhost');
        expect(data.port).toBe(5555);
        expect(data.rtt).toBeDefined();
        expect(data.protocol).toBe('ZMTP');
        expect(data.isZMTP).toBe(true);
        expect(data.clientSocketType).toBe('DEALER');
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/zmtp/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 5555,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid socket type', async () => {
      const response = await fetch(`${API_BASE}/zmtp/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 5555,
          socketType: 'INVALID',
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid socket type');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/zmtp/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 99999,
          socketType: 'REQ',
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });
  });
});
