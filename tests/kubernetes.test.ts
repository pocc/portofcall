/**
 * Kubernetes API Server Integration Tests
 *
 * Implementation: src/worker/kubernetes.ts
 *
 * Endpoints:
 *   POST /api/kubernetes/probe     — health probe (/healthz) via TLS
 *   POST /api/kubernetes/query     — query any API path
 *   POST /api/kubernetes/logs      — fetch pod logs
 *   POST /api/kubernetes/pod-list  — list pods in a namespace
 *   POST /api/kubernetes/apply     — server-side apply a manifest
 *
 * Default port: 6443/TCP (TLS)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Kubernetes Protocol Integration Tests', () => {
  // ── /api/kubernetes/probe ─────────────────────────────────────────────────

  describe('POST /api/kubernetes/probe', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/probe`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 6443 }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should return success:false for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-k8s-host-12345.example.com',
          port: 6443,
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 6443,
          timeout: 10000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
    }, 15000);

    it('should accept bearerToken parameter', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6443,
          bearerToken: 'test-token',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should use default port 6443', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/probe`, {
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

  // ── /api/kubernetes/query ─────────────────────────────────────────────────

  describe('POST /api/kubernetes/query', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/query`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when path is missing', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'unreachable-host-12345.invalid' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Path');
    });

    it('should return 400 when path does not start with /', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          path: 'version',
        }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Path');
    });

    it('should return 400 when host is missing (checked after path)', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/version' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return success:false for unreachable host with valid path', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6443,
          path: '/version',
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should accept bearerToken for authenticated queries', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6443,
          path: '/api/v1/namespaces',
          bearerToken: 'test-token',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ── /api/kubernetes/logs ──────────────────────────────────────────────────

  describe('POST /api/kubernetes/logs', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/logs`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: 'default', pod: 'my-pod' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return 400 when namespace is missing', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          pod: 'test-pod',
        }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('namespace');
    });

    it('should return 400 when pod is missing', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          namespace: 'default',
        }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('pod');
    });

    it('should attempt connection with all required params', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6443,
          namespace: 'default',
          pod: 'test-pod',
          container: 'app',
          tailLines: 10,
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ── /api/kubernetes/pod-list ──────────────────────────────────────────────

  describe('POST /api/kubernetes/pod-list', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/pod-list`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/pod-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: 'default' }),
      });
      expect(response.status).toBe(400);
    });

    it('should attempt connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/pod-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6443,
          namespace: 'default',
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should support labelSelector parameter', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/pod-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6443,
          namespace: 'default',
          labelSelector: 'app=nginx',
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should list pods across all namespaces when namespace is omitted', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/pod-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6443,
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ── /api/kubernetes/apply ─────────────────────────────────────────────────

  describe('POST /api/kubernetes/apply', () => {
    it('should reject GET method with 405', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/apply`);
      expect(response.status).toBe(405);
    });

    it('should return 400 when manifest is missing', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          namespace: 'default',
        }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('manifest');
    });

    it('should return 400 when manifest.kind is missing', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          namespace: 'default',
          manifest: { apiVersion: 'v1', metadata: { name: 'test' } },
        }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('kind');
    });

    it('should return 400 when manifest.metadata.name is missing', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          namespace: 'default',
          manifest: { apiVersion: 'v1', kind: 'ConfigMap' },
        }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('name');
    });

    it('should attempt apply with valid ConfigMap manifest', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6443,
          namespace: 'default',
          manifest: {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: { name: 'test-config' },
            data: { key: 'value' },
          },
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should handle cluster-scoped resource (Namespace) without namespace field', async () => {
      const response = await fetch(`${API_BASE}/kubernetes/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 6443,
          manifest: {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: { name: 'test-ns' },
          },
          timeout: 5000,
        }),
      });
      // cluster-scoped resources don't require namespace
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });
});
