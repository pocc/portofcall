/**
 * XMPP S2S Protocol Integration Tests
 *
 * These tests verify the XMPP Server-to-Server protocol implementation.
 * Since public XMPP servers may not accept S2S connections from arbitrary domains,
 * most tests validate input handling and request encoding.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('XMPP S2S Protocol Integration Tests', () => {
  describe('XMPP S2S Connect Endpoint', () => {
    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/xmpp-s2s/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          fromDomain: 'example.com',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject missing fromDomain', async () => {
      const response = await fetch(`${API_BASE}/xmpp-s2s/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'jabber.org',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('fromDomain');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/xmpp-s2s/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'jabber.org',
          fromDomain: 'example.com',
          port: 99999,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should use default port 5269 when not specified', async () => {
      const response = await fetch(`${API_BASE}/xmpp-s2s/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // TEST-NET address
          fromDomain: 'example.com',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Connection will fail but validates default port
      expect(response.status).toBe(500);
      expect(data.port).toBe(5269);
    }, 8000);

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/xmpp-s2s/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // TEST-NET address, should fail
          fromDomain: 'example.com',
          port: 5269,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should accept toDomain parameter', async () => {
      const response = await fetch(`${API_BASE}/xmpp-s2s/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          fromDomain: 'example.com',
          toDomain: 'jabber.org',
          port: 5269,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Connection will fail, but validates toDomain acceptance
      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should accept useTLS parameter', async () => {
      const response = await fetch(`${API_BASE}/xmpp-s2s/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          fromDomain: 'example.com',
          useTLS: false,
          port: 5269,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Connection will fail, but validates useTLS acceptance
      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should reject port 0', async () => {
      const response = await fetch(`${API_BASE}/xmpp-s2s/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'jabber.org',
          fromDomain: 'example.com',
          port: 0,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });
  });

  describe('XMPP S2S Ping Endpoint', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/xmpp-s2s/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromDomain: 'example.com',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('host');
    });

    it('should reject missing fromDomain', async () => {
      const response = await fetch(`${API_BASE}/xmpp-s2s/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'jabber.org',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('fromDomain');
    });

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/xmpp-s2s/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // TEST-NET address
          fromDomain: 'example.com',
          port: 5269,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should use default port 5269', async () => {
      const response = await fetch(`${API_BASE}/xmpp-s2s/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          fromDomain: 'example.com',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.port).toBe(5269);
    }, 8000);
  });
});
