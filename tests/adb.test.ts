/**
 * ADB (Android Debug Bridge) Protocol Integration Tests
 * Tests ADB smart socket protocol operations
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';
const ADB_BASE = `${API_BASE}/adb`;

// Note: ADB server must be running locally on port 5037 for these tests
// Run: adb start-server
const ADB_CONFIG = {
  host: 'localhost',
  port: 5037,
  timeout: 10000,
};

describe('ADB Protocol Integration Tests', () => {
  describe('ADB Command', () => {
    it('should execute host:version command', async () => {
      const response = await fetch(`${ADB_BASE}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ADB_CONFIG,
          command: 'host:version',
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should execute host:devices command', async () => {
      const response = await fetch(`${ADB_BASE}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ADB_CONFIG,
          command: 'host:devices',
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with invalid command', async () => {
      const response = await fetch(`${ADB_BASE}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ADB_CONFIG,
          command: '',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('required');
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${ADB_BASE}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 5037,
          command: 'host:version',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should fail with invalid port', async () => {
      const response = await fetch(`${ADB_BASE}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 99999,
          command: 'host:version',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${ADB_BASE}/command`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('ADB Version', () => {
    it('should get ADB server protocol version', async () => {
      const response = await fetch(`${ADB_BASE}/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ADB_CONFIG),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${ADB_BASE}/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 5037,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${ADB_BASE}/version`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('ADB Devices', () => {
    it('should list connected devices', async () => {
      const response = await fetch(`${ADB_BASE}/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ADB_CONFIG),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${ADB_BASE}/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 5037,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${ADB_BASE}/devices`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('ADB Shell', () => {
    it('should execute shell command on device', async () => {
      const response = await fetch(`${ADB_BASE}/shell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ADB_CONFIG,
          command: 'echo test',
          serial: '', // Use any device
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${ADB_BASE}/shell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 5037,
          command: 'echo test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should fail with missing command', async () => {
      const response = await fetch(`${ADB_BASE}/shell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ADB_CONFIG,
          serial: '',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Command');
    });

    it('should fail with invalid port', async () => {
      const response = await fetch(`${ADB_BASE}/shell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 0,
          command: 'echo test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${ADB_BASE}/shell`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('ADB Error Handling', () => {
    it('should handle non-existent host', async () => {
      const response = await fetch(`${ADB_BASE}/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-adb-host-12345.example.com',
          port: 5037,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should handle connection timeout', async () => {
      const response = await fetch(`${ADB_BASE}/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 5037,
          timeout: 100, // Very short timeout
        }),
      });

      const data = await response.json();
      // localhost:5037 has no ADB server running — should fail
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });
  });
});
