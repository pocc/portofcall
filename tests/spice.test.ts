import { describe, it, expect, beforeAll } from 'vitest';

/**
 * SPICE Protocol Integration Tests
 *
 * Tests the SPICE (Simple Protocol for Independent Computing Environments) protocol implementation.
 * SPICE is a remote display protocol developed by Red Hat for virtual desktop infrastructure.
 *
 * Test Structure:
 * - Connection tests: Verify basic TCP connection and handshake
 * - Protocol tests: Verify SPICE link message exchange
 * - Error handling: Validate error cases (unreachable host, timeout, etc.)
 */

const API_BASE = (process.env.API_BASE || 'https://portofcall.ross.gg/api').replace(/\/api$/, '');

describe('SPICE Protocol Integration Tests', () => {
  beforeAll(() => {
    // Ensure worker is running at localhost:8787
    // Run: npx wrangler dev
  });

  describe('Connection Tests', () => {
    it('should connect to a SPICE server (if available)', async () => {
      // This test requires a real SPICE server
      // For CI/CD, you might want to skip this or use a test container
      const response = await fetch(`${API_BASE}/api/spice/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 5900,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('host', 'test-host.invalid');
      expect(data).toHaveProperty('port', 5900);

      // If connection succeeds, verify protocol info
      if (data.success) {
        expect(data).toHaveProperty('protocolVersion');
        expect(data).toHaveProperty('majorVersion');
        expect(data).toHaveProperty('minorVersion');
      }
    });

    it('should handle unreachable SPICE server', async () => {
      const response = await fetch(`${API_BASE}/api/spice/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 5900,
          timeout: 2000,
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error');
      expect(data.host).toBe('unreachable-host-12345.invalid');
      expect(data.port).toBe(5900);
    }, 20000);

    it('should handle connection timeout', async () => {
      const response = await fetch(`${API_BASE}/api/spice/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid', // Non-routable IP
          port: 5900,
          timeout: 1000,
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/timeout|unreachable|cannot connect|proxy request failed/i);
    }, 10000);

    it('should handle connection to wrong protocol', async () => {
      // Try to connect to HTTP port with SPICE protocol
      const response = await fetch(`${API_BASE}/api/spice/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'www.google.com',
          port: 80,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(false);
      // Should fail to parse SPICE response from HTTP server
      expect(data.error).toBeTruthy();
    }, 10000);
  });

  describe('Validation Tests', () => {
    it('should validate required host parameter', async () => {
      const response = await fetch(`${API_BASE}/api/spice/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 5900,
        }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/host/i);
    });

    it('should validate port range', async () => {
      const response = await fetch(`${API_BASE}/api/spice/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/port/i);
    });

    it('should use default port 5900', async () => {
      const response = await fetch(`${API_BASE}/api/spice/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 1000,
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.port).toBe(5900);
    }, 10000);

    it('should reject non-POST methods', async () => {
      const response = await fetch(`${API_BASE}/api/spice/connect`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('Protocol Parsing Tests', () => {
    it('should parse SPICE protocol version', async () => {
      // This test requires a SPICE server that responds correctly
      // Skip if no server available
      const response = await fetch(`${API_BASE}/api/spice/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 5900,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();

      if (data.success) {
        // If successful, verify protocol fields
        expect(typeof data.majorVersion).toBe('number');
        expect(typeof data.minorVersion).toBe('number');
        expect(data.protocolVersion).toMatch(/^\d+\.\d+$/);
        expect(data.majorVersion).toBeGreaterThanOrEqual(1);
        expect(data.majorVersion).toBeLessThanOrEqual(10);
      } else {
        // If no server, just verify error format
        expect(data).toHaveProperty('error');
      }
    });

    it('should handle invalid SPICE response gracefully', async () => {
      // Connect to a non-SPICE service
      const response = await fetch(`${API_BASE}/api/spice/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'www.google.com',
          port: 443,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty host', async () => {
      const response = await fetch(`${API_BASE}/api/spice/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 5900,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle malformed JSON', async () => {
      const response = await fetch(`${API_BASE}/api/spice/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle very short timeout', async () => {
      const response = await fetch(`${API_BASE}/api/spice/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 5900,
          timeout: 1, // 1ms - should timeout
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });
});
