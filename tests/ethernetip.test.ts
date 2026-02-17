/**
 * EtherNet/IP Protocol Integration Tests
 * Tests EtherNet/IP (CIP) ListIdentity device discovery
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('EtherNet/IP Protocol Integration Tests', () => {
  describe('Identity Discovery', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/ethernetip/identity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 44818,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should fail with invalid port', async () => {
      const response = await fetch(`${API_BASE}/ethernetip/identity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should use default port 44818', async () => {
      const response = await fetch(`${API_BASE}/ethernetip/identity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      // Will fail to connect (unreachable IP), but should attempt port 44818
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ethernetip/identity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 44818,
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should handle non-existent hostname', async () => {
      const response = await fetch(`${API_BASE}/ethernetip/identity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-plc-12345.example.com',
          port: 44818,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should return proper response structure on error', async () => {
      const response = await fetch(`${API_BASE}/ethernetip/identity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 44818,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('error');
    }, 10000);

    it('should accept custom port values', async () => {
      const response = await fetch(`${API_BASE}/ethernetip/identity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2222,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/ethernetip/identity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 44818,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });
});
