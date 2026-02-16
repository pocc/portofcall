/**
 * Ventrilo Protocol Integration Tests
 *
 * These tests verify the Ventrilo VoIP protocol implementation.
 * Since public Ventrilo servers are rare and the protocol is proprietary,
 * most tests validate input handling and connection attempts.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Ventrilo Protocol Integration Tests', () => {
  describe('Ventrilo Connect Endpoint', () => {
    it('should reject empty host', async () => {
      const response = await fetch(`${API_BASE}/ventrilo/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/ventrilo/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'vent.example.com',
          port: 99999,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should use default port 3784 when not specified', async () => {
      const response = await fetch(`${API_BASE}/ventrilo/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET address
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Connection will fail but validates default port
      expect(response.status).toBe(500);
      expect(data.port).toBe(3784);
    }, 8000);

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/ventrilo/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET address, should fail
          port: 3784,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should reject port 0', async () => {
      const response = await fetch(`${API_BASE}/ventrilo/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'vent.example.com',
          port: 0,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });
  });

  describe('Ventrilo Status Endpoint', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/ventrilo/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Host is required');
    });

    it('should reject invalid port', async () => {
      const response = await fetch(`${API_BASE}/ventrilo/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'vent.example.com',
          port: 99999,
          timeout: 5000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Port must be between 1 and 65535');
    });

    it('should handle connection failure gracefully', async () => {
      const response = await fetch(`${API_BASE}/ventrilo/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET address
          port: 3784,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 8000);

    it('should use default port 3784', async () => {
      const response = await fetch(`${API_BASE}/ventrilo/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          timeout: 3000,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.port).toBe(3784);
    }, 8000);

    it('should return response structure', async () => {
      const response = await fetch(`${API_BASE}/ventrilo/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1',
          port: 3784,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // Should have host, port, success fields
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');
      expect(data).toHaveProperty('success');
      expect(data.port).toBe(3784);
    }, 8000);
  });
});
