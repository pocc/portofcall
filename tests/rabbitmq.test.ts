import { describe, it, expect } from 'vitest';

const WORKER_URL = 'http://localhost:8787';

describe('RabbitMQ Management API Integration', () => {
  describe('Health Check', () => {
    it('should connect to RabbitMQ Management API and fetch health info', async () => {
      const response = await fetch(`${WORKER_URL}/api/rabbitmq/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 15672,
          username: 'guest',
          password: 'guest',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.overview).toBeDefined();
      expect(data.nodes).toBeDefined();
    });

    it('should reject empty host for health check', async () => {
      const response = await fetch(`${WORKER_URL}/api/rabbitmq/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 15672,
          username: 'guest',
          password: 'guest',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('host');
    });

    it('should reject invalid port for health check', async () => {
      const response = await fetch(`${WORKER_URL}/api/rabbitmq/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: -1,
          username: 'guest',
          password: 'guest',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('port');
    });

    it('should handle connection timeout for health check', async () => {
      const response = await fetch(`${WORKER_URL}/api/rabbitmq/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET-1 (RFC 5737) - guaranteed to timeout
          port: 15672,
          username: 'guest',
          password: 'guest',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 35000); // 35 second timeout for network timeout test
  });

  describe('Query', () => {
    it('should query RabbitMQ Management API endpoint', async () => {
      const response = await fetch(`${WORKER_URL}/api/rabbitmq/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 15672,
          username: 'guest',
          password: 'guest',
          path: '/api/overview',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.body).toBeDefined();
    });

    it('should reject empty host for query', async () => {
      const response = await fetch(`${WORKER_URL}/api/rabbitmq/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 15672,
          username: 'guest',
          password: 'guest',
          path: '/api/overview',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('host');
    });

    it('should reject invalid port for query', async () => {
      const response = await fetch(`${WORKER_URL}/api/rabbitmq/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 99999,
          username: 'guest',
          password: 'guest',
          path: '/api/overview',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('port');
    });

    it('should reject non-API paths for safety', async () => {
      const response = await fetch(`${WORKER_URL}/api/rabbitmq/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 15672,
          username: 'guest',
          password: 'guest',
          path: '/admin/delete',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('path must start with /api/');
    });
  });
});
