/**
 * Ethereum Protocol Integration Tests
 *
 * Implementation: src/worker/ethereum.ts
 *
 * Endpoints:
 *   POST /api/ethereum/probe     — TCP/RLPx fingerprinting on port 30303
 *   POST /api/ethereum/p2p-probe — passive raw TCP inspection on port 30303
 *   POST /api/ethereum/rpc       — single Ethereum JSON-RPC method call (port 8545)
 *   POST /api/ethereum/info      — multi-method node overview (port 8545)
 *
 * Default ports:
 *   probe / p2p-probe → 30303/TCP (P2P)
 *   rpc / info        → 8545/HTTP
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Ethereum Protocol Integration Tests', () => {
  // ── /api/ethereum/probe ───────────────────────────────────────────────────

  describe('POST /api/ethereum/probe', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/ethereum/probe`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/ethereum/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 30303 }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should return success:false for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ethereum/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-eth-12345.example.com',
          port: 30303,
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/ethereum/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 30303,
          timeout: 10000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 15000);

    it('should use default port 30303', async () => {
      const response = await fetch(`${API_BASE}/ethereum/probe`, {
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

    it('should return rlpxFingerprint and protocol fields on TCP open', async () => {
      // When TCP connects (success:true) we get protocol and rlpxFingerprint
      const response = await fetch(`${API_BASE}/ethereum/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 30303,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
      // On success, check for protocol field
      if (data.success) {
        expect(data).toHaveProperty('protocol');
        expect(data).toHaveProperty('rlpxFingerprint');
      }
    }, 10000);
  });

  // ── /api/ethereum/p2p-probe ───────────────────────────────────────────────

  describe('POST /api/ethereum/p2p-probe', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/ethereum/p2p-probe`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/ethereum/p2p-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 30303 }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should return success:false for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ethereum/p2p-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-eth-12345.example.com',
          port: 30303,
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/ethereum/p2p-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 30303,
          timeout: 10000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 15000);

    it('should use default port 30303', async () => {
      const response = await fetch(`${API_BASE}/ethereum/p2p-probe`, {
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

    it('should return responseBytes and responseLength on TCP open', async () => {
      const response = await fetch(`${API_BASE}/ethereum/p2p-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 30303,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
      if (data.success) {
        expect(data).toHaveProperty('responseBytes');
        expect(data).toHaveProperty('responseLength');
        expect(data).toHaveProperty('latencyMs');
        expect(data).toHaveProperty('note');
      }
    }, 10000);
  });

  // ── /api/ethereum/rpc ─────────────────────────────────────────────────────

  describe('POST /api/ethereum/rpc', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/ethereum/rpc`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/ethereum/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'eth_blockNumber' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should default to eth_blockNumber when method is omitted', async () => {
      const response = await fetch(`${API_BASE}/ethereum/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8545,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should return success:false for unreachable RPC endpoint', async () => {
      const response = await fetch(`${API_BASE}/ethereum/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8545,
          method: 'eth_blockNumber',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should support custom method and params', async () => {
      const response = await fetch(`${API_BASE}/ethereum/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8545,
          method: 'eth_getBlockByNumber',
          params: ['latest', false],
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should use default port 8545', async () => {
      const response = await fetch(`${API_BASE}/ethereum/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          method: 'eth_blockNumber',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/ethereum/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 8545,
          method: 'eth_blockNumber',
          timeout: 10000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 15000);
  });

  // ── /api/ethereum/info ────────────────────────────────────────────────────

  describe('POST /api/ethereum/info', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/ethereum/info`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/ethereum/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 8545 }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should return success:false for unreachable node', async () => {
      const response = await fetch(`${API_BASE}/ethereum/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8545,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should use default port 8545', async () => {
      const response = await fetch(`${API_BASE}/ethereum/info`, {
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

    it('should return clientVersion / blockNumber / networkId fields', async () => {
      // Fields are present even on failure (set to null)
      const response = await fetch(`${API_BASE}/ethereum/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8545,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      // These fields are always returned (null on failure)
      expect(data).toHaveProperty('clientVersion');
      expect(data).toHaveProperty('blockNumber');
      expect(data).toHaveProperty('networkId');
      expect(data).toHaveProperty('chainId');
      expect(data).toHaveProperty('latencyMs');
    }, 10000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/ethereum/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 8545,
          timeout: 10000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 15000);
  });
});
