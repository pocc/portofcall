/**
 * DNS Protocol Integration Tests
 * Tests DNS over TCP queries and response parsing
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('DNS Protocol Integration Tests', () => {
  describe('DNS Query (A Record)', () => {
    it('should resolve example.com A record via Google DNS', async () => {
      const response = await fetch(`${API_BASE}/dns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'A',
          server: '8.8.8.8',
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.domain).toBe('example.com');
      expect(data.queryType).toBe('A');
      expect(data.rcode).toBe('NOERROR');
      expect(data.answers.length).toBeGreaterThan(0);
      expect(data.answers[0].type).toBe('A');
      // example.com resolves to 93.184.216.34
      expect(data.answers[0].data).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(data.queryTimeMs).toBeDefined();
    }, 15000);

    it('should resolve google.com A record', async () => {
      const response = await fetch(`${API_BASE}/dns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'google.com',
          type: 'A',
          server: '8.8.8.8',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.answers.length).toBeGreaterThan(0);
    }, 15000);
  });

  describe('DNS Query (Other Record Types)', () => {
    it('should resolve MX records for google.com', async () => {
      const response = await fetch(`${API_BASE}/dns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'google.com',
          type: 'MX',
          server: '8.8.8.8',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.queryType).toBe('MX');
      expect(data.answers.length).toBeGreaterThan(0);
      // MX records have priority and hostname
      expect(data.answers[0].type).toBe('MX');
    }, 15000);

    it('should resolve NS records for google.com', async () => {
      const response = await fetch(`${API_BASE}/dns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'google.com',
          type: 'NS',
          server: '8.8.8.8',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.answers.length).toBeGreaterThan(0);
      expect(data.answers[0].type).toBe('NS');
    }, 15000);

    it('should resolve AAAA records for google.com', async () => {
      const response = await fetch(`${API_BASE}/dns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'google.com',
          type: 'AAAA',
          server: '8.8.8.8',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      // Google has AAAA records
      if (data.answers.length > 0) {
        expect(data.answers[0].type).toBe('AAAA');
        expect(data.answers[0].data).toContain(':');
      }
    }, 15000);

    it('should resolve TXT records for google.com', async () => {
      const response = await fetch(`${API_BASE}/dns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'google.com',
          type: 'TXT',
          server: '8.8.8.8',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.answers.length).toBeGreaterThan(0);
    }, 15000);
  });

  describe('DNS Error Handling', () => {
    it('should return NXDOMAIN for non-existent domain', async () => {
      const response = await fetch(`${API_BASE}/dns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'this-domain-definitely-does-not-exist-12345.com',
          type: 'A',
          server: '8.8.8.8',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.rcode).toBe('NXDOMAIN');
      expect(data.answers.length).toBe(0);
    }, 15000);

    it('should fail with missing domain parameter', async () => {
      const response = await fetch(`${API_BASE}/dns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'A',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('domain');
    });

    it('should reject invalid record type', async () => {
      const response = await fetch(`${API_BASE}/dns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'INVALID',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Unknown record type');
    });

    it('should reject GET method', async () => {
      const response = await fetch(`${API_BASE}/dns/query`);
      expect(response.status).toBe(405);
    });
  });

  describe('DNS with Different Servers', () => {
    it('should query Cloudflare DNS (1.1.1.1)', async () => {
      const response = await fetch(`${API_BASE}/dns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'A',
          server: '1.1.1.1',
        }),
      });

      const data = await response.json();
      // 1.1.1.1 may be blocked from CF workers (Cloudflare IP)
      if (!response.ok || !data.success) return;
      expect(data.server).toBe('1.1.1.1');
      expect(data.answers.length).toBeGreaterThan(0);
    }, 15000);

    it('should query Quad9 DNS (9.9.9.9)', async () => {
      const response = await fetch(`${API_BASE}/dns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'A',
          server: '9.9.9.9',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.server).toBe('9.9.9.9');
    }, 15000);
  });

  describe('DNS Response Flags', () => {
    it('should include response flags', async () => {
      const response = await fetch(`${API_BASE}/dns/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'A',
          server: '8.8.8.8',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.flags).toBeDefined();
      expect(data.flags.qr).toBe(true); // Is a response
      expect(data.flags.rd).toBe(true); // Recursion desired
      expect(data.flags.ra).toBe(true); // Recursion available
    }, 15000);
  });
});
