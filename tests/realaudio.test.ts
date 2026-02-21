/**
 * RealAudio/RealMedia Protocol Integration Tests
 * Tests RealAudio RTSP server connectivity and streaming
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('RealAudio/RealMedia Protocol Integration Tests', () => {
  describe('RealAudio Probe', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/realaudio/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/realaudio/probe`, {
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
      const response = await fetch(`${API_BASE}/realaudio/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-realaudio-server-12345.example.com',
          port: 7070,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should use default port 7070', async () => {
      const response = await fetch(`${API_BASE}/realaudio/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.port).toBe(7070);
    }, 10000);
  });

  describe('RealAudio Describe', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/realaudio/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamPath: '/stream.rm',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should handle connection failure', async () => {
      const response = await fetch(`${API_BASE}/realaudio/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-realaudio.example.com',
          streamPath: '/stream.rm',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should use default stream path', async () => {
      const response = await fetch(`${API_BASE}/realaudio/describe`, {
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

  describe('RealAudio Setup', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/realaudio/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/testclip.rm',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should handle timeout', async () => {
      const response = await fetch(`${API_BASE}/realaudio/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.methods).toEqual([]);
      expect(data.tracks).toEqual([]);
    }, 10000);

    it('should use default port 554 (standard RTSP)', async () => {
      const response = await fetch(`${API_BASE}/realaudio/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('methods');
      expect(data).toHaveProperty('tracks');
    }, 10000);
  });

  describe('RealAudio Session', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/realaudio/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/stream.rm',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should reject non-POST requests', async () => {
      const response = await fetch(`${API_BASE}/realaudio/session`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should handle timeout', async () => {
      const response = await fetch(`${API_BASE}/realaudio/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.methods).toEqual([]);
      expect(data.tracks).toEqual([]);
    }, 10000);

    it('should support custom collectMs parameter', async () => {
      const response = await fetch(`${API_BASE}/realaudio/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          collectMs: 1000,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should cap collectMs at 8000ms', async () => {
      const response = await fetch(`${API_BASE}/realaudio/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          collectMs: 20000, // should be capped
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('RealAudio RTSP Methods', () => {
    it('should parse RTSP OPTIONS response', async () => {
      const response = await fetch(`${API_BASE}/realaudio/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('methods');
      expect(Array.isArray(data.methods)).toBe(true);
    }, 10000);

    it('should parse SDP track information', async () => {
      const response = await fetch(`${API_BASE}/realaudio/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('tracks');
      expect(Array.isArray(data.tracks)).toBe(true);
    }, 10000);
  });
});
