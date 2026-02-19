/**
 * SSH Protocol Integration Tests
 * Tests SSH connectivity checks (not full interactive sessions)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';
const SSH_BASE = `${API_BASE}/ssh`;

// Public SSH test server
const SSH_CONFIG = {
  host: 'test.rebex.net',
  port: 22,
};

describe('SSH Protocol Integration Tests', () => {
  describe('SSH Connect (HTTP)', () => {
    it('should connect and read SSH banner', async () => {
      const response = await fetch(`${SSH_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SSH_CONFIG),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.banner).toBeDefined();
      expect(data.banner).toContain('SSH');
      expect(data.message).toContain('reachable');
    });

    it('should support GET request with query parameters', async () => {
      const params = new URLSearchParams({
        host: SSH_CONFIG.host,
        port: SSH_CONFIG.port.toString(),
      });

      const response = await fetch(`${SSH_BASE}/connect?${params}`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.banner).toBeDefined();
    });

    it('should fail with non-existent host', async () => {
      const response = await fetch(`${SSH_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-ssh-host-12345.example.com',
          port: 22,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${SSH_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 22,
          // Missing host
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('SSH Execute Endpoint', () => {
    it('should require POST method', async () => {
      const response = await fetch(`${SSH_BASE}/exec`);
      expect(response.status).toBe(405);
      const data = await response.json();
      expect(data.error).toContain('Method not allowed');
    });

    it('should require host parameter', async () => {
      const response = await fetch(`${SSH_BASE}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'root',
          password: 'test',
          command: 'ls',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should require username parameter', async () => {
      const response = await fetch(`${SSH_BASE}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: SSH_CONFIG.host,
          password: 'test',
          command: 'ls',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('username');
    });

    it('should require authentication credentials', async () => {
      const response = await fetch(`${SSH_BASE}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: SSH_CONFIG.host,
          username: 'root',
          command: 'ls',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('password or privateKey');
    });

    it('should require command parameter', async () => {
      const response = await fetch(`${SSH_BASE}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: SSH_CONFIG.host,
          username: 'root',
          password: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('command');
    });
  });

  describe('SSH Disconnect Endpoint', () => {
    it('should return success message', async () => {
      const response = await fetch(`${SSH_BASE}/disconnect`, {
        method: 'POST',
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('WebSocket');
    });
  });
});
