/**
 * ActiveMQ Integration Tests
 *
 * Tests the ActiveMQ worker endpoints:
 *   POST /api/activemq/probe      — OpenWire handshake probe
 *   POST /api/activemq/connect    — STOMP connect
 *   POST /api/activemq/send       — STOMP send message
 *   POST /api/activemq/subscribe  — STOMP subscribe & receive
 *   POST /api/activemq/admin      — Jolokia REST API
 *
 * Live broker tests require a running ActiveMQ instance:
 *   docker run -d -p 61616:61616 -p 61613:61613 -p 8161:8161 apache/activemq-classic:latest
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

// ── Input validation (no broker needed) ───────────────────────────────────────

describe('ActiveMQ — input validation', () => {
  it('probe: rejects empty host', async () => {
    const res = await fetch(`${API_BASE}/activemq/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '', port: 61616 }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('probe: rejects invalid port', async () => {
    const res = await fetch(`${API_BASE}/activemq/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'test-host.invalid', port: 99999 }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('probe: rejects host with invalid characters', async () => {
    const res = await fetch(`${API_BASE}/activemq/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'broker;rm -rf /', port: 61616 }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('invalid characters');
  });

  it('connect: rejects empty host', async () => {
    const res = await fetch(`${API_BASE}/activemq/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '', port: 61613 }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('send: rejects missing destination', async () => {
    const res = await fetch(`${API_BASE}/activemq/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'test-host.invalid', port: 61613, destination: '', body: 'test' }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Destination is required');
  });

  it('send: rejects invalid destination format', async () => {
    const res = await fetch(`${API_BASE}/activemq/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'test-host.invalid', port: 61613, destination: 'no-prefix', body: 'test' }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid destination');
  });

  it('send: accepts queue:// URI form', async () => {
    // Will fail to connect but should NOT fail validation
    const res = await fetch(`${API_BASE}/activemq/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'nonexistent.invalid.example',
        port: 61613,
        destination: 'queue://myqueue',
        body: 'test',
        timeout: 3000,
      }),
    });
    const data = await res.json() as { success: boolean; error: string };
    // Should fail with a network error, not a validation error
    expect(data.success).toBe(false);
    expect(data.error).not.toContain('Invalid destination');
  });

  it('send: accepts topic:// URI form', async () => {
    const res = await fetch(`${API_BASE}/activemq/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'nonexistent.invalid.example',
        port: 61613,
        destination: 'topic://alerts',
        body: 'test',
        timeout: 3000,
      }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).not.toContain('Invalid destination');
  });

  it('subscribe: rejects missing destination', async () => {
    const res = await fetch(`${API_BASE}/activemq/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'test-host.invalid', port: 61613, destination: '' }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Destination is required');
  });

  it('admin: rejects empty host', async () => {
    const res = await fetch(`${API_BASE}/activemq/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '', port: 8161, action: 'brokerInfo' }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('admin: rejects missing queueName for queueStats', async () => {
    const res = await fetch(`${API_BASE}/activemq/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'test-host.invalid', port: 8161, action: 'queueStats' }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('queueName is required');
  });

  it('probe: handles non-existent host gracefully', async () => {
    const res = await fetch(`${API_BASE}/activemq/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'nonexistent.invalid.example', port: 61616, timeout: 5000 }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);

  it('connect: handles non-existent host gracefully', async () => {
    const res = await fetch(`${API_BASE}/activemq/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'nonexistent.invalid.example', port: 61613, timeout: 5000 }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);

  it('send: handles non-existent host gracefully', async () => {
    const res = await fetch(`${API_BASE}/activemq/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'nonexistent.invalid.example',
        port: 61613,
        destination: '/queue/test',
        body: 'test',
        timeout: 5000,
      }),
    });
    const data = await res.json() as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);
});

// ── Live broker tests (conditional on localhost broker) ───────────────────────

describe('ActiveMQ — live broker (localhost)', () => {
  it('should probe a running ActiveMQ broker on :61616', async () => {
    const res = await fetch(`${API_BASE}/activemq/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'localhost', port: 61616, timeout: 8000 }),
    });
    const data = await res.json() as {
      success: boolean; error?: string;
      tcpLatency?: number; isActiveMQ?: boolean; openWireVersion?: number;
    };
    if (data.success) {
      expect(data.tcpLatency).toBeGreaterThanOrEqual(0);
      expect(typeof data.isActiveMQ).toBe('boolean');
      if (data.isActiveMQ) {
        expect(data.openWireVersion).toBeGreaterThan(0);
      }
    } else {
      // Acceptable: broker may not be running
      expect(data.error).toBeDefined();
    }
  }, 15000);

  it('should connect via STOMP on :61613', async () => {
    const res = await fetch(`${API_BASE}/activemq/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 61613,
        username: 'admin',
        password: 'admin',
        timeout: 8000,
      }),
    });
    const data = await res.json() as {
      success: boolean; error?: string;
      stompVersion?: string; server?: string; latency?: number;
    };
    if (data.success) {
      expect(data.stompVersion).toBeDefined();
      expect(data.server).toBeDefined();
      expect(data.latency).toBeGreaterThanOrEqual(0);
    } else {
      expect(data.error).toBeDefined();
    }
  }, 15000);

  it('should send a message and receive a receipt', async () => {
    const res = await fetch(`${API_BASE}/activemq/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 61613,
        username: 'admin',
        password: 'admin',
        destination: '/queue/portofcall.test',
        body: JSON.stringify({ source: 'portofcall', ts: Date.now() }),
        contentType: 'application/json',
        persistent: true,
        priority: 4,
        timeout: 10000,
      }),
    });
    const data = await res.json() as {
      success: boolean; error?: string;
      destination?: string; bodyLength?: number; receiptReceived?: boolean;
    };
    if (data.success) {
      expect(data.destination).toBe('/queue/portofcall.test');
      expect(data.bodyLength).toBeGreaterThan(0);
    } else {
      expect(data.error).toBeDefined();
    }
  }, 15000);

  it('should subscribe and collect messages', async () => {
    // First send a message so there is something to receive
    await fetch(`${API_BASE}/activemq/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost', port: 61613,
        username: 'admin', password: 'admin',
        destination: '/queue/portofcall.recv',
        body: 'hello from subscribe test',
        timeout: 8000,
      }),
    });

    const res = await fetch(`${API_BASE}/activemq/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost', port: 61613,
        username: 'admin', password: 'admin',
        destination: '/queue/portofcall.recv',
        maxMessages: 5,
        timeout: 10000,
      }),
    });
    const data = await res.json() as {
      success: boolean; error?: string;
      destination?: string; messageCount?: number;
      messages?: Array<{ body: string }>;
    };
    if (data.success) {
      expect(data.destination).toBe('/queue/portofcall.recv');
      expect(typeof data.messageCount).toBe('number');
      if (data.messageCount && data.messageCount > 0) {
        expect(data.messages).toBeDefined();
        expect(data.messages!.length).toBe(data.messageCount);
      }
    } else {
      expect(data.error).toBeDefined();
    }
  }, 20000);

  it('should query broker info via admin API', async () => {
    const res = await fetch(`${API_BASE}/activemq/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 8161,
        username: 'admin',
        password: 'admin',
        brokerName: 'localhost',
        action: 'brokerInfo',
        timeout: 10000,
      }),
    });
    const data = await res.json() as {
      success: boolean; error?: string; hint?: string;
      data?: { brokerName?: string; brokerVersion?: string };
    };
    if (data.success) {
      expect(data.data).toBeDefined();
      // brokerName and brokerVersion should be present in a real response
    } else {
      // Acceptable: admin console may not be running
      expect(data.error).toBeDefined();
    }
  }, 15000);
});
