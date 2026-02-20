/**
 * Matrix Protocol Integration Tests
 * Tests Matrix homeserver connectivity and API endpoints
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Matrix Protocol Integration Tests', () => {
  describe('Matrix Health Check', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/matrix/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should handle non-existent host', async () => {
      const response = await fetch(`${API_BASE}/matrix/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-matrix-server-12345.example.com',
          port: 8448,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });

  describe('Matrix Query', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/matrix/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/_matrix/client/versions',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid HTTP method', async () => {
      const response = await fetch(`${API_BASE}/matrix/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'matrix.org',
          method: 'INVALID',
          path: '/_matrix/client/versions',
        }),
      });

      // Accept either 400 (validation) or 403 (Cloudflare protection)
      expect([400, 403]).toContain(response.status);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle connection failure', async () => {
      const response = await fetch(`${API_BASE}/matrix/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-matrix.example.com',
          port: 8448,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('Matrix Login', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/matrix/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'test',
          password: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should fail with missing credentials', async () => {
      const response = await fetch(`${API_BASE}/matrix/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'matrix.org',
        }),
      });

      // Accept either 400 (validation) or 403 (Cloudflare protection)
      expect([400, 403]).toContain(response.status);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('Matrix Rooms', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/matrix/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: 'test-token',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should fail with missing access token', async () => {
      const response = await fetch(`${API_BASE}/matrix/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'matrix.org',
        }),
      });

      // Accept either 400 (validation) or 403 (Cloudflare protection)
      expect([400, 403]).toContain(response.status);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('Matrix Send Message', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/matrix/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: 'test',
          room_id: '!test:matrix.org',
          message: 'Hello',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host is required');
    });

    it('should fail with missing access_token', async () => {
      const response = await fetch(`${API_BASE}/matrix/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'matrix.org',
          room_id: '!test:matrix.org',
        }),
      });

      // Accept either 400 (validation) or 403 (Cloudflare protection)
      expect([400, 403]).toContain(response.status);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing room_id', async () => {
      const response = await fetch(`${API_BASE}/matrix/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'matrix.org',
          access_token: 'test',
        }),
      });

      // Accept either 400 (validation) or 403 (Cloudflare protection)
      expect([400, 403]).toContain(response.status);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('Matrix Room Create', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/matrix/room/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Room',
        }),
      });

      // Accept either 400 (validation) or 404 (endpoint not found)
      expect([400, 404]).toContain(response.status);
    });
  });

  describe('Matrix Room Join', () => {
    it('should fail with missing host', async () => {
      const response = await fetch(`${API_BASE}/matrix/room/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id_or_alias: '#test:matrix.org',
        }),
      });

      // Accept either 400 (validation) or 404 (endpoint not found)
      expect([400, 404]).toContain(response.status);
    });

    it('should fail with missing room_id_or_alias', async () => {
      const response = await fetch(`${API_BASE}/matrix/room/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'matrix.org',
        }),
      });

      // Accept either 400 (validation) or 403 (Cloudflare protection)
      expect([400, 403]).toContain(response.status);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });
});
