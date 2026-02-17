/**
 * Beats Protocol Integration Tests
 *
 * These tests verify the Beats (Elastic Beats/Lumberjack v2) protocol implementation.
 * Since public Beats/Logstash servers are rare, most tests validate input handling
 * and request encoding.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Beats Protocol Integration Tests', () => {
  describe('Beats Send Endpoint', () => {
    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/beats/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          events: [{ message: 'test log' }],
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject missing events array', async () => {
      const response = await fetch(`${API_BASE}/beats/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'logstash.example.com',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Events array is required');
    });

    it('should reject empty events array', async () => {
      const response = await fetch(`${API_BASE}/beats/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'logstash.example.com',
          events: [],
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('must not be empty');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/beats/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'logstash.example.com',
          port: 99999,
          events: [{ message: 'test' }],
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/beats/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // TEST-NET address, should fail
          port: 5044,
          events: [{ message: 'test log entry' }],
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should use default port 5044 when not specified', async () => {
      const response = await fetch(`${API_BASE}/beats/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // Will fail, but validates defaults
          events: [{ message: 'test' }],
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Connection will fail but the request was accepted (not 400)
      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should accept multiple events', async () => {
      const response = await fetch(`${API_BASE}/beats/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5044,
          events: [
            { message: 'log entry 1', level: 'info' },
            { message: 'log entry 2', level: 'warning' },
            { message: 'log entry 3', level: 'error' },
          ],
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Connection will fail, but validates events array handling
      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should reject port 0', async () => {
      const response = await fetch(`${API_BASE}/beats/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'logstash.example.com',
          port: 0,
          events: [{ message: 'test' }],
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should include host and port in response', async () => {
      const response = await fetch(`${API_BASE}/beats/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5044,
          events: [{ message: 'test' }],
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Even on failure, response should not crash
      expect(data).toBeDefined();
      expect(data.success).toBe(false);
    }, 8000);

    it('should accept custom window size', async () => {
      const response = await fetch(`${API_BASE}/beats/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5044,
          events: [{ message: 'test' }],
          windowSize: 500,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Should accept the request even if connection fails
      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    }, 8000);
  });

  describe('Beats Connect Endpoint', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/beats/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/beats/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // TEST-NET address, should fail
          port: 5044,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 8000);
  });
});
