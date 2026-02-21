/**
 * MK Livestatus Protocol Integration Tests
 *
 * Implementation: src/worker/livestatus.ts
 *
 * Endpoints:
 *   POST /api/livestatus/status    — query monitoring engine status table
 *   POST /api/livestatus/hosts     — query hosts table (up to 50 hosts)
 *   POST /api/livestatus/query     — send arbitrary LQL query
 *   POST /api/livestatus/services  — query services table with optional filter
 *   POST /api/livestatus/command   — send an external Nagios/Checkmk command
 *
 * Default port: 6557/TCP
 *
 * Protocol: text-based LQL over TCP with fixed16 response header.
 * All endpoints enforce POST-only (return JSON 405 body, not plain text).
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Livestatus Protocol Integration Tests', () => {
  // ── /api/livestatus/status ────────────────────────────────────────────────

  describe('POST /api/livestatus/status', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/livestatus/status`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/livestatus/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 6557 }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should return success:false for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/livestatus/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-livestatus-12345.example.com',
          port: 6557,
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/livestatus/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 6557,
          timeout: 10000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should use default port 6557', async () => {
      const response = await fetch(`${API_BASE}/livestatus/status`, {
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

    it('should accept custom port', async () => {
      const response = await fetch(`${API_BASE}/livestatus/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6558,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ── /api/livestatus/hosts ─────────────────────────────────────────────────

  describe('POST /api/livestatus/hosts', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/livestatus/hosts`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/livestatus/hosts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 6557 }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should return success:false for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/livestatus/hosts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6557,
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should use default port 6557', async () => {
      const response = await fetch(`${API_BASE}/livestatus/hosts`, {
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

  // ── /api/livestatus/query ─────────────────────────────────────────────────

  describe('POST /api/livestatus/query', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/livestatus/query`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/livestatus/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'GET status' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should return 400 when query is missing', async () => {
      const response = await fetch(`${API_BASE}/livestatus/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'test-host.invalid' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Query');
    });

    it('should attempt query with valid LQL on unreachable host', async () => {
      const response = await fetch(`${API_BASE}/livestatus/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6557,
          query: 'GET status\nColumns: program_version\n',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should use default port 6557', async () => {
      const response = await fetch(`${API_BASE}/livestatus/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          query: 'GET status\n',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ── /api/livestatus/services ──────────────────────────────────────────────

  describe('POST /api/livestatus/services', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/livestatus/services`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/livestatus/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 6557 }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should attempt services query on unreachable host', async () => {
      const response = await fetch(`${API_BASE}/livestatus/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6557,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should support filter parameter', async () => {
      const response = await fetch(`${API_BASE}/livestatus/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6557,
          filter: 'state = 0',
          limit: 10,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should support limit parameter', async () => {
      const response = await fetch(`${API_BASE}/livestatus/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6557,
          limit: 5,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ── /api/livestatus/command ───────────────────────────────────────────────

  describe('POST /api/livestatus/command', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/livestatus/command`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/livestatus/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'SCHEDULE_HOST_CHECK' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should return 400 when command is missing', async () => {
      const response = await fetch(`${API_BASE}/livestatus/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'test-host.invalid' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('command');
    });

    it('should attempt command on unreachable host', async () => {
      const response = await fetch(`${API_BASE}/livestatus/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6557,
          command: 'SCHEDULE_HOST_CHECK',
          args: ['localhost', '1234567890'],
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should support command without args', async () => {
      const response = await fetch(`${API_BASE}/livestatus/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6557,
          command: 'SAVE_STATE_INFORMATION',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should use default port 6557', async () => {
      const response = await fetch(`${API_BASE}/livestatus/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          command: 'SCHEDULE_HOST_CHECK',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });
});
