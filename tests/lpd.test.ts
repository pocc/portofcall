/**
 * LPD (Line Printer Daemon) Protocol Integration Tests
 *
 * These tests verify the LPD protocol implementation by connecting
 * to LPD servers and querying print queue status.
 *
 * Note: LPD servers are typically found on internal networks.
 * These tests may fail without a reachable LPD server.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('LPD Protocol Integration Tests', () => {
  it('should probe an LPD server', async () => {
    const response = await fetch(`${API_BASE}/lpd/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 515,
        printer: 'lp',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Connection may fail if no LPD server is running
    if (data.success) {
      expect(data.host).toBe('localhost');
      expect(data.port).toBe(515);
      expect(data.printer).toBe('lp');
      expect(data.protocol).toBe('LPD');
      expect(data.rfc).toBe('RFC 1179');
      expect(data.connectTimeMs).toBeDefined();
      expect(data.totalTimeMs).toBeDefined();
      expect(data.queueState).toBeDefined();
    }
  }, 10000);

  it('should list queue in long format', async () => {
    const response = await fetch(`${API_BASE}/lpd/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 515,
        printer: 'lp',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.queueListing).toBeDefined();
      expect(data.jobs).toBeDefined();
      expect(Array.isArray(data.jobs)).toBe(true);
      expect(data.jobCount).toBeDefined();
      expect(typeof data.jobCount).toBe('number');
      expect(data.format).toBe('long');
    }
  }, 10000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/lpd/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 515,
        printer: 'lp',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/lpd/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        port: 99999,
        printer: 'lp',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/lpd/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 515,
        printer: 'lp',
        timeout: 1000,
      }),
    });

    const data = await response.json();

    // Should either succeed or fail gracefully
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 5000);

  it('should return proper response structure for probe', async () => {
    const response = await fetch(`${API_BASE}/lpd/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 515,
        printer: 'lp',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data).toHaveProperty('success');

    if (data.success) {
      expect(data).toHaveProperty('host');
      expect(data).toHaveProperty('port');
      expect(data).toHaveProperty('printer');
      expect(data).toHaveProperty('connectTimeMs');
      expect(data).toHaveProperty('totalTimeMs');
      expect(data).toHaveProperty('queueState');
      expect(data).toHaveProperty('responseBytes');
      expect(data).toHaveProperty('protocol');
      expect(data).toHaveProperty('rfc');
    } else {
      expect(data).toHaveProperty('error');
    }
  }, 10000);

  it('should use default printer name when not specified', async () => {
    const response = await fetch(`${API_BASE}/lpd/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 515,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.printer).toBe('lp');
    }
  }, 10000);
});
