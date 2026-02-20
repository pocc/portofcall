/**
 * Cloudflare Detector Utility Tests
 * Tests the Cloudflare detection logic using various protocols
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Cloudflare Detector Utility Tests', () => {
  describe('Detection via TCP Protocol', () => {
    it('should detect cloudflare.com as Cloudflare-protected', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
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
    }, 10000);

    it('should allow connection to non-Cloudflare host', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '8.8.8.8', // Google DNS - not Cloudflare
          port: 53,
          timeout: 5000,
        }),
      });

      // Should succeed or fail with connection error, not Cloudflare block
      const data = await response.json();
      // Should not be blocked by Cloudflare detection
      expect(response.status).not.toBe(403);
      if (data.isCloudflare !== undefined) {
        expect(data.isCloudflare).toBe(false);
      }
    }, 15000);

    it('should detect Cloudflare IP address directly', async () => {
      // 104.16.1.1 is in Cloudflare's 104.16.0.0/13 range
      const response = await fetch(`${API_BASE}/tcp/send`, {
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
    }, 10000);
  });

  describe('IPv4 Range Detection', () => {
    it('should detect Cloudflare IPv4 range 173.245.48.0/20', async () => {
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '173.245.48.1',
          port: 443,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);

    it('should detect Cloudflare IPv4 range 172.64.0.0/13', async () => {
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '172.64.1.1',
          port: 443,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);

    it('should allow connection to non-Cloudflare IP', async () => {
      // 8.8.8.8 is Google DNS, not Cloudflare
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '8.8.8.8',
          port: 53,
        }),
      });

      const data = await response.json();
      expect(data.isCloudflare).toBeUndefined();
    }, 10000);
  });

  describe('Detection across Multiple Protocols', () => {
    it('should block RELP connection to Cloudflare host', async () => {
      const response = await fetch(`${API_BASE}/relp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 20514,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);

    it('should block RELP send to Cloudflare host', async () => {
      const response = await fetch(`${API_BASE}/relp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 20514,
          message: 'Test message',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);

    it('should block RELP batch to Cloudflare host', async () => {
      const response = await fetch(`${API_BASE}/relp/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 20514,
          messages: ['Test 1', 'Test 2'],
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  describe('Error Message Content', () => {
    it('should provide helpful error message explaining the restriction', async () => {
      const response = await fetch(`${API_BASE}/tcp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 443,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('Cloudflare Workers cannot connect');
      expect(data.error).toContain('security restrictions');
    }, 10000);

    it('should include both hostname and IP in error message', async () => {
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
      expect(data.error).toContain('cloudflare.com');
      // Should contain an IP address pattern
      expect(data.error).toMatch(/\d+\.\d+\.\d+\.\d+/);
    }, 10000);
  });

  describe('Detection Performance', () => {
    it('should detect Cloudflare IP quickly without DNS lookup', async () => {
      const start = Date.now();
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '104.16.1.1',
          port: 443,
        }),
      });

      const elapsed = Date.now() - start;
      expect(response.status).toBe(403);

      // Should be fast since no DNS lookup needed
      expect(elapsed).toBeLessThan(3000);
    }, 5000);
  });

  describe('Edge Cases', () => {
    it('should handle DNS resolution failures gracefully', async () => {
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'this-domain-absolutely-does-not-exist-12345.invalid',
          port: 443,
          timeout: 3000,
        }),
      });

      // Should fail with connection error, not Cloudflare detection error
      const data = await response.json();
      expect(data.success).toBe(false);
      // Should not indicate Cloudflare blocking
      if (data.isCloudflare !== undefined) {
        expect(data.isCloudflare).toBe(false);
      }
    }, 10000);
  });
});
