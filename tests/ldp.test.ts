/**
 * LDP (Label Distribution Protocol) Integration Tests
 * Tests Initialization handshake and peer detection
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('LDP Protocol Integration Tests', () => {
  describe('LDP Connect (HTTP)', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/ldp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-lsr-12345.example.com',
          port: 646,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/ldp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 646,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('host');
    });

    it('should accept default port when not specified', async () => {
      const response = await fetch(`${API_BASE}/ldp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should accept custom port', async () => {
      const response = await fetch(`${API_BASE}/ldp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6460,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/ldp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 646,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('LDP Probe (HTTP)', () => {
    it('should handle probe to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/ldp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-lsr-12345.example.com',
          port: 646,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/ldp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 646,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('host');
    });

    it('should accept default port when not specified', async () => {
      const response = await fetch(`${API_BASE}/ldp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('LDP Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/ldp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 646,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);

    it('should block probe to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/ldp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 646,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  describe('LDP Response Format', () => {
    it('should return error with proper structure for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ldp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 646,
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    }, 10000);

    it('should reject non-POST requests to connect', async () => {
      const response = await fetch(`${API_BASE}/ldp/connect`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should reject non-POST requests to probe', async () => {
      const response = await fetch(`${API_BASE}/ldp/probe`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });
});
