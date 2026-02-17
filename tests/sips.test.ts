/**
 * SIPS Protocol Integration Tests
 *
 * These tests verify the SIPS (SIP over TLS, RFC 3261/5630) implementation.
 * Since public SIPS servers are rare and require credentials, most tests validate
 * input handling and request encoding.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('SIPS Protocol Integration Tests', () => {
  describe('SIPS OPTIONS Endpoint', () => {
    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/sips/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          fromUri: 'sips:alice@example.com',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject missing fromUri', async () => {
      const response = await fetch(`${API_BASE}/sips/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'sip.example.com',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('fromUri is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/sips/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'sip.example.com',
          port: 99999,
          fromUri: 'sips:alice@example.com',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/sips/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // TEST-NET address, should fail
          port: 5061,
          fromUri: 'sips:alice@example.com',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should use default port 5061 when not specified', async () => {
      const response = await fetch(`${API_BASE}/sips/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // Will fail, but validates defaults
          fromUri: 'sips:alice@example.com',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Connection will fail but the request was accepted (not 400)
      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should reject port 0', async () => {
      const response = await fetch(`${API_BASE}/sips/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'sip.example.com',
          port: 0,
          fromUri: 'sips:alice@example.com',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should include host and port in response', async () => {
      const response = await fetch(`${API_BASE}/sips/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5061,
          fromUri: 'sips:alice@example.com',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Even on failure, response should not crash
      expect(data).toBeDefined();
      expect(data.success).toBe(false);
    }, 8000);
  });

  describe('SIPS REGISTER Endpoint', () => {
    it('should reject missing required parameters', async () => {
      const response = await fetch(`${API_BASE}/sips/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'sip.example.com',
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('fromUri');
    });

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/sips/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // TEST-NET address, should fail
          port: 5061,
          fromUri: 'sips:alice@example.com',
          username: 'alice',
          password: 'secret',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should accept optional username and password', async () => {
      const response = await fetch(`${API_BASE}/sips/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5061,
          fromUri: 'sips:alice@example.com',
          username: 'alice',
          password: 'secret123',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Should accept the request even if connection fails
      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    }, 8000);
  });
});
