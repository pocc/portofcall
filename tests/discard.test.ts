import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg';

describe('DISCARD Protocol Integration Tests', () => {
  describe('POST /api/discard/test', () => {
    it('should send data and confirm discard (no response)', async () => {
      const response = await fetch(`${API_BASE}/api/discard/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 9,
          message: 'Hello, Discard!',
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as {
        success: boolean;
        bytesSent: number;
        sendCount: number;
        elapsed: number;
        throughputBps: number;
        noResponse: boolean;
      };
      expect(data.success).toBe(true);
      expect(data.bytesSent).toBeGreaterThan(0);
      expect(data.sendCount).toBe(1);
      expect(data.elapsed).toBeGreaterThanOrEqual(0);
    });

    it('should handle repeated sends', async () => {
      const response = await fetch(`${API_BASE}/api/discard/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 9,
          message: 'Repeated data',
          repeatCount: 5,
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as {
        success: boolean;
        bytesSent: number;
        sendCount: number;
      };
      expect(data.success).toBe(true);
      expect(data.sendCount).toBe(5);
      expect(data.bytesSent).toBe(new TextEncoder().encode('Repeated data').byteLength * 5);
    });

    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/api/discard/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 9,
          message: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject missing message', async () => {
      const response = await fetch(`${API_BASE}/api/discard/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 9,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Message');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/api/discard/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 99999,
          message: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/discard/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 9,
          message: 'test',
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
    });

    it('should handle special characters in message', async () => {
      const response = await fetch(`${API_BASE}/api/discard/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 9,
          message: 'Hello 🌍 \t\n "quotes" <tags> & symbols!',
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { success: boolean; bytesSent: number };
      expect(data.success).toBe(true);
      expect(data.bytesSent).toBeGreaterThan(0);
    });

    it('should cap repeat count at 1000', async () => {
      const response = await fetch(`${API_BASE}/api/discard/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 9,
          message: 'x',
          repeatCount: 9999,
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { success: boolean; sendCount: number };
      expect(data.success).toBe(true);
      expect(data.sendCount).toBe(1000);
    });

    it('should report throughput in bytes per second', async () => {
      const response = await fetch(`${API_BASE}/api/discard/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 9,
          message: 'A'.repeat(100),
          repeatCount: 10,
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { success: boolean; throughputBps: number };
      expect(data.success).toBe(true);
      expect(data.throughputBps).toBeGreaterThanOrEqual(0);
    });
  });

  describe('WebSocket /api/discard/connect', () => {
    it('should require WebSocket upgrade', async () => {
      const response = await fetch(`${API_BASE}/api/discard/connect?host=tcpbin.com&port=9`);
      expect(response.status).toBe(426);
    });
  });
});
