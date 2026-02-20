/**
 * Meilisearch HTTP API Integration Tests
 * Tests Meilisearch full-text search engine HTTP API connectivity (port 7700)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Meilisearch Protocol Integration Tests', () => {
  // ===== HEALTH =====
  describe('Meilisearch Health', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-meili-host-12345.example.com',
          port: 7700,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 7700 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('host');
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 7700,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should accept port 7700 (Meilisearch default)', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 7700,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should support apiKey parameter', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 7700,
          apiKey: 'masterKey',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== SEARCH =====
  describe('Meilisearch Search', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-meili-host-12345.example.com',
          port: 7700,
          index: 'movies',
          query: 'batman',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: 'movies', query: 'batman' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should fail with missing index parameter', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 7700,
          query: 'batman',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('index');
    });

    it('should accept optional limit and offset parameters', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 7700,
          index: 'movies',
          query: 'batman',
          limit: 5,
          offset: 10,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept empty query string for browsing', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 7700,
          index: 'movies',
          query: '',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== DOCUMENTS =====
  describe('Meilisearch Documents', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-meili-host-12345.example.com',
          port: 7700,
          index: 'movies',
          documents: [{ id: 1, title: 'Test' }],
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing required fields (host, index, documents)', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 7700 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing required');
    });

    it('should fail with empty documents array', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 7700,
          index: 'movies',
          documents: [],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing required');
    });

    it('should accept optional primaryKey parameter', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 7700,
          index: 'movies',
          documents: [{ id: 1, title: 'Test Movie' }],
          primaryKey: 'id',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== DELETE =====
  describe('Meilisearch Delete', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-meili-host-12345.example.com',
          port: 7700,
          index: 'movies',
          ids: [1, 2],
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail without ids or all flag', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 7700,
          index: 'movies',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing required');
    });

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: 'movies', ids: [1] }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should accept ids array for delete', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 7700,
          index: 'movies',
          ids: [1, 2, 3],
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept all flag for deleting all documents', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 7700,
          index: 'movies',
          all: true,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== ERROR HANDLING =====
  describe('Meilisearch Error Handling', () => {
    it('should return 400 for missing host on health check', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 7700 }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully on health', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 7700,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should handle network errors gracefully on search', async () => {
      const response = await fetch(`${API_BASE}/meilisearch/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 7700,
          index: 'movies',
          query: 'test',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });
});
