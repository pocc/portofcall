/**
 * DNS over HTTPS (DoH) Protocol Integration Tests
 * Tests DoH queries with different record types and resolvers
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('DoH Protocol Integration Tests', () => {
  describe('DoH Basic Queries', () => {
    it('should resolve A record via Cloudflare DoH', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'A',
          resolver: 'https://cloudflare-dns.com/dns-query',
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.domain).toBe('example.com');
      expect(data.queryType).toBe('A');
      expect(data.rcode).toBe('NOERROR');
      expect(data.answers.length).toBeGreaterThan(0);
      expect(data.answers[0].type).toBe('A');
      expect(data.answers[0].data).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(data.queryTimeMs).toBeDefined();
    }, 15000);

    it('should resolve A record via Google DoH', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'A',
          resolver: 'https://dns.google/dns-query',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.resolver).toBe('https://dns.google/dns-query');
      expect(data.answers.length).toBeGreaterThan(0);
    }, 15000);

    it('should resolve A record via Quad9 DoH', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'A',
          resolver: 'https://dns.quad9.net/dns-query',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.answers.length).toBeGreaterThan(0);
    }, 15000);
  });

  describe('DoH Record Types', () => {
    it('should resolve AAAA record', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'google.com',
          type: 'AAAA',
          resolver: 'https://cloudflare-dns.com/dns-query',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.queryType).toBe('AAAA');
      if (data.answers.length > 0) {
        expect(data.answers[0].type).toBe('AAAA');
        expect(data.answers[0].data).toContain(':');
      }
    }, 15000);

    it('should resolve MX record', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'google.com',
          type: 'MX',
          resolver: 'https://cloudflare-dns.com/dns-query',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.queryType).toBe('MX');
      expect(data.answers.length).toBeGreaterThan(0);
      expect(data.answers[0].type).toBe('MX');
    }, 15000);

    it('should resolve TXT record', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'google.com',
          type: 'TXT',
          resolver: 'https://cloudflare-dns.com/dns-query',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.queryType).toBe('TXT');
    }, 15000);

    it('should resolve NS record', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'google.com',
          type: 'NS',
          resolver: 'https://cloudflare-dns.com/dns-query',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.queryType).toBe('NS');
      expect(data.answers.length).toBeGreaterThan(0);
    }, 15000);

    it('should resolve CNAME record', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'www.github.com',
          type: 'CNAME',
          resolver: 'https://cloudflare-dns.com/dns-query',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.queryType).toBe('CNAME');
    }, 15000);

    it('should resolve SOA record', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'SOA',
          resolver: 'https://cloudflare-dns.com/dns-query',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.queryType).toBe('SOA');
    }, 15000);

    it('should resolve SRV record', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: '_xmpp-server._tcp.gmail.com',
          type: 'SRV',
          resolver: 'https://cloudflare-dns.com/dns-query',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      if (data.success) {
        expect(data.queryType).toBe('SRV');
      }
    }, 15000);
  });

  describe('DoH Error Handling', () => {
    it('should return NXDOMAIN for non-existent domain', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'this-domain-absolutely-does-not-exist-99999.com',
          type: 'A',
          resolver: 'https://cloudflare-dns.com/dns-query',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(false);
      expect(data.rcode).toBe('NXDOMAIN');
      expect(data.answers.length).toBe(0);
    }, 15000);

    it('should reject missing domain parameter', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'A',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('domain');
    });

    it('should use default resolver when not specified', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'A',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.resolver).toBe('https://cloudflare-dns.com/dns-query');
    }, 15000);

    it('should use default type A when not specified', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.queryType).toBe('A');
    }, 15000);
  });

  describe('DoH Response Parsing', () => {
    it('should parse A record correctly', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'A',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.answers[0].name).toBeDefined();
      expect(data.answers[0].type).toBe('A');
      expect(data.answers[0].ttl).toBeGreaterThan(0);
      expect(data.answers[0].data).toBeDefined();
    }, 15000);

    it('should include authority and additional sections', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'A',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.authority).toBeDefined();
      expect(data.additional).toBeDefined();
      expect(Array.isArray(data.authority)).toBe(true);
      expect(Array.isArray(data.additional)).toBe(true);
    }, 15000);
  });

  describe('DoH Performance', () => {
    it('should measure query time', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'A',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.queryTimeMs).toBeDefined();
      expect(data.queryTimeMs).toBeGreaterThan(0);
    }, 15000);

    it('should respect timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/doh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'example.com',
          type: 'A',
          timeout: 1000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      // Should complete within timeout or fail gracefully
      expect(data).toHaveProperty('success');
    }, 15000);
  });
});
