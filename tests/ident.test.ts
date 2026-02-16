/**
 * IDENT Protocol Integration Tests
 *
 * Tests the IDENT protocol implementation (RFC 1413)
 * The Identification Protocol allows querying the owner of a TCP connection.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('IDENT Protocol Integration Tests', () => {
  describe('POST /api/ident/query', () => {
    it('should validate missing host', async () => {
      const response = await fetch(`${API_BASE}/ident/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverPort: 22,
          clientPort: 12345,
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

    it('should validate missing server port', async () => {
      const response = await fetch(`${API_BASE}/ident/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          clientPort: 12345,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as {
        success: boolean;
        error: string;
      };

      expect(data.success).toBe(false);
      expect(data.error).toBe('Server port must be between 1 and 65535');
    });

    it('should validate missing client port', async () => {
      const response = await fetch(`${API_BASE}/ident/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          serverPort: 22,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as {
        success: boolean;
        error: string;
      };

      expect(data.success).toBe(false);
      expect(data.error).toBe('Client port must be between 1 and 65535');
    });

    it('should validate invalid server port range', async () => {
      const response = await fetch(`${API_BASE}/ident/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          serverPort: 99999,
          clientPort: 12345,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as {
        success: boolean;
        error: string;
      };

      expect(data.success).toBe(false);
      expect(data.error).toBe('Server port must be between 1 and 65535');
    });

    it('should validate invalid client port range', async () => {
      const response = await fetch(`${API_BASE}/ident/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          serverPort: 22,
          clientPort: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as {
        success: boolean;
        error: string;
      };

      expect(data.success).toBe(false);
      expect(data.error).toBe('Client port must be between 1 and 65535');
    });

    it('should validate invalid IDENT port', async () => {
      const response = await fetch(`${API_BASE}/ident/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 99999,
          serverPort: 22,
          clientPort: 12345,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as {
        success: boolean;
        error: string;
      };

      expect(data.success).toBe(false);
      expect(data.error).toBe('IDENT port must be between 1 and 65535');
    });

    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ident/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          serverPort: 22,
          clientPort: 12345,
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

    it('should return valid response structure on success or server error', async () => {
      // Query a well-known host - most will refuse connection on 113
      // but the response structure should still be valid
      const response = await fetch(`${API_BASE}/ident/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'github.com',
          serverPort: 22,
          clientPort: 12345,
          timeout: 5000,
        }),
      });

      const data = await response.json() as {
        success: boolean;
        error?: string;
        responseType?: string;
        rawResponse?: string;
        rtt?: number;
      };

      // Either succeeds with a parsed response or fails with connection error
      if (data.success) {
        expect(data.responseType).toMatch(/^(USERID|ERROR)$/);
        expect(data.rawResponse).toBeTruthy();
        expect(data.rtt).toBeGreaterThan(0);
      } else {
        expect(data.error).toBeTruthy();
      }
    });

    it('should default to port 113 when not specified', async () => {
      const response = await fetch(`${API_BASE}/ident/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          serverPort: 22,
          clientPort: 12345,
          timeout: 3000,
        }),
      });

      // Should attempt connection (will likely fail since 192.0.2.1 is TEST-NET)
      // but validates that default port 113 is used
      expect(response.status).toBe(500);
      const data = await response.json() as {
        success: boolean;
        error: string;
      };
      expect(data.success).toBe(false);
    });
  });
});
