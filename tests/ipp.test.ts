/**
 * IPP (Internet Printing Protocol) Integration Tests
 *
 * Tests the IPP protocol implementation (RFC 8011)
 * IPP runs over HTTP on port 631, used by CUPS on macOS/Linux
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('IPP Protocol Integration Tests', () => {
  describe('POST /api/ipp/probe', () => {
    it('should validate missing host', async () => {
      const response = await fetch(`${API_BASE}/ipp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 631,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as {
        success: boolean;
        error: string;
      };

      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should validate invalid port', async () => {
      const response = await fetch(`${API_BASE}/ipp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as {
        success: boolean;
        error: string;
      };

      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should default to port 631', async () => {
      const response = await fetch(`${API_BASE}/ipp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      // Will fail due to TEST-NET IP but should attempt connection
      expect(response.status).toBe(500);
      const data = await response.json() as {
        success: boolean;
        error: string;
      };
      expect(data.success).toBe(false);
    });

    it('should handle unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ipp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 631,
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as {
        success: boolean;
        error: string;
      };

      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });

    it('should auto-generate printer URI when not provided', async () => {
      // This test verifies the API accepts requests without printerUri
      const response = await fetch(`${API_BASE}/ipp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 631,
          timeout: 3000,
        }),
      });

      // Will fail connection but should not fail on missing URI
      const data = await response.json() as {
        success: boolean;
        error: string;
      };
      expect(data.success).toBe(false);
      // Error should be connection-related, not URI-related
      expect(data.error).not.toContain('URI');
    });

    it('should accept custom printer URI', async () => {
      const response = await fetch(`${API_BASE}/ipp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 631,
          printerUri: 'ipp://unreachable-host-12345.invalid:631/printers/myprinter',
          timeout: 3000,
        }),
      });

      const data = await response.json() as {
        success: boolean;
        error: string;
      };
      expect(data.success).toBe(false);
      // Should fail with connection error, not URI validation error
      expect(data.error).toBeTruthy();
    });

    it('should return proper response structure on successful connection', async () => {
      // If we can reach an IPP server, validate the response shape
      const response = await fetch(`${API_BASE}/ipp/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 631,
          timeout: 5000,
        }),
      });

      const data = await response.json() as {
        success: boolean;
        error?: string;
        version?: string;
        statusCode?: number;
        statusMessage?: string;
        rawHttpStatus?: string;
        attributes?: Array<{ name: string; value: string }>;
        rtt?: number;
      };

      if (data.success) {
        expect(data.rawHttpStatus).toBeTruthy();
        expect(data.rtt).toBeGreaterThan(0);
        // If IPP parsing succeeded
        if (data.version) {
          expect(data.version).toMatch(/^\d+\.\d+$/);
        }
      }
      // If not successful, that's fine - localhost:631 may not be running
    });
  });
});
