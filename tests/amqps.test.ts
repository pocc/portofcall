import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';
const WORKER_URL = API_BASE.replace('/api', '');
const isLocal = WORKER_URL.includes('localhost');

// wrangler dev does not support secureTransport: 'on' for localhost connections
const itTlsTest = isLocal ? it.skip : it;

describe('AMQPS Integration', () => {
  describe('Connect', () => {
    itTlsTest('should connect to AMQPS broker over TLS', async () => {
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
          host: 'unreachable-host-12345.invalid', // TEST-NET-1 (RFC 5737) - guaranteed to timeout
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
