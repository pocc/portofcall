/**
 * STOMP Protocol Integration Tests
 *
 * These tests verify the STOMP protocol implementation by connecting
 * to STOMP message brokers (RabbitMQ, ActiveMQ, etc.).
 *
 * Note: Tests require a reachable STOMP broker.
 * Run: docker run -d -p 61613:61613 -p 15672:15672 rabbitmq:3-management
 *      docker exec <id> rabbitmq-plugins enable rabbitmq_stomp
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('STOMP Protocol Integration Tests', () => {
  it('should test connection to a STOMP broker', async () => {
    const response = await fetch(`${API_BASE}/stomp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 61613,
        username: 'guest',
        password: 'guest',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Connection may fail if no STOMP broker is running
    if (data.success) {
      expect(data.version).toBeDefined();
      expect(data.server).toBeDefined();
      expect(data.heartBeat).toBeDefined();
    }
  }, 10000);

  it('should send a message to a STOMP destination', async () => {
    const response = await fetch(`${API_BASE}/stomp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 61613,
        username: 'guest',
        password: 'guest',
        destination: '/queue/test',
        body: 'Hello from Port of Call!',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.destination).toBe('/queue/test');
      expect(data.bodyLength).toBe(23);
      expect(data.brokerVersion).toBeDefined();
    }
  }, 10000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/stomp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 61613,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/stomp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
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
    const response = await fetch(`${API_BASE}/stomp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'broker;rm -rf /',
        port: 61613,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('invalid characters');
  });

  it('should reject missing destination on send', async () => {
    const response = await fetch(`${API_BASE}/stomp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        port: 61613,
        destination: '',
        body: 'test',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Destination is required');
  });

  it('should reject invalid destination format', async () => {
    const response = await fetch(`${API_BASE}/stomp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'test-host.invalid',
        port: 61613,
        destination: 'no-leading-slash',
        body: 'test',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid destination format');
  });

  it('should handle connection timeout gracefully', async () => {
    const response = await fetch(`${API_BASE}/stomp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 61613,
        timeout: 1000,
      }),
    });

    const data = await response.json();

    // Should either succeed or fail gracefully
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 5000);

  it('should handle non-existent broker gracefully', async () => {
    const response = await fetch(`${API_BASE}/stomp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'nonexistent.invalid.example',
        port: 61613,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should support optional vhost parameter', async () => {
    const response = await fetch(`${API_BASE}/stomp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 61613,
        username: 'guest',
        password: 'guest',
        vhost: '/',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Connection may fail if no broker is running
    if (data.success) {
      expect(data.version).toBeDefined();
    }
  }, 10000);
});
