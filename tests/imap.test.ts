/**
 * IMAP Protocol Integration Tests
 * Tests IMAP connectivity and mailbox management
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('IMAP Protocol Integration Tests', () => {
  describe('IMAP Connect (HTTP)', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/imap/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-imap-host-12345.example.com',
          port: 143,
          username: 'test',
          password: 'test',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/imap/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 143,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('host');
    });

    it('should support GET request with query parameters', async () => {
      const params = new URLSearchParams({
        host: 'non-existent-imap.example.com',
        port: '143',
        username: 'test',
        password: 'test',
        timeout: '5000',
      });

      const response = await fetch(`${API_BASE}/imap/connect?${params}`);
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/imap/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 143,
          username: 'test',
          password: 'test',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('IMAP Error Handling', () => {
    it('should return 400 for missing host', async () => {
      const response = await fetch(`${API_BASE}/imap/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 143,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully', async () => {
      const response = await fetch(`${API_BASE}/imap/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 143,
          username: 'test',
          password: 'test',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });

  describe('IMAP List Mailboxes', () => {
    it('should require authentication for listing', async () => {
      const response = await fetch(`${API_BASE}/imap/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'imap.example.com',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should reject GET requests to list endpoint', async () => {
      const response = await fetch(`${API_BASE}/imap/list`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
      const data = await response.json();
      expect(data.error).toContain('Method not allowed');
    });

    it('should fail when listing from non-existent server', async () => {
      const response = await fetch(`${API_BASE}/imap/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-imap.example.com',
          port: 143,
          username: 'test',
          password: 'test',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);
  });

  describe('IMAP Select Mailbox', () => {
    it('should require all parameters for select', async () => {
      const response = await fetch(`${API_BASE}/imap/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'imap.example.com',
          username: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should reject GET requests to select endpoint', async () => {
      const response = await fetch(`${API_BASE}/imap/select`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
      const data = await response.json();
      expect(data.error).toContain('Method not allowed');
    });

    it('should fail when selecting from non-existent server', async () => {
      const response = await fetch(`${API_BASE}/imap/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-imap.example.com',
          port: 143,
          username: 'test',
          password: 'test',
          mailbox: 'INBOX',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);
  });

  describe('IMAP Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/imap/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 143,
          username: 'test',
          password: 'test',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);

    it('should block listing from Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/imap/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 143,
          username: 'test',
          password: 'test',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);

    it('should block select from Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/imap/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 143,
          username: 'test',
          password: 'test',
          mailbox: 'INBOX',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  describe('IMAP Port Support', () => {
    it('should accept port 143 (IMAP)', async () => {
      const response = await fetch(`${API_BASE}/imap/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 143,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept port 993 (IMAPS)', async () => {
      const response = await fetch(`${API_BASE}/imap/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 993,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });
});
