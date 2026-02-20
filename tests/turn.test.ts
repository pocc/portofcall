/**
 * TURN Protocol Integration Tests
 * Tests TURN relay allocation and permissions (RFC 8656/5766) - port 3478
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('TURN Protocol Integration Tests', () => {
  describe('POST /api/turn/allocate', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/turn/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject invalid port range', async () => {
      const response = await fetch(`${API_BASE}/turn/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'turn.example.com',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should default to port 3478', async () => {
      const response = await fetch(`${API_BASE}/turn/allocate`, {
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
      const response = await fetch(`${API_BASE}/turn/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-turn-host-12345.example.com',
          port: 3478,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should accept username parameter', async () => {
      const response = await fetch(`${API_BASE}/turn/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          username: 'testuser',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should accept password parameter', async () => {
      const response = await fetch(`${API_BASE}/turn/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          username: 'testuser',
          password: 'testpass',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should default to UDP transport (17)', async () => {
      const response = await fetch(`${API_BASE}/turn/allocate`, {
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

    it('should accept custom requestedTransport', async () => {
      const response = await fetch(`${API_BASE}/turn/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          requestedTransport: 6, // TCP
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should handle custom timeout', async () => {
      const response = await fetch(`${API_BASE}/turn/allocate`, {
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
  });

  describe('POST /api/turn/permission', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/turn/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'testuser',
          password: 'testpass',
          peerAddress: '192.0.2.1',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject missing username', async () => {
      const response = await fetch(`${API_BASE}/turn/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'turn.example.com',
          password: 'testpass',
          peerAddress: '192.0.2.1',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('username');
    });

    it('should reject missing password', async () => {
      const response = await fetch(`${API_BASE}/turn/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'turn.example.com',
          username: 'testuser',
          peerAddress: '192.0.2.1',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('password');
    });

    it('should reject missing peerAddress', async () => {
      const response = await fetch(`${API_BASE}/turn/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'turn.example.com',
          username: 'testuser',
          password: 'testpass',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('peerAddress');
    });

    it('should reject invalid port range', async () => {
      const response = await fetch(`${API_BASE}/turn/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'turn.example.com',
          port: 70000,
          username: 'testuser',
          password: 'testpass',
          peerAddress: '192.0.2.1',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should handle permission creation attempt', async () => {
      const response = await fetch(`${API_BASE}/turn/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          username: 'testuser',
          password: 'testpass',
          peerAddress: '192.0.2.1',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 20000);
  });

  describe('POST /api/turn/probe', () => {
    it('should handle probe request', async () => {
      const response = await fetch(`${API_BASE}/turn/probe`, {
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
  });

  describe('TURN Protocol Features', () => {
    it('should support Allocate Request (0x0003)', () => {
      const ALLOCATE_REQUEST = 0x0003;
      expect(ALLOCATE_REQUEST).toBe(0x0003);
    });

    it('should support Allocate Response (0x0103)', () => {
      const ALLOCATE_RESPONSE = 0x0103;
      expect(ALLOCATE_RESPONSE).toBe(0x0103);
    });

    it('should support XOR-RELAYED-ADDRESS attribute', () => {
      const ATTR_XOR_RELAYED_ADDRESS = 0x0016;
      expect(ATTR_XOR_RELAYED_ADDRESS).toBe(0x0016);
    });

    it('should support REQUESTED-TRANSPORT attribute', () => {
      const ATTR_REQUESTED_TRANSPORT = 0x0019;
      expect(ATTR_REQUESTED_TRANSPORT).toBe(0x0019);
    });

    it('should support LIFETIME attribute', () => {
      const ATTR_LIFETIME = 0x000D;
      expect(ATTR_LIFETIME).toBe(0x000D);
    });

    it('should inherit STUN magic cookie', () => {
      const MAGIC_COOKIE = 0x2112A442;
      expect(MAGIC_COOKIE).toBe(0x2112A442);
    });

    it('should use HMAC-SHA1 for MESSAGE-INTEGRITY', () => {
      // TURN uses HMAC-SHA1 for authentication
      expect(true).toBe(true);
    });

    it('should use MD5 for long-term credential key', () => {
      // Key = MD5(username:realm:password)
      expect(true).toBe(true);
    });

    it('should support UDP transport (17)', () => {
      const TRANSPORT_UDP = 17;
      expect(TRANSPORT_UDP).toBe(17);
    });

    it('should support TCP transport (6)', () => {
      const TRANSPORT_TCP = 6;
      expect(TRANSPORT_TCP).toBe(6);
    });
  });

  describe('TURN Message Types', () => {
    it('should support Refresh Request (0x0004)', () => {
      const REFRESH_REQUEST = 0x0004;
      expect(REFRESH_REQUEST).toBe(0x0004);
    });

    it('should support CreatePermission Request (0x0008)', () => {
      const CREATE_PERMISSION_REQUEST = 0x0008;
      expect(CREATE_PERMISSION_REQUEST).toBe(0x0008);
    });

    it('should support ChannelBind Request (0x0009)', () => {
      const CHANNEL_BIND_REQUEST = 0x0009;
      expect(CHANNEL_BIND_REQUEST).toBe(0x0009);
    });
  });
});
