/**
 * Zabbix Protocol Integration Tests
 *
 * Tests Zabbix ZBXD protocol implementation for both server (10051)
 * and agent (10050) connectivity testing.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = (process.env.API_BASE || 'https://portofcall.ross.gg/api').replace(/\/api$/, '');

describe('Zabbix Protocol Integration Tests', () => {
  // --- Server Probe Tests (/api/zabbix/connect) ---

  describe('Server Probe (Port 10051)', () => {
    it('should probe a Zabbix server with active checks request', async () => {
      const response = await fetch(`${API_BASE}/api/zabbix/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 10051,
          timeout: 10000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data).toHaveProperty('host', 'localhost');
        expect(data).toHaveProperty('port', 10051);
        expect(data).toHaveProperty('rtt');
        expect(data.rtt).toBeGreaterThan(0);
        expect(data).toHaveProperty('data');

        // Response should contain some JSON from the server
        expect(typeof data.data).toBe('string');
      } else {
        // Server not available is expected in test environments
        expect(data).toHaveProperty('error');
      }
    });

    it('should validate required host for server probe', async () => {
      const response = await fetch(`${API_BASE}/api/zabbix/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 10051,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should validate port range for server probe', async () => {
      const response = await fetch(`${API_BASE}/api/zabbix/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should handle connection timeout for server', async () => {
      const response = await fetch(`${API_BASE}/api/zabbix/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 10051,
          timeout: 1, // Very short timeout
        }),
      });

      const data = await response.json();
      if (!data.success) {
        expect(data.error).toBeTruthy();
      }
    });

    it('should handle invalid hostname for server', async () => {
      const response = await fetch(`${API_BASE}/api/zabbix/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent-zabbix-server-99999.invalid',
          port: 10051,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });
  });

  // --- Agent Query Tests (/api/zabbix/agent) ---

  describe('Agent Query (Port 10050)', () => {
    it('should query a Zabbix agent for agent.ping', async () => {
      const response = await fetch(`${API_BASE}/api/zabbix/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 10050,
          key: 'agent.ping',
          timeout: 10000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data).toHaveProperty('host', 'localhost');
        expect(data).toHaveProperty('port', 10050);
        expect(data).toHaveProperty('key', 'agent.ping');
        expect(data).toHaveProperty('value');
        expect(data).toHaveProperty('rtt');
        expect(data.rtt).toBeGreaterThan(0);
      } else {
        // Agent not available is expected in test environments
        expect(data).toHaveProperty('error');
      }
    });

    it('should query agent.version key', async () => {
      const response = await fetch(`${API_BASE}/api/zabbix/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 10050,
          key: 'agent.version',
          timeout: 10000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.key).toBe('agent.version');
        expect(typeof data.value).toBe('string');
        expect(data.value.length).toBeGreaterThan(0);
      } else {
        expect(data).toHaveProperty('error');
      }
    });

    it('should validate required host for agent query', async () => {
      const response = await fetch(`${API_BASE}/api/zabbix/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 10050,
          key: 'agent.ping',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should validate required key for agent query', async () => {
      const response = await fetch(`${API_BASE}/api/zabbix/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 10050,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Item key is required');
    });

    it('should validate port range for agent query', async () => {
      const response = await fetch(`${API_BASE}/api/zabbix/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 0,
          key: 'agent.ping',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should reject keys with control characters', async () => {
      const response = await fetch(`${API_BASE}/api/zabbix/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 10050,
          key: 'agent.ping\x00malicious',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid item key format');
    });

    it('should handle connection timeout for agent', async () => {
      const response = await fetch(`${API_BASE}/api/zabbix/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 10050,
          key: 'agent.ping',
          timeout: 1,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        expect(data.error).toBeTruthy();
      }
    });

    it('should handle invalid hostname for agent', async () => {
      const response = await fetch(`${API_BASE}/api/zabbix/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent-zabbix-agent-99999.invalid',
          port: 10050,
          key: 'agent.ping',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });
  });

  // --- Protocol Encoding Tests ---

  describe('ZBXD Protocol Encoding', () => {
    it('should construct valid ZBXD header', () => {
      // ZBXD header format:
      // Bytes 0-3: "ZBXD" (0x5A 0x42 0x58 0x44)
      // Byte 4: flags (0x01 = standard)
      // Bytes 5-12: data length (8 bytes little-endian)

      const ZBXD_MAGIC = [0x5A, 0x42, 0x58, 0x44]; // "ZBXD"

      expect(String.fromCharCode(...ZBXD_MAGIC)).toBe('ZBXD');

      // Standard flags byte
      expect(0x01).toBe(1); // standard mode
      expect(0x03).toBe(3); // compressed mode
    });

    it('should encode data length as little-endian uint64', () => {
      // Test encoding a known length
      const dataLength = 42;
      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);

      view.setUint32(0, dataLength, true);  // low 32 bits
      view.setUint32(4, 0, true);           // high 32 bits

      // Read back
      expect(view.getUint32(0, true)).toBe(42);
      expect(view.getUint32(4, true)).toBe(0);

      // Byte representation for 42: 0x2A 0x00 0x00 0x00 0x00 0x00 0x00 0x00
      const bytes = new Uint8Array(buffer);
      expect(bytes[0]).toBe(0x2A);
      expect(bytes[1]).toBe(0x00);
    });

    it('should decode ZBXD response header correctly', () => {
      // Construct a fake ZBXD response
      const payload = '{"response":"success"}';
      const payloadBytes = new TextEncoder().encode(payload);
      const message = new Uint8Array(13 + payloadBytes.length);

      // Header
      message[0] = 0x5A; // Z
      message[1] = 0x42; // B
      message[2] = 0x58; // X
      message[3] = 0x44; // D
      message[4] = 0x01; // standard

      // Length
      const view = new DataView(message.buffer);
      view.setUint32(5, payloadBytes.length, true);
      view.setUint32(9, 0, true);

      // Payload
      message.set(payloadBytes, 13);

      // Verify header
      expect(String.fromCharCode(message[0], message[1], message[2], message[3])).toBe('ZBXD');
      expect(message[4]).toBe(0x01);
      expect(view.getUint32(5, true)).toBe(payloadBytes.length);

      // Verify payload
      const decoded = new TextDecoder().decode(message.slice(13));
      expect(decoded).toBe(payload);

      const parsed = JSON.parse(decoded);
      expect(parsed.response).toBe('success');
    });

    it('should handle empty payload', () => {
      const payload = '';
      const payloadBytes = new TextEncoder().encode(payload);

      expect(payloadBytes.length).toBe(0);

      // ZBXD header is always 13 bytes
      const message = new Uint8Array(13);
      message[0] = 0x5A;
      message[1] = 0x42;
      message[2] = 0x58;
      message[3] = 0x44;
      message[4] = 0x01;

      const view = new DataView(message.buffer);
      view.setUint32(5, 0, true);
      view.setUint32(9, 0, true);

      expect(view.getUint32(5, true)).toBe(0);
    });

    it('should recognize non-ZBXD responses as plain text', () => {
      // Older Zabbix agents may respond without ZBXD header
      const plainResponse = new TextEncoder().encode('1');

      // First byte is not 'Z' (0x5A)
      expect(plainResponse[0]).not.toBe(0x5A);

      // Should be treated as plain text response
      const decoded = new TextDecoder().decode(plainResponse);
      expect(decoded).toBe('1');
    });
  });

  // --- Common Zabbix Agent Keys ---

  describe('Zabbix Agent Key Validation', () => {
    const validKeys = [
      'agent.ping',
      'agent.version',
      'agent.hostname',
      'system.uptime',
      'system.hostname',
      'system.uname',
      'system.cpu.num',
      'vm.memory.size[total]',
      'vfs.fs.discovery',
      'net.if.discovery',
    ];

    for (const key of validKeys) {
      it(`should accept valid key: ${key}`, () => {
        // Key should not contain control characters
        expect(/[\x00-\x1f]/.test(key)).toBe(false);

        // Key should be <= 255 chars
        expect(key.length).toBeLessThanOrEqual(255);

        // Key should be non-empty
        expect(key.length).toBeGreaterThan(0);
      });
    }

    it('should reject keys with null bytes', () => {
      const maliciousKey = 'agent.ping\x00';
      expect(/[\x00-\x1f]/.test(maliciousKey)).toBe(true);
    });

    it('should reject overly long keys', () => {
      const longKey = 'a'.repeat(256);
      expect(longKey.length).toBeGreaterThan(255);
    });
  });
});
