/**
 * ECHO Protocol Integration Tests
 *
 * Tests the ECHO protocol implementation (RFC 862)
 * ECHO is the simplest TCP protocol - it just echoes back any data sent to it
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('ECHO Protocol Integration Tests', () => {
  describe('POST /api/echo/test', () => {
    it('should echo back a simple message', async () => {
      const response = await fetch(`${API_BASE}/echo/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 4242,
          message: 'Hello, ECHO!',
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as {
        success: boolean;
        sent: string;
        received: string;
        match: boolean;
        rtt: number;
        error?: string;
      };

      expect(data.success).toBe(true);
      expect(data.sent).toBe('Hello, ECHO!');
      expect(data.received).toBeTruthy();
      expect(data.match).toBe(true);
      expect(data.rtt).toBeGreaterThan(0);
      expect(data.error).toBeUndefined();
    });

    it('should handle special characters in message', async () => {
      const specialMessage = 'Test\n\r\tSpecial!@#$%^&*()';
      const response = await fetch(`${API_BASE}/echo/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 4242,
          message: specialMessage,
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as {
        success: boolean;
        sent: string;
        received: string;
        match: boolean;
      };

      expect(data.success).toBe(true);
      expect(data.sent).toBe(specialMessage);
      expect(data.received).toBeTruthy();
    });

    it('should handle empty message', async () => {
      const response = await fetch(`${API_BASE}/echo/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 4242,
          message: '',
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as {
        success: boolean;
        error: string;
      };

      expect(data.success).toBe(false);
      expect(data.error).toBe('Message is required');
    });

    it('should handle long messages', async () => {
      const longMessage = 'A'.repeat(1000);
      const response = await fetch(`${API_BASE}/echo/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 4242,
          message: longMessage,
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as {
        success: boolean;
        sent: string;
        received: string;
        match: boolean;
      };

      expect(data.success).toBe(true);
      expect(data.sent).toBe(longMessage);
      expect(data.sent.length).toBe(1000);
    });

    it('should validate missing host', async () => {
      const response = await fetch(`${API_BASE}/echo/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 7,
          message: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as {
        success: boolean;
        error: string;
      };

      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should validate invalid port numbers', async () => {
      const response = await fetch(`${API_BASE}/echo/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 99999,
          message: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as {
        success: boolean;
        error: string;
      };

      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should measure RTT correctly', async () => {
      const response = await fetch(`${API_BASE}/echo/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 4242,
          message: 'RTT test',
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as {
        success: boolean;
        rtt: number;
      };

      expect(data.success).toBe(true);
      expect(data.rtt).toBeGreaterThan(0);
      expect(data.rtt).toBeLessThan(10000); // Should complete within timeout
    });

    it('should handle unicode characters', async () => {
      const unicodeMessage = 'Hello 世界 🌍 مرحبا';
      const response = await fetch(`${API_BASE}/echo/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'tcpbin.com',
          port: 4242,
          message: unicodeMessage,
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as {
        success: boolean;
        sent: string;
        received: string;
        match: boolean;
      };

      expect(data.success).toBe(true);
      expect(data.sent).toBe(unicodeMessage);
    });
  });
});
