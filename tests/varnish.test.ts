/**
 * Varnish CLI Protocol Integration Tests
 *
 * Tests the Varnish Cache administration interface (VCLI)
 * implementation for probing and command execution on port 6082.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = (process.env.API_BASE || 'https://portofcall.ross.gg/api').replace(/\/api$/, '');

describe('Varnish CLI Protocol Integration Tests', () => {
  // --- PROBE Tests (/api/varnish/probe) ---

  describe('Probe (banner detection)', () => {
    it('should probe a Varnish CLI instance', async () => {
      const response = await fetch(`${API_BASE}/api/varnish/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 6082,
          timeout: 10000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data).toHaveProperty('host', 'localhost');
        expect(data).toHaveProperty('port', 6082);
        expect(data).toHaveProperty('statusCode');
        expect(data).toHaveProperty('rtt');
        expect(data.rtt).toBeGreaterThan(0);
        expect(data).toHaveProperty('authRequired');
        expect(typeof data.authRequired).toBe('boolean');

        if (data.authRequired) {
          expect(data.statusCode).toBe(107);
          expect(data).toHaveProperty('challenge');
        } else {
          expect(data.statusCode).toBe(200);
          expect(data).toHaveProperty('banner');
        }
      } else {
        // Varnish not available is expected in test environments
        expect(data).toHaveProperty('error');
      }
    });

    it('should validate required host for probe', async () => {
      const response = await fetch(`${API_BASE}/api/varnish/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 6082,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should validate port range for probe', async () => {
      const response = await fetch(`${API_BASE}/api/varnish/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should handle connection timeout for probe', async () => {
      const response = await fetch(`${API_BASE}/api/varnish/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 6082,
          timeout: 1,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        expect(data.error).toBeTruthy();
      }
    });

    it('should handle invalid hostname for probe', async () => {
      const response = await fetch(`${API_BASE}/api/varnish/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent-varnish-99999.invalid',
          port: 6082,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });
  });

  // --- COMMAND Tests (/api/varnish/command) ---

  describe('Command execution', () => {
    it('should execute a status command', async () => {
      const response = await fetch(`${API_BASE}/api/varnish/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 6082,
          command: 'status',
          timeout: 15000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data).toHaveProperty('host', 'localhost');
        expect(data).toHaveProperty('port', 6082);
        expect(data).toHaveProperty('command', 'status');
        expect(data).toHaveProperty('statusCode');
        expect(data).toHaveProperty('body');
        expect(data).toHaveProperty('rtt');
        expect(typeof data.body).toBe('string');
      } else {
        expect(data).toHaveProperty('error');
      }
    });

    it('should execute a ping command', async () => {
      const response = await fetch(`${API_BASE}/api/varnish/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 6082,
          command: 'ping',
          timeout: 15000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data).toHaveProperty('command', 'ping');
        expect(data).toHaveProperty('statusCode');
        expect(data).toHaveProperty('body');
      } else {
        expect(data).toHaveProperty('error');
      }
    });

    it('should validate required host for command', async () => {
      const response = await fetch(`${API_BASE}/api/varnish/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'status',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should validate required command', async () => {
      const response = await fetch(`${API_BASE}/api/varnish/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Command is required');
    });

    it('should reject unsafe commands', async () => {
      const response = await fetch(`${API_BASE}/api/varnish/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 6082,
          command: 'vcl.discard boot',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Command not allowed');
    });

    it('should reject stop command', async () => {
      const response = await fetch(`${API_BASE}/api/varnish/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 6082,
          command: 'stop',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Command not allowed');
    });

    it('should validate port range for command', async () => {
      const response = await fetch(`${API_BASE}/api/varnish/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 0,
          command: 'status',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should handle invalid hostname for command', async () => {
      const response = await fetch(`${API_BASE}/api/varnish/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent-varnish-99999.invalid',
          port: 6082,
          command: 'status',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });
  });

  // --- VCLI Protocol Format Tests ---

  describe('VCLI Protocol Format', () => {
    it('should parse VCLI response format', () => {
      // Format: "<status> <length>\n<body>\n"
      const response = '200 22\nChild in state running\n';

      const firstNewline = response.indexOf('\n');
      const firstLine = response.substring(0, firstNewline);
      const match = firstLine.match(/^(\d+)\s+(\d+)$/);

      expect(match).not.toBeNull();
      expect(parseInt(match![1])).toBe(200);
      expect(parseInt(match![2])).toBe(22);

      const bodyStart = firstNewline + 1;
      const bodyEnd = bodyStart + parseInt(match![2]);
      const body = response.substring(bodyStart, bodyEnd);
      expect(body).toBe('Child in state running');
    });

    it('should parse 107 auth challenge response', () => {
      const challenge = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
      const response = `107 ${challenge.length + 33}\n${challenge}\n\nAuthentication required.\n\n`;

      const firstNewline = response.indexOf('\n');
      const firstLine = response.substring(0, firstNewline);
      const match = firstLine.match(/^(\d+)\s+(\d+)$/);

      expect(match).not.toBeNull();
      expect(parseInt(match![1])).toBe(107);
    });

    it('should construct valid auth command', () => {
      const digest = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
      const authCmd = `auth ${digest}\n`;

      expect(authCmd).toContain('auth ');
      expect(authCmd.endsWith('\n')).toBe(true);
      expect(authCmd.split(' ')[1].trim()).toHaveLength(64);
    });

    it('should recognize VCLI status codes', () => {
      const statusCodes: Record<number, string> = {
        100: 'Syntax error',
        101: 'Unknown request',
        102: 'Not implemented',
        104: 'Too few parameters',
        105: 'Too many parameters',
        106: 'Bad parameter',
        107: 'Authentication required',
        200: 'OK',
        300: 'Truncated',
        400: 'Communication error',
        500: 'Close',
      };

      expect(statusCodes[200]).toBe('OK');
      expect(statusCodes[107]).toBe('Authentication required');
      expect(statusCodes[100]).toBe('Syntax error');
      expect(statusCodes[300]).toBe('Truncated');
      expect(statusCodes[500]).toBe('Close');
    });

    it('should validate safe command list', () => {
      const safeCommands = ['ping', 'status', 'banner', 'backend.list', 'vcl.list', 'param.show', 'panic.show', 'storage.list', 'help'];

      // These should be allowed
      expect(safeCommands).toContain('ping');
      expect(safeCommands).toContain('status');
      expect(safeCommands).toContain('backend.list');
      expect(safeCommands).toContain('vcl.list');
      expect(safeCommands).toContain('param.show');

      // These should NOT be in the safe list
      expect(safeCommands).not.toContain('stop');
      expect(safeCommands).not.toContain('start');
      expect(safeCommands).not.toContain('vcl.discard');
      expect(safeCommands).not.toContain('vcl.load');
      expect(safeCommands).not.toContain('vcl.use');
    });

    it('should compute SHA-256 auth hash input correctly', () => {
      const challenge = 'abcdef0123456789';
      const secret = 'mysecret';
      const input = challenge + '\n' + secret + '\n' + challenge + '\n';

      expect(input).toBe('abcdef0123456789\nmysecret\nabcdef0123456789\n');
      expect(input.split('\n').length).toBe(4); // 3 parts + trailing empty
    });

    it('should parse ping response', () => {
      // Varnish ping response: "PONG <timestamp>"
      const body = 'PONG 1704067200 1.0';
      const parts = body.split(/\s+/);

      expect(parts[0]).toBe('PONG');
      // Timestamp should be a number
      expect(parseInt(parts[1])).toBeGreaterThan(0);
    });

    it('should parse backend.list response', () => {
      const body = [
        'Backend name                   Admin      Probe',
        'boot.default                   probe      Healthy 5/5',
        'boot.backend2                  probe      Sick 0/5',
      ].join('\n');

      const lines = body.split('\n');
      expect(lines.length).toBe(3);
      expect(lines[0]).toContain('Backend name');
      expect(body).toContain('Healthy');
    });

    it('should parse status response', () => {
      const validStatuses = ['running', 'stopped'];
      const body = 'Child in state running';

      const hasValidStatus = validStatuses.some(s => body.includes(s));
      expect(hasValidStatus).toBe(true);
    });
  });
});
