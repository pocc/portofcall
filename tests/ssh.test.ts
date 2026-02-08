/**
 * SSH Protocol Integration Tests
 * Tests SSH connectivity checks (not full interactive sessions)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api/ssh';

// Public SSH test server
const SSH_CONFIG = {
  host: 'test.rebex.net',
  port: 22,
};

describe('SSH Protocol Integration Tests', () => {
  describe('SSH Connect (HTTP)', () => {
    it('should connect and read SSH banner', async () => {
      const response = await fetch(`${API_BASE}/connect`, {
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

      const response = await fetch(`${API_BASE}/connect?${params}`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.banner).toBeDefined();
    });

    it('should fail with non-existent host', async () => {
      const response = await fetch(`${API_BASE}/connect`, {
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
      const response = await fetch(`${API_BASE}/connect`, {
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
    it('should return 501 Not Implemented', async () => {
      const response = await fetch(`${API_BASE}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: SSH_CONFIG.host,
          command: 'ls',
        }),
      });

      expect(response.status).toBe(501);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.message).toContain('WebSocket');
    });
  });

  describe('SSH Disconnect Endpoint', () => {
    it('should return success message', async () => {
      const response = await fetch(`${API_BASE}/disconnect`, {
        method: 'POST',
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('WebSocket');
    });
  });
});
