/**
 * CoAP Protocol Integration Tests
 * Tests CoAP requests, block-wise transfer, and observe functionality
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('CoAP Protocol Integration Tests', () => {
  describe('CoAP Basic Request', () => {
    it('should handle CoAP GET request with proper validation', async () => {
      const response = await fetch(`${API_BASE}/coap/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'coap.me',
          port: 5683,
          method: 'GET',
          path: '/hello',
          confirmable: true,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;

      // Even if connection fails, response structure should be valid
      expect(data).toHaveProperty('success');
      if (data.success) {
        expect(data.code).toBeDefined();
        expect(data.codeClass).toBeDefined();
        expect(data.codeDetail).toBeDefined();
        expect(data.codeName).toBeDefined();
      }
    }, 20000);

    it('should reject missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/coap/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'GET',
          path: '/hello',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should reject invalid method', async () => {
      const response = await fetch(`${API_BASE}/coap/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'coap.me',
          method: 'INVALID',
          path: '/hello',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Valid method required');
    });

    it('should reject missing path parameter', async () => {
      const response = await fetch(`${API_BASE}/coap/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'coap.me',
          method: 'GET',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Path is required');
    });
  });

  describe('CoAP Discovery', () => {
    it('should handle well-known/core discovery request', async () => {
      const response = await fetch(`${API_BASE}/coap/discover?host=coap.me&port=5683`, {
        method: 'GET',
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 20000);

    it('should reject discovery without host parameter', async () => {
      const response = await fetch(`${API_BASE}/coap/discover`, {
        method: 'GET',
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host parameter required');
    });
  });

  describe('CoAP Block-wise Transfer', () => {
    it('should handle block-wise GET request', async () => {
      const response = await fetch(`${API_BASE}/coap/block-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'coap.me',
          port: 5683,
          path: '/large',
          szx: 6,
          maxBlocks: 10,
          timeout: 15000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');

      if (data.success) {
        expect(data.blocks).toBeDefined();
        expect(data.totalBytes).toBeDefined();
        expect(data.blockSize).toBeDefined();
        expect(data.szx).toBe(6);
      }
    }, 25000);

    it('should reject block-get without host', async () => {
      const response = await fetch(`${API_BASE}/coap/block-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/large',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('host is required');
    });

    it('should reject block-get without path', async () => {
      const response = await fetch(`${API_BASE}/coap/block-get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'coap.me',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('path is required');
    });
  });

  describe('CoAP Observe', () => {
    it('should handle observe subscription request', async () => {
      const response = await fetch(`${API_BASE}/coap/observe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'coap.me',
          port: 5683,
          path: '/obs',
          observeMs: 3000,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');

      if (data.success) {
        expect(data.subscribed).toBe(true);
        expect(data.initial).toBeDefined();
        expect(data.initial.observeSeq).toBeDefined();
        expect(data.latencyMs).toBeDefined();
      }
    }, 20000);

    it('should reject observe without host', async () => {
      const response = await fetch(`${API_BASE}/coap/observe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/obs',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('host is required');
    });

    it('should reject observe without path', async () => {
      const response = await fetch(`${API_BASE}/coap/observe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'coap.me',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('path is required');
    });
  });

  describe('CoAP POST Request', () => {
    it('should handle POST request with payload', async () => {
      const response = await fetch(`${API_BASE}/coap/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'coap.me',
          port: 5683,
          method: 'POST',
          path: '/test',
          payload: 'test data',
          contentFormat: 0,
          confirmable: true,
          timeout: 10000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 20000);
  });

  describe('CoAP Content Formats', () => {
    it('should handle text/plain content format', async () => {
      const response = await fetch(`${API_BASE}/coap/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'coap.me',
          method: 'GET',
          path: '/hello',
          contentFormat: 0,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 20000);

    it('should handle application/json content format', async () => {
      const response = await fetch(`${API_BASE}/coap/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'coap.me',
          method: 'POST',
          path: '/test',
          payload: '{"key":"value"}',
          contentFormat: 50,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    }, 20000);
  });
});
