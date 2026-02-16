/**
 * SNPP (Simple Network Paging Protocol) Integration Tests
 *
 * These tests verify the SNPP protocol implementation (RFC 1861)
 * by testing validation, error handling, and input safety.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('SNPP Integration Tests', () => {
  // Probe endpoint tests
  it('should reject empty host for probe', async () => {
    const response = await fetch(`${API_BASE}/snpp/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port for probe', async () => {
    const response = await fetch(`${API_BASE}/snpp/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'snpp.example.com',
        port: 99999,
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  // Page endpoint tests
  it('should reject empty host for page', async () => {
    const response = await fetch(`${API_BASE}/snpp/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        pagerId: '5551234567',
        message: 'Test',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject empty pager ID', async () => {
    const response = await fetch(`${API_BASE}/snpp/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'snpp.example.com',
        pagerId: '',
        message: 'Test',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Pager ID is required');
  });

  it('should reject empty message', async () => {
    const response = await fetch(`${API_BASE}/snpp/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'snpp.example.com',
        pagerId: '5551234567',
        message: '',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Message is required');
  });

  it('should handle connection failure gracefully for probe', async () => {
    const response = await fetch(`${API_BASE}/snpp/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '192.0.2.1', // TEST-NET address, should timeout/fail
        port: 444,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should handle connection failure gracefully for page', async () => {
    const response = await fetch(`${API_BASE}/snpp/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '192.0.2.1',
        port: 444,
        pagerId: '5551234567',
        message: 'Test message',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);
});
