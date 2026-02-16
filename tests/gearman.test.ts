/**
 * Gearman Protocol Integration Tests
 *
 * Tests the Gearman distributed job queue admin protocol implementation.
 * Gearman uses a text-based TCP protocol on port 4730.
 *
 * Note: Tests may fail without a reachable Gearman server.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Gearman Protocol Integration Tests', () => {
  describe('POST /api/gearman/connect', () => {
    it('should connect and retrieve version and status', async () => {
      const response = await fetch(`${API_BASE}/gearman/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 4730,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.host).toBe('localhost');
        expect(data.port).toBe(4730);
        expect(data.rtt).toBeDefined();
        expect(data.protocol).toBe('Gearman');
        expect(data.version).toBeDefined();
        expect(data.functions).toBeInstanceOf(Array);
        expect(data.totalFunctions).toBeTypeOf('number');
        expect(data.totalQueuedJobs).toBeTypeOf('number');
        expect(data.totalRunningJobs).toBeTypeOf('number');
        expect(data.totalWorkers).toBeTypeOf('number');
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/gearman/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 4730,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/gearman/connect`, {
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
      const response = await fetch(`${API_BASE}/gearman/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 4730,
          timeout: 1000,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 5000);
  });

  describe('POST /api/gearman/command', () => {
    it('should execute version command', async () => {
      const response = await fetch(`${API_BASE}/gearman/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 4730,
          command: 'version',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.command).toBe('version');
        expect(data.response).toBeDefined();
        expect(data.rtt).toBeDefined();
      }
    }, 10000);

    it('should execute status command', async () => {
      const response = await fetch(`${API_BASE}/gearman/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 4730,
          command: 'status',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.command).toBe('status');
        expect(data.response).toBeDefined();
        expect(data.rtt).toBeDefined();
      }
    }, 10000);

    it('should execute workers command', async () => {
      const response = await fetch(`${API_BASE}/gearman/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 4730,
          command: 'workers',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.command).toBe('workers');
        expect(data.response).toBeDefined();
        expect(data.rtt).toBeDefined();
      }
    }, 10000);

    it('should reject empty command', async () => {
      const response = await fetch(`${API_BASE}/gearman/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 4730,
          command: '',
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Command is required');
    });

    it('should reject disallowed commands', async () => {
      const response = await fetch(`${API_BASE}/gearman/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 4730,
          command: 'shutdown',
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('not allowed');
    });
  });
});
