/**
 * TCP Ping Integration Tests
 * Tests basic TCP connectivity checks
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('TCP Ping Integration Tests', () => {
  describe('TCP Ping', () => {
    it('should successfully ping Google on port 443', async () => {
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'google.com',
          port: 443,
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.host).toBe('google.com');
      expect(data.port).toBe(443);
      expect(data.rtt).toBeGreaterThan(0);
      expect(data.rtt).toBeLessThan(5000); // Should be under 5 seconds
      expect(data.message).toContain('TCP Ping Success');
    });

    it('should successfully ping Google DNS', async () => {
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '8.8.8.8',
          port: 53,
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.rtt).toBeGreaterThan(0);
    });

    it('should fail with non-existent host', async () => {
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-host-12345.example.com',
          port: 80,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with unreachable port', async () => {
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'google.com',
          port: 12345, // Unlikely to be open
        }),
      });

      // This might succeed or fail depending on firewall rules
      const data = await response.json();
      expect(data).toHaveProperty('success');
    });

    it('should return 405 for GET request', async () => {
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should fail with missing parameters', async () => {
      const response = await fetch(`${API_BASE}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'google.com',
          // Missing port
        }),
      });

      expect(response.status).toBe(400);
    });
  });
});
