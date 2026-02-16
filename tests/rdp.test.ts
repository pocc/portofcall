/**
 * RDP (Remote Desktop Protocol) Integration Tests
 *
 * Tests the RDP implementation using X.224/TPKT handshake
 * RDP uses X.224 Connection Request on port 3389 with security negotiation
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('RDP Protocol Integration Tests', () => {
  describe('POST /api/rdp/connect', () => {
    it('should validate missing host', async () => {
      const response = await fetch(`${API_BASE}/rdp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 3389,
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
      const response = await fetch(`${API_BASE}/rdp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
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

    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/rdp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          port: 3389,
          timeout: 5000,
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

    it('should use default port 3389 when not specified', async () => {
      const response = await fetch(`${API_BASE}/rdp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json() as {
        success: boolean;
        error: string;
      };

      expect(data.success).toBe(false);
    });

    it('should handle timeout correctly', async () => {
      const startTime = Date.now();

      const response = await fetch(`${API_BASE}/rdp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET address that should timeout
          port: 3389,
          timeout: 3000,
        }),
      });

      const elapsed = Date.now() - startTime;
      const data = await response.json() as {
        success: boolean;
        error: string;
      };

      expect(data.success).toBe(false);
      expect(elapsed).toBeLessThan(15000);
    });
  });
});
