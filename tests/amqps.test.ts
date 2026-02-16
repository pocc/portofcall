import { describe, it, expect } from 'vitest';

const WORKER_URL = 'http://localhost:8787';

describe('AMQPS Integration', () => {
  describe('Connect', () => {
    it('should connect to AMQPS broker over TLS', async () => {
      const response = await fetch(`${WORKER_URL}/api/amqps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 5671,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.secure).toBe(true);
      expect(data.protocol).toContain('AMQP');
    });

    it('should reject empty host', async () => {
      const response = await fetch(`${WORKER_URL}/api/amqps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 5671,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${WORKER_URL}/api/amqps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: -1,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('port');
    });

    it('should handle connection timeout', async () => {
      const response = await fetch(`${WORKER_URL}/api/amqps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET-1 (RFC 5737) - guaranteed to timeout
          port: 5671,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 35000); // 35 second timeout for network timeout test

    it('should default to port 5671 when not specified', async () => {
      const response = await fetch(`${WORKER_URL}/api/amqps/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
        }),
      });

      // This will fail to connect but should not error on port validation
      const data = await response.json();
      expect(data.error).not.toContain('port');
    });

    it('should reject non-POST methods', async () => {
      const response = await fetch(`${WORKER_URL}/api/amqps/connect`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });
});
