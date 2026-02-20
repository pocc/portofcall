/**
 * Elasticsearch REST API Integration Tests
 * Tests Elasticsearch HTTP REST API connectivity (port 9200)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Elasticsearch Protocol Integration Tests', () => {
  // ===== HEALTH =====
  describe('Elasticsearch Health', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-es-host-12345.example.com',
          port: 9200,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 9200 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9200,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should accept port 9200 (Elasticsearch default)', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9200,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should support username and password parameters', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9200,
          username: 'elastic',
          password: 'test-password',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== QUERY =====
  describe('Elasticsearch Query', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-es-host-12345.example.com',
          port: 9200,
          path: '/',
          method: 'GET',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/', method: 'GET' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should reject invalid HTTP method', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9200,
          method: 'INVALID',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid HTTP method');
    });

    it('should accept GET method to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9200,
          path: '/',
          method: 'GET',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept POST method with body', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9200,
          path: '/_search',
          method: 'POST',
          body: '{"query":{"match_all":{}}}',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== HTTPS =====
  describe('Elasticsearch HTTPS', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/https`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 9200, path: '/' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should reject invalid HTTP method on https endpoint', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/https`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9200,
          method: 'PATCH',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid HTTP method');
    });

    it('should handle HTTPS connection attempt', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/https`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9200,
          path: '/',
          method: 'GET',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== INDEX DOCUMENT =====
  describe('Elasticsearch Index Document', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: 'myindex', doc: { field: 'value' } }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing index parameter', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'unreachable-host-12345.invalid', doc: { field: 'value' } }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing doc parameter', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'unreachable-host-12345.invalid', index: 'myindex' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle connection to non-existent host for indexing', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-es-host-12345.example.com',
          port: 9200,
          index: 'testindex',
          doc: { name: 'test', value: 42 },
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });

  // ===== DELETE DOCUMENT =====
  describe('Elasticsearch Delete Document', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: 'myindex', id: 'doc1' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing index parameter', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'unreachable-host-12345.invalid', id: 'doc1' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing id parameter', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'unreachable-host-12345.invalid', index: 'myindex' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle connection to non-existent host for delete', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-es-host-12345.example.com',
          port: 9200,
          index: 'testindex',
          id: 'doc1',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });

  // ===== CREATE INDEX =====
  describe('Elasticsearch Create Index', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: 'myindex' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing index parameter', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'unreachable-host-12345.invalid' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle connection to non-existent host for create-index', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-es-host-12345.example.com',
          port: 9200,
          index: 'testindex',
          shards: 1,
          replicas: 0,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });

  // ===== ERROR HANDLING =====
  describe('Elasticsearch Error Handling', () => {
    it('should return 400 for missing host on health check', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 9200 }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully', async () => {
      const response = await fetch(`${API_BASE}/elasticsearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 9200,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });
});
