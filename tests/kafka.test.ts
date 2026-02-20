import { describe, it, expect } from 'vitest';

const API_BASE = (process.env.API_BASE || 'https://portofcall.ross.gg/api').replace(/\/api$/, '');

describe('Kafka Protocol (Port 9092)', () => {
  describe('ApiVersions - Input Validation', () => {
    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/kafka/versions`, {
        method: 'GET',
      });
      expect(response.status).toBe(405);
    });

    it('should require host', async () => {
      const response = await fetch(`${API_BASE}/api/kafka/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });
  });

  describe('Metadata - Input Validation', () => {
    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/kafka/metadata`, {
        method: 'GET',
      });
      expect(response.status).toBe(405);
    });

    it('should require host', async () => {
      const response = await fetch(`${API_BASE}/api/kafka/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });
  });

  describe('Connection Tests', () => {
    it('should handle unreachable hosts gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/kafka/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9092,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should detect Cloudflare-protected hosts', async () => {
      const response = await fetch(`${API_BASE}/api/kafka/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 9092,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle wrong port (non-Kafka service)', async () => {
      const response = await fetch(`${API_BASE}/api/kafka/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'google.com',
          port: 80,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      // Should fail since HTTP is not Kafka
      if (data.success) {
        // Might get a garbage response that fails to parse
        expect(data.errorCode).not.toBe(0);
      } else {
        expect(data.error).toBeDefined();
      }
    }, 10000);
  });

  describe('Response Structure', () => {
    it('should return proper error format for connection failures', async () => {
      const response = await fetch(`${API_BASE}/api/kafka/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9092,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    }, 8000);

    it('should return proper error format for metadata failures', async () => {
      const response = await fetch(`${API_BASE}/api/kafka/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9092,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error');
    }, 8000);
  });
});
