/**
 * Cloudflare Detection Tests
 * Tests that we properly detect and block Cloudflare-protected hosts
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Cloudflare Detection Tests', () => {
  describe('TCP Ping with Cloudflare Check', () => {
    it('should block connection to cloudflare.com (Cloudflare-protected)', async () => {
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 443,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
      expect(data.error).toContain('cannot connect');
    });

    it('should allow connection to non-Cloudflare host', async () => {
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'google.com',
          port: 443,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.isCloudflare).toBeUndefined();
    });

    it('should block connection to Cloudflare IP directly', async () => {
      // This is a Cloudflare IP (104.16.0.0/13 range)
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '104.16.1.1',
          port: 443,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    });
  });

  describe('FTP Connect with Cloudflare Check', () => {
    it('should block FTP connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/ftp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 21,
          username: 'test',
          password: 'test',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    });
  });

  describe('SSH Connect with Cloudflare Check', () => {
    it('should block SSH connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/ssh/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 22,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    });
  });
});
