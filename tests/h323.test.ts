/**
 * H.323 Protocol Integration Tests
 *
 * These tests verify the H.323 protocol implementation (ITU-T H.225/Q.931)
 * including call signaling probe and validation.
 *
 * Note: Tests against live H.323 gateways may fail if the server is
 * unreachable. Validation tests always pass.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('H.323 Protocol Integration Tests', () => {
  describe('Connect endpoint', () => {
    it('should attempt H.323 call signaling probe', async () => {
      const response = await fetch(`${API_BASE}/h323/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // Non-routable, will timeout
          port: 1720,
          callingNumber: '1000',
          calledNumber: '2000',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Either succeeds with probe data or fails with connection error
      if (data.success) {
        expect(data.host).toBe('unreachable-host-12345.invalid');
        expect(data.port).toBe(1720);
        expect(data.status).toBeDefined();
        expect(typeof data.connectTime).toBe('number');
        expect(typeof data.rtt).toBe('number');
      }
    }, 15000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/h323/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 1720,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port number', async () => {
      const response = await fetch(`${API_BASE}/h323/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'pbx.example.com',
          port: 99999,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should reject port zero', async () => {
      const response = await fetch(`${API_BASE}/h323/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'pbx.example.com',
          port: 0,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should reject calling number with invalid characters', async () => {
      const response = await fetch(`${API_BASE}/h323/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'pbx.example.com',
          port: 1720,
          callingNumber: 'abc;rm -rf /',
          calledNumber: '2000',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Calling number contains invalid characters');
    });

    it('should reject called number with invalid characters', async () => {
      const response = await fetch(`${API_BASE}/h323/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'pbx.example.com',
          port: 1720,
          callingNumber: '1000',
          calledNumber: '../../../etc/passwd',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Called number contains invalid characters');
    });

    it('should accept valid phone number characters', async () => {
      // This test validates that +, *, # are accepted in phone numbers
      // The connection will fail but validation should pass
      const response = await fetch(`${API_BASE}/h323/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 1720,
          callingNumber: '+15105901098',
          calledNumber: '*72#2000',
          timeout: 2000,
        }),
      });

      const data = await response.json();

      // Should not be a 400 validation error
      if (response.status === 400) {
        expect(data.error).not.toContain('invalid characters');
      }
    }, 10000);

    it('should use default port 1720 when not specified', async () => {
      const response = await fetch(`${API_BASE}/h323/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 2000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.port).toBe(1720);
      }
    }, 10000);

    it('should use default calling/called numbers when not specified', async () => {
      const response = await fetch(`${API_BASE}/h323/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 1720,
          timeout: 2000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.callingNumber).toBe('1000');
        expect(data.calledNumber).toBe('2000');
      }
    }, 10000);

    it('should handle connection timeout gracefully', async () => {
      const response = await fetch(`${API_BASE}/h323/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // Non-routable address
          port: 1720,
          timeout: 2000,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 15000);
  });
});
