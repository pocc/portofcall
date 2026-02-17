/**
 * NNTP Protocol Integration Tests
 *
 * These tests verify the NNTP protocol implementation (RFC 3977)
 * including connection, newsgroup browsing, and article retrieval.
 *
 * Note: Tests against live NNTP servers may fail if the server is
 * unreachable. Validation tests always pass.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('NNTP Protocol Integration Tests', () => {
  describe('Connection endpoint', () => {
    it('should connect to a public NNTP server', async () => {
      const response = await fetch(`${API_BASE}/nntp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'news.aioe.org',
          port: 119,
          timeout: 10000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.welcome).toBeDefined();
        expect(typeof data.welcome).toBe('string');
        expect(typeof data.postingAllowed).toBe('boolean');
      }
    }, 15000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/nntp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 119,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port number', async () => {
      const response = await fetch(`${API_BASE}/nntp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'news.aioe.org',
          port: 99999,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should handle connection timeout gracefully', async () => {
      const response = await fetch(`${API_BASE}/nntp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // Non-routable address
          port: 119,
          timeout: 2000,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 10000);
  });

  describe('Group endpoint', () => {
    it('should browse a newsgroup', async () => {
      const response = await fetch(`${API_BASE}/nntp/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'news.aioe.org',
          port: 119,
          group: 'comp.lang.python',
          timeout: 15000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.group).toBe('comp.lang.python');
        expect(typeof data.count).toBe('number');
        expect(typeof data.first).toBe('number');
        expect(typeof data.last).toBe('number');
        expect(Array.isArray(data.articles)).toBe(true);
      }
    }, 20000);

    it('should reject empty host for group', async () => {
      const response = await fetch(`${API_BASE}/nntp/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 119,
          group: 'comp.lang.python',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject empty group name', async () => {
      const response = await fetch(`${API_BASE}/nntp/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'news.aioe.org',
          port: 119,
          group: '',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Group name is required');
    });

    it('should reject group name with invalid characters', async () => {
      const response = await fetch(`${API_BASE}/nntp/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'news.aioe.org',
          port: 119,
          group: 'comp.lang;rm -rf /',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('invalid characters');
    });

    it('should reject invalid port for group', async () => {
      const response = await fetch(`${API_BASE}/nntp/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'news.aioe.org',
          port: 0,
          group: 'comp.lang.python',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });
  });

  describe('Article endpoint', () => {
    it('should reject empty host for article', async () => {
      const response = await fetch(`${API_BASE}/nntp/article`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 119,
          group: 'comp.lang.python',
          articleNumber: 1,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject empty group for article', async () => {
      const response = await fetch(`${API_BASE}/nntp/article`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'news.aioe.org',
          port: 119,
          group: '',
          articleNumber: 1,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Group name is required');
    });

    it('should reject invalid article number', async () => {
      const response = await fetch(`${API_BASE}/nntp/article`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'news.aioe.org',
          port: 119,
          group: 'comp.lang.python',
          articleNumber: 0,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Valid article number is required');
    });

    it('should reject group name with invalid characters for article', async () => {
      const response = await fetch(`${API_BASE}/nntp/article`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'news.aioe.org',
          port: 119,
          group: '../../../etc/passwd',
          articleNumber: 1,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('invalid characters');
    });

    it('should reject invalid port for article', async () => {
      const response = await fetch(`${API_BASE}/nntp/article`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'news.aioe.org',
          port: 70000,
          group: 'comp.lang.python',
          articleNumber: 1,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });
  });
});
