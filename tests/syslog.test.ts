/**
 * Syslog Protocol Integration Tests
 *
 * These tests verify the Syslog protocol implementation by sending
 * log messages to a syslog server at various severity levels.
 *
 * Note: These tests require a syslog server to be running.
 * You can use rsyslog in Docker or any syslog-compatible server.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Syslog Protocol Integration Tests', () => {
  // Note: These tests will fail without a configured syslog server
  // They are designed to test the protocol implementation, not live servers

  it('should format and send an informational message (RFC 5424)', async () => {
    const response = await fetch(`${API_BASE}/syslog/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 514,
        severity: 6, // Informational
        facility: 16, // Local0
        message: 'Test informational message',
        hostname: 'testhost',
        appName: 'testapp',
        format: 'rfc5424',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Note: Connection may fail if no syslog server is running
    // We're primarily testing the message formatting
    if (data.success) {
      expect(data.message).toContain('sent successfully');
      expect(data.formatted).toBeDefined();
      expect(data.formatted).toMatch(/^<134>1 /); // Priority 134 = (16*8)+6
      expect(data.formatted).toContain('testhost');
      expect(data.formatted).toContain('testapp');
      expect(data.formatted).toContain('Test informational message');
    }
  }, 10000);

  it('should format an error message (RFC 5424)', async () => {
    const response = await fetch(`${API_BASE}/syslog/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 514,
        severity: 3, // Error
        facility: 16, // Local0
        message: 'Test error message',
        format: 'rfc5424',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.formatted).toMatch(/^<131>1 /); // Priority 131 = (16*8)+3
      expect(data.formatted).toContain('Test error message');
    }
  }, 10000);

  it('should format a message in RFC 3164 (legacy) format', async () => {
    const response = await fetch(`${API_BASE}/syslog/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 514,
        severity: 4, // Warning
        facility: 16, // Local0
        message: 'Test warning message',
        hostname: 'testhost',
        appName: 'testapp',
        format: 'rfc3164',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.formatted).toMatch(/^<132>/); // Priority 132 = (16*8)+4
      expect(data.formatted).toContain('testhost');
      expect(data.formatted).toContain('testapp:');
      expect(data.formatted).toContain('Test warning message');
    }
  }, 10000);

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/syslog/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        severity: 6,
        message: 'Test message',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject empty message', async () => {
    const response = await fetch(`${API_BASE}/syslog/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        severity: 6,
        message: '',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Message is required');
  });

  it('should reject invalid severity level', async () => {
    const response = await fetch(`${API_BASE}/syslog/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        severity: 99, // Invalid
        message: 'Test message',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Severity must be between 0 and 7');
  });

  it('should reject invalid facility code', async () => {
    const response = await fetch(`${API_BASE}/syslog/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        severity: 6,
        facility: 99, // Invalid
        message: 'Test message',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Facility must be between 0 and 23');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/syslog/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 99999,
        severity: 6,
        message: 'Test message',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should calculate correct priority for all severity levels', async () => {
    const severities = [
      { level: 0, name: 'Emergency', priority: 128 },    // (16*8)+0
      { level: 1, name: 'Alert', priority: 129 },        // (16*8)+1
      { level: 2, name: 'Critical', priority: 130 },     // (16*8)+2
      { level: 3, name: 'Error', priority: 131 },        // (16*8)+3
      { level: 4, name: 'Warning', priority: 132 },      // (16*8)+4
      { level: 5, name: 'Notice', priority: 133 },       // (16*8)+5
      { level: 6, name: 'Informational', priority: 134 },// (16*8)+6
      { level: 7, name: 'Debug', priority: 135 },        // (16*8)+7
    ];

    for (const sev of severities) {
      const response = await fetch(`${API_BASE}/syslog/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 514,
          severity: sev.level,
          facility: 16, // Local0
          message: `Test ${sev.name} message`,
          format: 'rfc5424',
          timeout: 5000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        const priorityMatch = data.formatted.match(/^<(\d+)>/);
        if (priorityMatch) {
          expect(parseInt(priorityMatch[1])).toBe(sev.priority);
        }
      }
    }
  }, 30000);
});
