/**
 * Oracle Database (TNS Protocol) Integration Tests
 * Tests Oracle TNS connectivity and handshake
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Oracle TNS Protocol Integration Tests', () => {
  describe('Oracle Connect (HTTP)', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/oracle/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-oracle-host-12345.example.com',
          port: 1521,
          serviceName: 'ORCL',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/oracle/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 1521,
          serviceName: 'ORCL',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('host');
    });

    it('should fail with missing serviceName and SID', async () => {
      const response = await fetch(`${API_BASE}/oracle/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'oracle.example.com',
          port: 1521,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('serviceName or sid');
    });

    it('should support GET request with query parameters (service name)', async () => {
      const params = new URLSearchParams({
        host: 'non-existent-oracle.example.com',
        port: '1521',
        serviceName: 'ORCL',
        timeout: '5000',
      });

      const response = await fetch(`${API_BASE}/oracle/connect?${params}`);
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should support GET request with query parameters (SID)', async () => {
      const params = new URLSearchParams({
        host: 'non-existent-oracle.example.com',
        port: '1521',
        sid: 'XE',
        timeout: '5000',
      });

      const response = await fetch(`${API_BASE}/oracle/connect?${params}`);
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/oracle/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 1521,
          serviceName: 'ORCL',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('Oracle Error Handling', () => {
    it('should return 400 for missing host', async () => {
      const response = await fetch(`${API_BASE}/oracle/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 1521,
          serviceName: 'ORCL',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing serviceName and SID', async () => {
      const response = await fetch(`${API_BASE}/oracle/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'oracle.example.com',
          port: 1521,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('serviceName or sid');
    });

    it('should handle network errors gracefully', async () => {
      const response = await fetch(`${API_BASE}/oracle/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 1521,
          sid: 'XE',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });

  describe('Oracle Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/oracle/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 1521,
          serviceName: 'ORCL',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });

  describe('Oracle Port Support', () => {
    it('should accept port 1521 (Oracle default)', async () => {
      const response = await fetch(`${API_BASE}/oracle/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 1521,
          serviceName: 'ORCL',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept custom ports', async () => {
      const response = await fetch(`${API_BASE}/oracle/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 1522,
          sid: 'XE',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('Oracle Service Name vs SID', () => {
    it('should accept service name format', async () => {
      const response = await fetch(`${API_BASE}/oracle/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 1521,
          serviceName: 'XEPDB1',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept SID format', async () => {
      const response = await fetch(`${API_BASE}/oracle/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 1521,
          sid: 'XE',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });
});
