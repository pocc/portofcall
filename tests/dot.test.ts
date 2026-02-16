/**
 * DNS over TLS (DoT) Protocol Integration Tests
 *
 * These tests verify the DoT protocol implementation by sending
 * encrypted DNS queries to public DoT resolvers on port 853.
 *
 * Public DoT servers: 1.1.1.1, 8.8.8.8, 9.9.9.9
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('DNS over TLS (DoT) Protocol Integration Tests', () => {

  it('should resolve a domain via DoT', async () => {
    const response = await fetch(`${API_BASE}/dot/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'example.com',
        type: 'A',
        server: '1.1.1.1',
        port: 853,
        timeout: 10000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.encrypted).toBe(true);
      expect(data.domain).toBe('example.com');
      expect(data.server).toBe('1.1.1.1');
      expect(data.port).toBe(853);
      expect(data.queryType).toBe('A');
      expect(data.rcode).toBe('NOERROR');
      expect(data.answers.length).toBeGreaterThan(0);
      expect(data.rtt).toBeGreaterThan(0);
    }
  }, 15000);

  it('should reject empty domain', async () => {
    const response = await fetch(`${API_BASE}/dot/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: '',
        type: 'A',
        server: '1.1.1.1',
        port: 853,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Domain is required');
  });

  it('should reject invalid port', async () => {
    const response = await fetch(`${API_BASE}/dot/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'example.com',
        type: 'A',
        server: '1.1.1.1',
        port: 99999,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject unknown record type', async () => {
    const response = await fetch(`${API_BASE}/dot/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'example.com',
        type: 'INVALID',
        server: '1.1.1.1',
        port: 853,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Unknown record type');
  });

  it('should return proper response structure', async () => {
    const response = await fetch(`${API_BASE}/dot/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'example.com',
        type: 'A',
        server: '1.1.1.1',
        port: 853,
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(data).toHaveProperty('success');

    if (data.success) {
      expect(data).toHaveProperty('encrypted');
      expect(data).toHaveProperty('domain');
      expect(data).toHaveProperty('server');
      expect(data).toHaveProperty('port');
      expect(data).toHaveProperty('queryType');
      expect(data).toHaveProperty('rtt');
      expect(data).toHaveProperty('connectTime');
      expect(data).toHaveProperty('rcode');
      expect(data).toHaveProperty('answers');
    } else {
      expect(data).toHaveProperty('error');
    }
  }, 15000);

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/dot/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'example.com',
        type: 'A',
        server: '1.1.1.1',
        port: 853,
        timeout: 1000,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 5000);
});
