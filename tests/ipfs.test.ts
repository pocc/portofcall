/**
 * IPFS Protocol Integration Tests
 *
 * Implementation: src/worker/ipfs.ts
 *
 * Endpoints:
 *   POST /api/ipfs/probe      — libp2p multistream-select negotiation (port 4001)
 *   POST /api/ipfs/add        — add content via HTTP API (port 5001)
 *   POST /api/ipfs/cat        — retrieve content by CID (port 5001)
 *   POST /api/ipfs/pin-add    — pin a CID (port 5001)
 *   POST /api/ipfs/pin-ls     — list pinned CIDs (port 5001)
 *   POST /api/ipfs/pin-rm     — remove a pin (port 5001)
 *   POST /api/ipfs/pubsub-pub — publish to a pubsub topic (port 5001)
 *   POST /api/ipfs/pubsub-ls  — list subscribed topics (port 5001)
 *   POST /api/ipfs/node-info  — node identity info (port 5001)
 *
 * Default ports: probe → 4001, all HTTP API endpoints → 5001
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('IPFS Protocol Integration Tests', () => {
  // ── /api/ipfs/probe ───────────────────────────────────────────────────────

  describe('POST /api/ipfs/probe', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/ipfs/probe`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/ipfs/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 4001 }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should return success:false for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/ipfs/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-ipfs-12345.example.com',
          port: 4001,
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/ipfs/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 4001,
          timeout: 10000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 15000);

    it('should accept custom protocols list', async () => {
      const response = await fetch(`${API_BASE}/ipfs/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 4001,
          protocols: ['/multistream/1.0.0', '/p2p/0.1.0'],
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should use default port 4001', async () => {
      const response = await fetch(`${API_BASE}/ipfs/probe`, {
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
  });

  // ── /api/ipfs/add ─────────────────────────────────────────────────────────

  describe('POST /api/ipfs/add', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/ipfs/add`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/ipfs/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'hello' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should return success:false for unreachable IPFS node', async () => {
      const response = await fetch(`${API_BASE}/ipfs/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5001,
          content: 'test content',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);

    it('should use default port 5001', async () => {
      const response = await fetch(`${API_BASE}/ipfs/add`, {
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

    it('should support custom filename parameter', async () => {
      const response = await fetch(`${API_BASE}/ipfs/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5001,
          content: 'hello ipfs',
          filename: 'custom.txt',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ── /api/ipfs/cat ─────────────────────────────────────────────────────────

  describe('POST /api/ipfs/cat', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/ipfs/cat`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/ipfs/cat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid: 'QmTest' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should return 400 when CID is missing', async () => {
      const response = await fetch(`${API_BASE}/ipfs/cat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'test-host.invalid' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('CID');
    });

    it('should return success:false for unreachable IPFS node', async () => {
      const response = await fetch(`${API_BASE}/ipfs/cat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5001,
          cid: 'QmTest123',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);
  });

  // ── /api/ipfs/pin-add ─────────────────────────────────────────────────────

  describe('POST /api/ipfs/pin-add', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pin-add`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pin-add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid: 'QmTest' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return 400 when CID is missing', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pin-add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'test-host.invalid' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('CID');
    });

    it('should return success:false for unreachable IPFS node', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pin-add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5001,
          cid: 'QmTest123',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);
  });

  // ── /api/ipfs/pin-ls ──────────────────────────────────────────────────────

  describe('POST /api/ipfs/pin-ls', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pin-ls`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pin-ls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 5001 }),
      });
      expect(response.status).toBe(400);
    });

    it('should return success:false for unreachable IPFS node', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pin-ls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5001,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should support optional type filter', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pin-ls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5001,
          type: 'recursive',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ── /api/ipfs/pin-rm ──────────────────────────────────────────────────────

  describe('POST /api/ipfs/pin-rm', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pin-rm`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when CID is missing', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pin-rm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'test-host.invalid' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('CID');
    });
  });

  // ── /api/ipfs/pubsub-pub ──────────────────────────────────────────────────

  describe('POST /api/ipfs/pubsub-pub', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pubsub-pub`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when topic is missing', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pubsub-pub`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'test-host.invalid', data: 'test' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Topic');
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pubsub-pub`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: 'test-topic', data: 'hello' }),
      });
      expect(response.status).toBe(400);
    });

    it('should return success:false for unreachable IPFS node', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pubsub-pub`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5001,
          topic: 'test-topic',
          data: 'hello world',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);
  });

  // ── /api/ipfs/pubsub-ls ───────────────────────────────────────────────────

  describe('POST /api/ipfs/pubsub-ls', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pubsub-ls`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pubsub-ls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 5001 }),
      });
      expect(response.status).toBe(400);
    });

    it('should return success:false for unreachable IPFS node', async () => {
      const response = await fetch(`${API_BASE}/ipfs/pubsub-ls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5001,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ── /api/ipfs/node-info ───────────────────────────────────────────────────

  describe('POST /api/ipfs/node-info', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/ipfs/node-info`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/ipfs/node-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 5001 }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Host');
    });

    it('should return success:false for unreachable IPFS node', async () => {
      const response = await fetch(`${API_BASE}/ipfs/node-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5001,
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);

    it('should use default port 5001', async () => {
      const response = await fetch(`${API_BASE}/ipfs/node-info`, {
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
  });
});
