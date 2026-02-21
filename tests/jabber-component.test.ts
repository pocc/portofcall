/**
 * Jabber Component Protocol (XEP-0114) Integration Tests
 * Tests XMPP component connection, handshake, and roster
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Jabber Component Protocol Integration Tests', () => {
  describe('Jabber Component Probe', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/jabber-component/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          componentName: 'component.localhost',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/jabber-component/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 999999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should handle non-existent host', async () => {
      const response = await fetch(`${API_BASE}/jabber-component/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-jabber-server-12345.example.com',
          port: 5275,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('Jabber Component Handshake', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/jabber-component/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: 'test-secret',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should fail with missing secret', async () => {
      const response = await fetch(`${API_BASE}/jabber-component/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Secret is required');
    });

    it('should handle connection to non-existent server', async () => {
      const response = await fetch(`${API_BASE}/jabber-component/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-jabber.example.com',
          port: 5275,
          secret: 'test-secret',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('Jabber Component Send', () => {
    it('should fail with missing required fields', async () => {
      const response = await fetch(`${API_BASE}/jabber-component/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing from/to fields', async () => {
      const response = await fetch(`${API_BASE}/jabber-component/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          componentDomain: 'component.localhost',
          secret: 'test-secret',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('from and to');
    });
  });

  describe('Jabber Component Roster', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/jabber-component/roster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          componentDomain: 'component.localhost',
          secret: 'test-secret',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should fail with missing componentDomain or secret', async () => {
      const response = await fetch(`${API_BASE}/jabber-component/roster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('componentDomain and secret');
    });
  });
});
