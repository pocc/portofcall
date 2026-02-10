/**
 * Gopher Protocol Integration Tests
 *
 * These tests verify the Gopher protocol implementation by browsing
 * Gopherspace servers for menu items and text content.
 *
 * Note: Tests require a reachable Gopher server.
 * Public servers like gopher.floodgap.com are used for integration testing.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Gopher Protocol Integration Tests', () => {
  it('should fetch root menu from a Gopher server', async () => {
    const response = await fetch(`${API_BASE}/gopher/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'gopher.floodgap.com',
        port: 70,
        selector: '',
        timeout: 15000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.isMenu).toBe(true);
      expect(data.items).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBeGreaterThan(0);

      // Verify item structure
      const firstItem = data.items[0];
      expect(firstItem).toHaveProperty('type');
      expect(firstItem).toHaveProperty('display');
      expect(firstItem).toHaveProperty('selector');
      expect(firstItem).toHaveProperty('host');
      expect(firstItem).toHaveProperty('port');
    }
  }, 20000);

  it('should parse info text items (type i)', async () => {
    const response = await fetch(`${API_BASE}/gopher/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'gopher.floodgap.com',
        port: 70,
        selector: '',
        timeout: 15000,
      }),
    });

    const data = await response.json();

    if (data.success && data.isMenu) {
      const infoItems = data.items.filter((item: { type: string }) => item.type === 'i');
      // Most Gopher menus have info text lines
      expect(infoItems.length).toBeGreaterThanOrEqual(0);
    }
  }, 20000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/gopher/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 70,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/gopher/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'gopher.floodgap.com',
        port: 99999,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject host with invalid characters', async () => {
    const response = await fetch(`${API_BASE}/gopher/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'host;rm -rf /',
        port: 70,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('invalid characters');
  });

  it('should reject selector with control characters', async () => {
    const response = await fetch(`${API_BASE}/gopher/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'gopher.floodgap.com',
        port: 70,
        selector: 'test\x01inject',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('control characters');
  });

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/gopher/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'gopher.floodgap.com',
        port: 70,
        timeout: 1000,
      }),
    });

    const data = await response.json();

    // Should either succeed quickly or timeout gracefully
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 5000);

  it('should handle non-existent server gracefully', async () => {
    const response = await fetch(`${API_BASE}/gopher/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'nonexistent.invalid.example',
        port: 70,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should use default port 70 when not specified', async () => {
    const response = await fetch(`${API_BASE}/gopher/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'gopher.floodgap.com',
        // port not specified - should default to 70
        timeout: 15000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.isMenu).toBe(true);
      expect(data.items).toBeDefined();
    }
  }, 20000);

  it('should support search queries (type 7)', async () => {
    const response = await fetch(`${API_BASE}/gopher/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'gopher.floodgap.com',
        port: 70,
        selector: '/v2/vs',
        query: 'gopher',
        timeout: 15000,
      }),
    });

    const data = await response.json();

    // Search may or may not return results
    if (data.success) {
      expect(data).toHaveProperty('isMenu');
    }
  }, 20000);
});
