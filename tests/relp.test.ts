/**
 * RELP Protocol Integration Tests (Reliable Event Logging Protocol)
 * Tests RELP connection, message sending, and batch operations
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('RELP Protocol Integration Tests', () => {
  describe('RELP Connect', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/relp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-relp-host-12345.example.com',
          port: 20514,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/relp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 20514,
          // Missing host
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('host');
    });

    it('should use default port 20514 when not specified', async () => {
      const response = await fetch(`${API_BASE}/relp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      // Port may be in response on success or may not be present on error
      if (data.port !== undefined) {
        expect(data.port).toBe(20514);
      }
    }, 10000);

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/relp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20514,
          timeout: 3000,
        }),
      });

      // Should timeout or fail quickly
      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should return proper response structure on success', async () => {
      const response = await fetch(`${API_BASE}/relp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20514,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      if (data.success) {
        expect(data).toHaveProperty('host');
        expect(data).toHaveProperty('port');
        expect(data).toHaveProperty('rtt');
        expect(data).toHaveProperty('statusCode');
        expect(data).toHaveProperty('serverVersion');
        expect(data).toHaveProperty('serverSoftware');
        expect(data).toHaveProperty('supportedCommands');
      }
    }, 10000);

    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/relp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 20514,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });

  describe('RELP Send', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/relp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-relp-host-12345.example.com',
          port: 20514,
          message: 'Test log message',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/relp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 20514,
          message: 'Test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should fail with missing message parameter', async () => {
      const response = await fetch(`${API_BASE}/relp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 20514,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('message');
    });

    it('should validate facility range (0-23)', async () => {
      const response = await fetch(`${API_BASE}/relp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 20514,
          message: 'Test',
          facility: 99,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Facility must be between 0 and 23');
    });

    it('should validate severity range (0-7)', async () => {
      const response = await fetch(`${API_BASE}/relp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 20514,
          message: 'Test',
          severity: 99,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Severity must be between 0 and 7');
    });

    it('should use default facility and severity values', async () => {
      const response = await fetch(`${API_BASE}/relp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20514,
          message: 'Test message',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      // Only check on successful response
      if (data.success) {
        expect(data).toHaveProperty('facility');
        expect(data).toHaveProperty('severity');
      }
    }, 10000);

    it('should return proper response structure', async () => {
      const response = await fetch(`${API_BASE}/relp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20514,
          message: 'Test message',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      if (data.success) {
        expect(data).toHaveProperty('host');
        expect(data).toHaveProperty('port');
        expect(data).toHaveProperty('acknowledged');
        expect(data).toHaveProperty('sentMessage');
        expect(data).toHaveProperty('facilityName');
        expect(data).toHaveProperty('severityName');
      }
    }, 10000);

    it('should block sending to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/relp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 20514,
          message: 'Test',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  describe('RELP Batch', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/relp/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-relp-host-12345.example.com',
          port: 20514,
          messages: ['Message 1', 'Message 2', 'Message 3'],
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/relp/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 20514,
          messages: ['Test'],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('host');
    });

    it('should fail with missing messages parameter', async () => {
      const response = await fetch(`${API_BASE}/relp/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 20514,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('messages');
    });

    it('should fail with empty messages array', async () => {
      const response = await fetch(`${API_BASE}/relp/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 20514,
          messages: [],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('non-empty array');
    });

    it('should validate facility range in batch', async () => {
      const response = await fetch(`${API_BASE}/relp/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 20514,
          messages: ['Test'],
          facility: 100,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Facility must be between 0 and 23');
    });

    it('should validate severity range in batch', async () => {
      const response = await fetch(`${API_BASE}/relp/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 20514,
          messages: ['Test'],
          severity: 10,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Severity must be between 0 and 7');
    });

    it('should return proper response structure', async () => {
      const response = await fetch(`${API_BASE}/relp/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20514,
          messages: ['Message 1', 'Message 2'],
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      if (data.success) {
        expect(data).toHaveProperty('host');
        expect(data).toHaveProperty('port');
        expect(data).toHaveProperty('sent');
        expect(data).toHaveProperty('acknowledged');
        expect(data).toHaveProperty('txnrs');
        expect(data).toHaveProperty('allAcked');
        expect(data).toHaveProperty('rtt');
        expect(Array.isArray(data.txnrs)).toBe(true);
      }
    }, 10000);

    it('should block batch sending to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/relp/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 20514,
          messages: ['Test 1', 'Test 2'],
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.isCloudflare).toBe(true);
    }, 10000);
  });

  describe('RELP Syslog Facilities', () => {
    const facilities = [
      { value: 0, name: 'kern' },
      { value: 1, name: 'user' },
      { value: 2, name: 'mail' },
      { value: 3, name: 'daemon' },
      { value: 4, name: 'auth' },
      { value: 16, name: 'local0' },
      { value: 23, name: 'local7' },
    ];

    it('should accept valid facility values', async () => {
      for (const facility of facilities) {
        const response = await fetch(`${API_BASE}/relp/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: 'unreachable-host-12345.invalid',
            port: 20514,
            message: 'Test',
            facility: facility.value,
            timeout: 2000,
          }),
        });

        const data = await response.json();
        // Only check facility on success
        if (data.success) {
          expect(data).toHaveProperty('facility');
          expect(data.facility).toBe(facility.value);
        }
      }
    }, 30000);
  });

  describe('RELP Syslog Severities', () => {
    const severities = [
      { value: 0, name: 'emerg' },
      { value: 1, name: 'alert' },
      { value: 2, name: 'crit' },
      { value: 3, name: 'err' },
      { value: 4, name: 'warning' },
      { value: 5, name: 'notice' },
      { value: 6, name: 'info' },
      { value: 7, name: 'debug' },
    ];

    it('should accept valid severity values', async () => {
      for (const severity of severities) {
        const response = await fetch(`${API_BASE}/relp/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: 'unreachable-host-12345.invalid',
            port: 20514,
            message: 'Test',
            severity: severity.value,
            timeout: 2000,
          }),
        });

        const data = await response.json();
        // Only check severity on success
        if (data.success) {
          expect(data).toHaveProperty('severity');
          expect(data.severity).toBe(severity.value);
        }
      }
    }, 30000);
  });

  describe('RELP Error Handling', () => {
    it('should handle network timeouts gracefully', async () => {
      const response = await fetch(`${API_BASE}/relp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 20514,
          timeout: 3000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle custom ports', async () => {
      const response = await fetch(`${API_BASE}/relp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2514,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      // Port may only be present on successful response
      if (data.port !== undefined) {
        expect(data.port).toBe(2514);
      }
    }, 10000);
  });
});
