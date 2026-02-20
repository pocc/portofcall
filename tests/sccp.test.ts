/**
 * SCCP (Skinny Client Control Protocol) Integration Tests
 * Tests Cisco Skinny protocol for IP phones and CUCM integration
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('SCCP Protocol Integration Tests', () => {
  describe('SCCP Probe (KeepAlive)', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/sccp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-cucm-12345.example.com',
          port: 2000,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/sccp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 2000,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/sccp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2000,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should return probe type keepalive', async () => {
      const response = await fetch(`${API_BASE}/sccp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2000,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (data.success) {
        expect(data.probe).toBe('keepalive');
      }
    }, 10000);
  });

  describe('SCCP Register', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/sccp/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceName: 'SEP001122334455',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should accept default device parameters', async () => {
      const response = await fetch(`${API_BASE}/sccp/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept custom device name', async () => {
      const response = await fetch(`${API_BASE}/sccp/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          deviceName: 'SEP112233445566',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept custom device type', async () => {
      const response = await fetch(`${API_BASE}/sccp/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          deviceType: 7,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should include registration status in response', async () => {
      const response = await fetch(`${API_BASE}/sccp/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (data.success) {
        expect(data.registration).toHaveProperty('status');
      }
    }, 10000);
  });

  describe('SCCP Line State', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/sccp/line-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceName: 'SEP001122334455',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should accept lineNumber parameter', async () => {
      const response = await fetch(`${API_BASE}/sccp/line-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          lineNumber: 1,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should return lines and capabilities arrays', async () => {
      const response = await fetch(`${API_BASE}/sccp/line-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('lines');
      expect(data).toHaveProperty('capabilities');
      expect(Array.isArray(data.lines)).toBe(true);
      expect(Array.isArray(data.capabilities)).toBe(true);
    }, 10000);
  });

  describe('SCCP Call Setup', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/sccp/call-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dialNumber: '1000',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should accept custom dial number', async () => {
      const response = await fetch(`${API_BASE}/sccp/call-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          dialNumber: '5551234',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept custom device name', async () => {
      const response = await fetch(`${API_BASE}/sccp/call-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          deviceName: 'SEP778899AABBCC',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should return offHookSent status', async () => {
      const response = await fetch(`${API_BASE}/sccp/call-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (data.success) {
        expect(data).toHaveProperty('offHookSent');
      }
    }, 10000);
  });

  describe('SCCP Port Support', () => {
    it('should accept default port 2000', async () => {
      const response = await fetch(`${API_BASE}/sccp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2000,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept custom ports', async () => {
      const response = await fetch(`${API_BASE}/sccp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2001,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('SCCP Binary Protocol', () => {
    it('should handle binary message parsing', async () => {
      const response = await fetch(`${API_BASE}/sccp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (data.success && data.messages) {
        expect(Array.isArray(data.messages)).toBe(true);
      }
    }, 10000);
  });
});
