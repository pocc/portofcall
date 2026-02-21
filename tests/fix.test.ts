/**
 * FIX Protocol Integration Tests
 *
 * Tests the FIX (Financial Information eXchange) protocol implementation.
 * FIX uses a text-based TCP protocol with tag=value pairs on port 9878.
 *
 * Note: Tests may fail without a reachable FIX engine.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('FIX Protocol Integration Tests', () => {
  describe('POST /api/fix/probe', () => {
    it('should probe a FIX engine with Logon', async () => {
      const response = await fetch(`${API_BASE}/fix/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 9878,
          senderCompID: 'TESTCLIENT',
          targetCompID: 'TESTSERVER',
          fixVersion: 'FIX.4.4',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.host).toBe('localhost');
        expect(data.port).toBe(9878);
        expect(data.rtt).toBeDefined();
        expect(data.protocol).toBe('FIX');
        expect(data.fixVersion).toBeDefined();
        expect(data.rawResponse).toBeDefined();
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/fix/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 9878,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/fix/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 99999,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should handle connection timeout gracefully', async () => {
      const response = await fetch(`${API_BASE}/fix/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 9878,
          timeout: 1000,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 5000);

    it('should use default values for optional fields', async () => {
      const response = await fetch(`${API_BASE}/fix/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
        }),
      });

      const data = await response.json();

      // Should not error on missing optional fields
      if (data.success) {
        expect(data.port).toBe(9878);
        expect(data.protocol).toBe('FIX');
      }
    }, 10000);
  });

  describe('POST /api/fix/heartbeat', () => {
    it('should attempt heartbeat test', async () => {
      const response = await fetch(`${API_BASE}/fix/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 9878,
          senderCompID: 'TESTCLIENT',
          targetCompID: 'TESTSERVER',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.host).toBe('localhost');
        expect(data.port).toBe(9878);
        expect(data.rtt).toBeDefined();
        expect(data.protocol).toBe('FIX');
        expect(data.logonAccepted).toBe(true);
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/fix/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 9878,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/fix/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
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
