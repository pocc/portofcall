/**
 * WHOIS Protocol Integration Tests
 *
 * These tests verify the WHOIS protocol implementation by querying
 * real WHOIS servers for domain registration information.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('WHOIS Protocol Integration Tests', () => {
  it('should successfully lookup a .com domain', async () => {
    const response = await fetch(`${API_BASE}/whois/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'example.com',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.domain).toBe('example.com');
    expect(data.server).toBe('whois.verisign-grs.com');
    expect(data.response).toBeDefined();
    expect(data.response.length).toBeGreaterThan(0);
    expect(data.response.toLowerCase()).toContain('domain name');
  }, 15000);

  it('should successfully lookup a .org domain', async () => {
    const response = await fetch(`${API_BASE}/whois/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'wikipedia.org',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.domain).toBe('wikipedia.org');
    expect(data.server).toBe('whois.pir.org');
    expect(data.response).toBeDefined();
    expect(data.response.length).toBeGreaterThan(0);
  }, 15000);

  it('should auto-select correct WHOIS server for .edu domain', async () => {
    const response = await fetch(`${API_BASE}/whois/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'mit.edu',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.domain).toBe('mit.edu');
    expect(data.server).toBe('whois.educause.edu');
    expect(data.response).toBeDefined();
  }, 15000);

  it('should allow manual WHOIS server selection', async () => {
    const response = await fetch(`${API_BASE}/whois/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'google.com',
        server: 'whois.verisign-grs.com',
        port: 43,
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.domain).toBe('google.com');
    expect(data.server).toBe('whois.verisign-grs.com');
    expect(data.response).toBeDefined();
  }, 15000);

  it('should reject empty domain', async () => {
    const response = await fetch(`${API_BASE}/whois/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: '',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Domain is required');
  });

  it('should reject invalid domain format', async () => {
    const response = await fetch(`${API_BASE}/whois/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'invalid..domain..com',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid domain format');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/whois/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'example.com',
        port: 99999,
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should handle WHOIS response for various TLDs', async () => {
    const domains = [
      { domain: 'example.com', server: 'whois.verisign-grs.com' },
      { domain: 'example.net', server: 'whois.verisign-grs.com' },
      { domain: 'example.org', server: 'whois.pir.org' },
    ];

    for (const { domain, server } of domains) {
      const response = await fetch(`${API_BASE}/whois/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          timeout: 10000,
        }),
      });

      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.domain).toBe(domain);
      expect(data.server).toBe(server);
      expect(data.response).toBeDefined();
      expect(data.response.length).toBeGreaterThan(0);
    }
  }, 30000);
});
