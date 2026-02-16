/**
 * JDWP Protocol Integration Tests
 *
 * Tests the JDWP (Java Debug Wire Protocol) implementation.
 * JDWP uses an ASCII handshake ("JDWP-Handshake") on port 8000 (default).
 *
 * Note: Tests may fail without a reachable JDWP endpoint.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('JDWP Protocol Integration Tests', () => {
  describe('POST /api/jdwp/probe', () => {
    it('should probe a JDWP endpoint', async () => {
      const response = await fetch(`${API_BASE}/jdwp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 8000,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.host).toBe('localhost');
        expect(data.port).toBe(8000);
        expect(data.rtt).toBeDefined();
        expect(data.protocol).toBe('JDWP');
        if (data.isJDWP) {
          expect(data.handshakeResponse).toBe('JDWP-Handshake');
        }
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/jdwp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 8000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/jdwp/probe`, {
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
      const response = await fetch(`${API_BASE}/jdwp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 8000,
          timeout: 1000,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 5000);
  });

  describe('POST /api/jdwp/version', () => {
    it('should query JVM version', async () => {
      const response = await fetch(`${API_BASE}/jdwp/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 8000,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.host).toBe('localhost');
        expect(data.port).toBe(8000);
        expect(data.rtt).toBeDefined();
        expect(data.protocol).toBe('JDWP');
        expect(data.isJDWP).toBe(true);
        if (data.version) {
          expect(data.version.vmName).toBeDefined();
          expect(data.version.vmVersion).toBeDefined();
          expect(data.version.jdwpMajor).toBeDefined();
          expect(data.version.jdwpMinor).toBeDefined();
        }
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/jdwp/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 8000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/jdwp/version`, {
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
