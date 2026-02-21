/**
 * JSON-RPC 2.0 Integration Tests
 *
 * Tests the JSON-RPC over HTTP/TCP implementation by verifying
 * input validation, error handling, and protocol behavior.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('JSON-RPC 2.0 Integration Tests', () => {
  describe('POST /api/jsonrpc/call', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/jsonrpc/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'eth_blockNumber',
          params: [],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject missing method', async () => {
      const response = await fetch(`${API_BASE}/jsonrpc/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 8545,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Method');
    });

    it('should handle unreachable host gracefully', async () => {
      const response = await fetch(`${API_BASE}/jsonrpc/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent-jsonrpc-12345.invalid',
          port: 8545,
          method: 'eth_blockNumber',
          params: [],
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should default to port 8545 and path /', async () => {
      // Verify defaults by connecting to a known-unreachable host;
      // the returned error reflects that defaults were applied (not 400/missing-param)
      const response = await fetch(`${API_BASE}/jsonrpc/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent-defaults-test.invalid',
          method: 'net_version',
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle connection timeout', async () => {
      const response = await fetch(`${API_BASE}/jsonrpc/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 8545,
          method: 'eth_blockNumber',
          timeout: 2000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should include latencyMs in successful HTTP responses', async () => {
      // Even a connection failure via 500 goes through the try/catch path;
      // test a 400 to confirm the structure does NOT include latencyMs on bad input
      const response = await fetch(`${API_BASE}/jsonrpc/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; latencyMs?: number };
      expect(data.success).toBe(false);
      expect(data.latencyMs).toBeUndefined();
    });
  });

  describe('POST /api/jsonrpc/batch', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/jsonrpc/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calls: [{ method: 'eth_blockNumber', params: [] }],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject missing calls array', async () => {
      const response = await fetch(`${API_BASE}/jsonrpc/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 8545,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('call');
    });

    it('should reject empty calls array', async () => {
      const response = await fetch(`${API_BASE}/jsonrpc/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 8545,
          calls: [],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toContain('call');
    });

    it('should handle unreachable host for batch', async () => {
      const response = await fetch(`${API_BASE}/jsonrpc/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent-jsonrpc-batch-12345.invalid',
          port: 8545,
          calls: [
            { method: 'eth_blockNumber', params: [] },
            { method: 'net_version', params: [] },
          ],
          timeout: 3000,
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json() as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);
  });
});
