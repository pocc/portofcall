/**
 * InfluxDB HTTP API Integration Tests
 * Tests InfluxDB time-series database HTTP API connectivity (port 8086)
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('InfluxDB Protocol Integration Tests', () => {
  // ===== HEALTH =====
  describe('InfluxDB Health', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/influxdb/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-influxdb-host-12345.example.com',
          port: 8086,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/influxdb/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 8086 }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/influxdb/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8086,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should accept port 8086 (InfluxDB default)', async () => {
      const response = await fetch(`${API_BASE}/influxdb/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8086,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should support auth token parameter', async () => {
      const response = await fetch(`${API_BASE}/influxdb/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8086,
          token: 'my-auth-token-12345',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== WRITE =====
  describe('InfluxDB Write', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/influxdb/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-influxdb-host-12345.example.com',
          port: 8086,
          org: 'myorg',
          bucket: 'mybucket',
          lineProtocol: 'measurement,tag1=value1 field1=123',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/influxdb/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org: 'myorg',
          bucket: 'mybucket',
          lineProtocol: 'measurement field=1',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing org and bucket parameters', async () => {
      const response = await fetch(`${API_BASE}/influxdb/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          lineProtocol: 'measurement field=1',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Organization and bucket are required');
    });

    it('should fail with missing line protocol data', async () => {
      const response = await fetch(`${API_BASE}/influxdb/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          org: 'myorg',
          bucket: 'mybucket',
          lineProtocol: '',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Line protocol data is required');
    });
  });

  // ===== QUERY =====
  describe('InfluxDB Query', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/influxdb/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-influxdb-host-12345.example.com',
          port: 8086,
          org: 'myorg',
          query: 'from(bucket: "mybucket") |> range(start: -1h)',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/influxdb/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org: 'myorg',
          query: 'from(bucket: "mybucket") |> range(start: -1h)',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing org parameter', async () => {
      const response = await fetch(`${API_BASE}/influxdb/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          query: 'from(bucket: "mybucket") |> range(start: -1h)',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Organization is required');
    });

    it('should fail with missing Flux query parameter', async () => {
      const response = await fetch(`${API_BASE}/influxdb/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          org: 'myorg',
          query: '',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Flux query is required');
    });

    it('should handle custom timeout on query', async () => {
      const response = await fetch(`${API_BASE}/influxdb/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8086,
          org: 'myorg',
          query: 'from(bucket: "mybucket") |> range(start: -1h)',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  // ===== ERROR HANDLING =====
  describe('InfluxDB Error Handling', () => {
    it('should return 400 for missing host on health check', async () => {
      const response = await fetch(`${API_BASE}/influxdb/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 8086 }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully on health', async () => {
      const response = await fetch(`${API_BASE}/influxdb/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8086,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);

    it('should handle network errors gracefully on write', async () => {
      const response = await fetch(`${API_BASE}/influxdb/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8086,
          org: 'myorg',
          bucket: 'mybucket',
          lineProtocol: 'measurement field=1',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });
});
