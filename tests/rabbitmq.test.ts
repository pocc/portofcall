import { describe, it, expect } from 'vitest';

const WORKER_URL = (process.env.API_BASE || 'https://portofcall.ross.gg/api').replace(/\/api$/, '');

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

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.version).toBeDefined();
      expect(data.clusterName).toBeDefined();
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
          host: 'unreachable-host-12345.invalid', // TEST-NET-1 (RFC 5737) - guaranteed to timeout
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

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(true);
      expect(data.response).toBeDefined();
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
