/**
 * SFTP Protocol Integration Tests
 * Tests SFTP connectivity checks (file operations require WebSocket tunnel)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';
const SFTP_BASE = `${API_BASE}/sftp`;

// Public SSH test server (SFTP runs over SSH)
const SFTP_CONFIG = {
  host: 'test.rebex.net',
  port: 22,
  username: 'demo',
  password: 'password',
};

describe('SFTP Protocol Integration Tests', () => {
  describe('SFTP Connect (HTTP)', () => {
    it('should connect and verify SSH server for SFTP', async () => {
      const response = await fetch(`${SFTP_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SFTP_CONFIG),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.sshBanner).toBeDefined();
      expect(data.sshBanner).toContain('SSH');
      expect(data.message).toContain('SFTP');
      expect(data.requiresAuth).toBe(true);
    });

    it('should support GET request with query parameters', async () => {
      const params = new URLSearchParams({
        host: SFTP_CONFIG.host,
        port: SFTP_CONFIG.port.toString(),
        username: SFTP_CONFIG.username,
      });

      const response = await fetch(`${SFTP_BASE}/connect?${params}`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.sshBanner).toBeDefined();
    });

    it('should fail with non-existent host', async () => {
      const response = await fetch(`${SFTP_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-sftp-host-12345.example.com',
          port: 22,
          username: 'test',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${SFTP_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 22,
          username: 'test',
          // Missing host
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('host');
    });

    it('should fail with missing username parameter', async () => {
      const response = await fetch(`${SFTP_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: SFTP_CONFIG.host,
          port: 22,
          // Missing username
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('username');
    });
  });

  describe('SFTP List Endpoint', () => {
    it('should return 501 Not Implemented', async () => {
      const response = await fetch(`${SFTP_BASE}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: SFTP_CONFIG.host,
          path: '/',
        }),
      });

      expect(response.status).toBe(501);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.message).toContain('WebSocket');
    });
  });

  describe('SFTP Download Endpoint', () => {
    it('should return 501 Not Implemented', async () => {
      const response = await fetch(`${SFTP_BASE}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: SFTP_CONFIG.host,
          path: '/readme.txt',
        }),
      });

      expect(response.status).toBe(501);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.message).toContain('WebSocket');
    });
  });

  describe('SFTP Upload Endpoint', () => {
    it('should return 501 Not Implemented', async () => {
      const response = await fetch(`${SFTP_BASE}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: SFTP_CONFIG.host,
          path: '/upload/test.txt',
          content: 'test content',
        }),
      });

      expect(response.status).toBe(501);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.message).toContain('WebSocket');
    });
  });

  describe('SFTP Delete Endpoint', () => {
    it('should return 501 Not Implemented', async () => {
      const response = await fetch(`${SFTP_BASE}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: SFTP_CONFIG.host,
          path: '/test.txt',
        }),
      });

      expect(response.status).toBe(501);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.message).toContain('WebSocket');
    });
  });

  describe('SFTP Mkdir Endpoint', () => {
    it('should return 501 Not Implemented', async () => {
      const response = await fetch(`${SFTP_BASE}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: SFTP_CONFIG.host,
          path: '/new-directory',
        }),
      });

      expect(response.status).toBe(501);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.message).toContain('WebSocket');
    });
  });

  describe('SFTP Rename Endpoint', () => {
    it('should return 501 Not Implemented', async () => {
      const response = await fetch(`${SFTP_BASE}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: SFTP_CONFIG.host,
          oldPath: '/old.txt',
          newPath: '/new.txt',
        }),
      });

      expect(response.status).toBe(501);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.message).toContain('WebSocket');
    });
  });
});
