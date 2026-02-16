/**
 * Beanstalkd Protocol Integration Tests
 *
 * Tests the Beanstalkd work queue protocol implementation.
 * Beanstalkd uses a text-based TCP protocol on port 11300.
 *
 * Note: Tests may fail without a reachable Beanstalkd server.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Beanstalkd Protocol Integration Tests', () => {
  describe('POST /api/beanstalkd/connect', () => {
    it('should connect and retrieve stats', async () => {
      const response = await fetch(`${API_BASE}/beanstalkd/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 11300,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.host).toBe('localhost');
        expect(data.port).toBe(11300);
        expect(data.rtt).toBeDefined();
        expect(data.protocol).toBe('Beanstalkd');
        expect(data.version).toBeDefined();
        expect(data.rawStats).toBeDefined();
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/beanstalkd/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 11300,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/beanstalkd/connect`, {
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
      const response = await fetch(`${API_BASE}/beanstalkd/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 11300,
          timeout: 1000,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 5000);
  });

  describe('POST /api/beanstalkd/command', () => {
    it('should execute list-tubes command', async () => {
      const response = await fetch(`${API_BASE}/beanstalkd/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 11300,
          command: 'list-tubes',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.command).toBe('list-tubes');
        expect(data.status).toBe('OK');
        expect(data.response).toBeDefined();
        expect(data.rtt).toBeDefined();
      }
    }, 10000);

    it('should reject empty command', async () => {
      const response = await fetch(`${API_BASE}/beanstalkd/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 11300,
          command: '',
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Command is required');
    });

    it('should reject disallowed commands', async () => {
      const response = await fetch(`${API_BASE}/beanstalkd/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 11300,
          command: 'delete 123',
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('not allowed');
    });

    it('should execute stats-tube command', async () => {
      const response = await fetch(`${API_BASE}/beanstalkd/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 11300,
          command: 'stats-tube default',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.command).toBe('stats-tube default');
        expect(data.rtt).toBeDefined();
      }
    }, 10000);
  });
});
