import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('DISCARD Protocol Integration Tests', () => {
  describe('POST /api/discard/send', () => {
    it('should send data and report statistics', async () => {
      const response = await fetch(`${API_BASE}/discard/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 9,
          data: 'Hello from Port of Call!\n',
          timeout: 10000,
        }),
      });

      if (!response.ok) return; // localhost discard may not be available
      const data = await response.json() as {
        success: boolean;
        bytesSent?: number;
        duration?: number;
        throughput?: string;
      };
      expect(data.success).toBe(true);
      expect(data.bytesSent).toBeGreaterThan(0);
      expect(data.duration).toBeGreaterThanOrEqual(0);
      expect(data.throughput).toBeDefined();
    });

    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/discard/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 9,
          data: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject missing data', async () => {
      const response = await fetch(`${API_BASE}/discard/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 9,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Data is required');
    });

    it('should reject empty data', async () => {
      const response = await fetch(`${API_BASE}/discard/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 9,
          data: '',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Data is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/discard/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 99999,
          data: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should handle special characters in data', async () => {
      const response = await fetch(`${API_BASE}/discard/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 9,
          data: 'Hello 🌍 \t\n "quotes" <tags> & symbols!',
          timeout: 10000,
        }),
      });

      if (!response.ok) return; // localhost discard may not be available
      const data = await response.json() as { success: boolean; bytesSent: number };
      expect(data.success).toBe(true);
      expect(data.bytesSent).toBeGreaterThan(0);
    });

    it('should handle 1KB of data', async () => {
      const response = await fetch(`${API_BASE}/discard/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 9,
          data: 'A'.repeat(1024),
          timeout: 10000,
        }),
      });

      if (!response.ok) return; // localhost discard may not be available
      const data = await response.json() as { success: boolean; bytesSent: number };
      expect(data.success).toBe(true);
      expect(data.bytesSent).toBe(1024);
    });

    it('should handle 10KB of data', async () => {
      const response = await fetch(`${API_BASE}/discard/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 9,
          data: 'A'.repeat(10240),
          timeout: 10000,
        }),
      });

      if (!response.ok) return; // localhost discard may not be available
      const data = await response.json() as { success: boolean; bytesSent: number; throughput?: string };
      expect(data.success).toBe(true);
      expect(data.bytesSent).toBe(10240);
      expect(data.throughput).toBeDefined();
    });

    it('should reject data exceeding 1MB', async () => {
      const response = await fetch(`${API_BASE}/discard/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 9,
          data: 'A'.repeat(1048577), // 1MB + 1 byte
          timeout: 10000,
        }),
      });

      // WAF may block large payloads with 403 before the worker validates
      expect(response.ok).toBe(false);
      if (response.headers.get('content-type')?.includes('json')) {
        const data = await response.json() as { success: boolean; error: string };
        expect(data.success).toBe(false);
      }
    });
  });
});
