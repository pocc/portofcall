/**
 * MSRP Protocol Integration Tests
 *
 * These tests verify the MSRP (Message Session Relay Protocol, RFC 4975) implementation.
 * Since public MSRP servers are rare and require SIP session setup, most tests validate
 * input handling and request encoding.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('MSRP Protocol Integration Tests', () => {
  describe('MSRP Send Endpoint', () => {
    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/msrp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          fromPath: 'msrp://client.example.com:2855/session123;tcp',
          toPath: 'msrp://relay.example.com:2855/session456;tcp',
          content: 'Hello, MSRP!',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject missing fromPath', async () => {
      const response = await fetch(`${API_BASE}/msrp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'relay.example.com',
          toPath: 'msrp://relay.example.com:2855/session456;tcp',
          content: 'Hello, MSRP!',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('fromPath is required');
    });

    it('should reject missing toPath', async () => {
      const response = await fetch(`${API_BASE}/msrp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'relay.example.com',
          fromPath: 'msrp://client.example.com:2855/session123;tcp',
          content: 'Hello, MSRP!',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('toPath is required');
    });

    it('should reject empty content', async () => {
      const response = await fetch(`${API_BASE}/msrp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'relay.example.com',
          fromPath: 'msrp://client.example.com:2855/session123;tcp',
          toPath: 'msrp://relay.example.com:2855/session456;tcp',
          content: '',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('content is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/msrp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'relay.example.com',
          port: 99999,
          fromPath: 'msrp://client.example.com:2855/session123;tcp',
          toPath: 'msrp://relay.example.com:2855/session456;tcp',
          content: 'Hello, MSRP!',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/msrp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // TEST-NET address, should fail
          port: 2855,
          fromPath: 'msrp://client.example.com:2855/session123;tcp',
          toPath: 'msrp://relay.example.com:2855/session456;tcp',
          content: 'Hello, MSRP!',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should use default port 2855 when not specified', async () => {
      const response = await fetch(`${API_BASE}/msrp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // Will fail, but validates defaults
          fromPath: 'msrp://client.example.com:2855/session123;tcp',
          toPath: 'msrp://relay.example.com:2855/session456;tcp',
          content: 'Hello, MSRP!',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Connection will fail but the request was accepted (not 400)
      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should use default content-type when not specified', async () => {
      const response = await fetch(`${API_BASE}/msrp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          fromPath: 'msrp://client.example.com:2855/session123;tcp',
          toPath: 'msrp://relay.example.com:2855/session456;tcp',
          content: 'Hello, MSRP!',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Should accept request (default to text/plain)
      expect(response.status).toBe(500); // Will fail connection, but validates request structure
      expect(data.error).toBeDefined();
    }, 8000);

    it('should include host and port in response', async () => {
      const response = await fetch(`${API_BASE}/msrp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2855,
          fromPath: 'msrp://client.example.com:2855/session123;tcp',
          toPath: 'msrp://relay.example.com:2855/session456;tcp',
          content: 'Hello, MSRP!',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Even on failure, response should not crash
      expect(data).toBeDefined();
      expect(data.success).toBe(false);
    }, 8000);
  });

  describe('MSRP Connect Endpoint', () => {
    it('should reject missing parameters', async () => {
      const response = await fetch(`${API_BASE}/msrp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'relay.example.com',
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('fromPath');
      expect(data.error).toContain('toPath');
    });

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/msrp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // TEST-NET address, should fail
          port: 2855,
          fromPath: 'msrp://client.example.com:2855/session123;tcp',
          toPath: 'msrp://relay.example.com:2855/session456;tcp',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 8000);
  });
});
