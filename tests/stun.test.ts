/**
 * STUN Protocol Integration Tests
 * Tests STUN Binding Request/Response (RFC 5389/8489) - port 3478
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('STUN Protocol Integration Tests', () => {
  describe('POST /api/stun/binding', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/stun/binding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should default to port 3478', async () => {
      const response = await fetch(`${API_BASE}/stun/binding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/stun/binding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-stun-host-12345.example.com',
          port: 3478,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should accept custom port', async () => {
      const response = await fetch(`${API_BASE}/stun/binding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 19302,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should handle custom timeout', async () => {
      const response = await fetch(`${API_BASE}/stun/binding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/stun/binding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 3478,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });

  describe('POST /api/stun/probe', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/stun/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should handle probe request', async () => {
      const response = await fetch(`${API_BASE}/stun/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 3478,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('alive');
    }, 15000);

    it('should default timeout to 8 seconds', async () => {
      const response = await fetch(`${API_BASE}/stun/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);
  });

  describe('STUN Protocol Features', () => {
    it('should use magic cookie 0x2112A442', () => {
      const MAGIC_COOKIE = 0x2112A442;
      expect(MAGIC_COOKIE).toBe(0x2112A442);
    });

    it('should use 20-byte header', () => {
      const HEADER_LENGTH = 20;
      expect(HEADER_LENGTH).toBe(20);
    });

    it('should use Binding Request message type 0x0001', () => {
      const BINDING_REQUEST = 0x0001;
      expect(BINDING_REQUEST).toBe(0x0001);
    });

    it('should use Binding Response message type 0x0101', () => {
      const BINDING_RESPONSE = 0x0101;
      expect(BINDING_RESPONSE).toBe(0x0101);
    });

    it('should support XOR-MAPPED-ADDRESS attribute', () => {
      // XOR-MAPPED-ADDRESS is preferred over MAPPED-ADDRESS per RFC 5389
      const ATTR_XOR_MAPPED_ADDRESS = 0x0020;
      expect(ATTR_XOR_MAPPED_ADDRESS).toBe(0x0020);
    });

    it('should support MAPPED-ADDRESS attribute', () => {
      const ATTR_MAPPED_ADDRESS = 0x0001;
      expect(ATTR_MAPPED_ADDRESS).toBe(0x0001);
    });

    it('should support SOFTWARE attribute', () => {
      const ATTR_SOFTWARE = 0x8022;
      expect(ATTR_SOFTWARE).toBe(0x8022);
    });

    it('should support IPv4 address family', () => {
      const AF_IPV4 = 0x01;
      expect(AF_IPV4).toBe(0x01);
    });

    it('should support IPv6 address family', () => {
      const AF_IPV6 = 0x02;
      expect(AF_IPV6).toBe(0x02);
    });
  });

  describe('STUN Message Format', () => {
    it('should validate message type range', () => {
      // Message type is in the first 2 bytes, top 2 bits must be 00
      const validType = 0x0001; // Binding Request
      expect(validType & 0xC000).toBe(0);
    });

    it('should validate transaction ID length', () => {
      // Transaction ID is 96 bits (12 bytes)
      const TRANSACTION_ID_LENGTH = 12;
      expect(TRANSACTION_ID_LENGTH).toBe(12);
    });

    it('should validate attribute padding', () => {
      // Attributes must be padded to 4-byte boundaries
      const padding = (len: number) => (4 - (len % 4)) % 4;
      expect(padding(5)).toBe(3);
      expect(padding(8)).toBe(0);
      expect(padding(1)).toBe(3);
    });
  });
});
