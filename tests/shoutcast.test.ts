/**
 * SHOUTcast Protocol Integration Tests
 * Tests SHOUTcast streaming server protocol
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('SHOUTcast Protocol Integration Tests', () => {
  describe('SHOUTcast Probe', () => {
    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-shoutcast-12345.example.com',
          port: 8000,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 8000,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should support custom stream path', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8000,
          stream: '/stream',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should validate port range', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Port must be between');
    });
  });

  describe('SHOUTcast Info', () => {
    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8000,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 8000,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });
  });

  describe('SHOUTcast Admin', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should fail with missing adminPassword parameter', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('adminPassword');
    });

    it('should handle admin query to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8000,
          adminPassword: 'test',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);
  });

  describe('SHOUTcast Source', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should fail with missing password parameter', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('password');
    });

    it('should handle source mount with all parameters', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8000,
          mountpoint: '/stream',
          password: 'test',
          name: 'Test Station',
          genre: 'Rock',
          bitrate: 128,
          contentType: 'audio/mpeg',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should reject GET method', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/source`);
      expect(response.status).toBe(405);
    });
  });

  describe('SHOUTcast Port Support', () => {
    it('should accept port 8000 (default)', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8000,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept custom ports', async () => {
      const response = await fetch(`${API_BASE}/shoutcast/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8001,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });
});
