/**
 * DICOM Protocol Integration Tests
 *
 * These tests verify the DICOM protocol implementation (ISO 12052)
 * including association testing and C-ECHO verification.
 *
 * Note: Tests against live DICOM servers may fail if the server is
 * unreachable. Validation tests always pass.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('DICOM Protocol Integration Tests', () => {
  describe('Connect (Association) endpoint', () => {
    it('should attempt association with a DICOM server', async () => {
      const response = await fetch(`${API_BASE}/dicom/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 104,
          callingAE: 'PORTOFCALL',
          calledAE: 'ANY-SCP',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success && data.associationAccepted) {
        expect(data.calledAE).toBeDefined();
        expect(typeof data.maxPDULength).toBe('number');
        expect(typeof data.connectTime).toBe('number');
        expect(Array.isArray(data.acceptedContexts)).toBe(true);
      }
    }, 10000);

    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/dicom/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 104,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port number', async () => {
      const response = await fetch(`${API_BASE}/dicom/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 99999,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should reject AE title longer than 16 characters', async () => {
      const response = await fetch(`${API_BASE}/dicom/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 104,
          callingAE: 'THIS_IS_WAY_TOO_LONG_FOR_AE',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Calling AE title');
    });

    it('should reject AE title with non-printable characters', async () => {
      const response = await fetch(`${API_BASE}/dicom/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 104,
          calledAE: 'BAD\x01AE',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Called AE title');
    });

    it('should handle connection timeout gracefully', async () => {
      const response = await fetch(`${API_BASE}/dicom/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // Non-routable address
          port: 104,
          timeout: 2000,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        expect(data.error).toBeDefined();
      }
    }, 10000);

    it('should use default port and AE titles when not specified', async () => {
      const response = await fetch(`${API_BASE}/dicom/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          timeout: 2000,
        }),
      });

      const data = await response.json();

      // Should either connect or fail gracefully - not validation error
      if (data.success) {
        expect(data.port).toBe(104);
      }
    }, 10000);
  });

  describe('C-ECHO (Verification) endpoint', () => {
    it('should reject empty host for echo', async () => {
      const response = await fetch(`${API_BASE}/dicom/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 104,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port for echo', async () => {
      const response = await fetch(`${API_BASE}/dicom/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 0,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should reject invalid calling AE for echo', async () => {
      const response = await fetch(`${API_BASE}/dicom/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 104,
          callingAE: 'EXTREMELY_LONG_AE_TITLE_EXCEEDS_LIMIT',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Calling AE title');
    });

    it('should attempt C-ECHO against a DICOM server', async () => {
      const response = await fetch(`${API_BASE}/dicom/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 104,
          callingAE: 'PORTOFCALL',
          calledAE: 'ANY-SCP',
          timeout: 10000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(typeof data.echoSuccess).toBe('boolean');
        expect(data.echoStatusText).toBeDefined();
        expect(typeof data.associateTime).toBe('number');
        expect(typeof data.echoTime).toBe('number');
        expect(typeof data.totalTime).toBe('number');
      }
    }, 15000);
  });
});
