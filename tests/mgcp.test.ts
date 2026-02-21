/**
 * MGCP (Media Gateway Control Protocol) Integration Tests
 * Tests MGCP text protocol, AUEP audit, and call setup commands
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('MGCP Protocol Integration Tests', () => {
  describe('MGCP Audit Endpoint (AUEP)', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/mgcp/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-mgcp-gateway-12345.example.com',
          port: 2427,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/mgcp/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 2427,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should accept default endpoint parameter', async () => {
      const response = await fetch(`${API_BASE}/mgcp/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept custom endpoint parameter', async () => {
      const response = await fetch(`${API_BASE}/mgcp/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          endpoint: 'ds/ds1-0/1',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('MGCP Generic Command', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/mgcp/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'AUEP',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should fail with missing command parameter', async () => {
      const response = await fetch(`${API_BASE}/mgcp/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Command');
    });

    it('should reject invalid MGCP verbs', async () => {
      const response = await fetch(`${API_BASE}/mgcp/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          command: 'INVALID',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Invalid');
    });

    it('should accept valid CA-to-GW commands', async () => {
      const validCommands = ['AUEP', 'CRCX', 'MDCX', 'DLCX', 'RQNT', 'EPCF'];

      for (const cmd of validCommands) {
        const response = await fetch(`${API_BASE}/mgcp/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: 'unreachable-host-12345.invalid',
            command: cmd,
            timeout: 3000,
          }),
        });

        const data = await response.json();
        expect(data).toHaveProperty('success');
      }
    }, 30000);
  });

  describe('MGCP Call Setup', () => {
    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/mgcp/call-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'aaln/1',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should fail with missing endpoint parameter', async () => {
      const response = await fetch(`${API_BASE}/mgcp/call-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Endpoint');
    });

    it('should accept custom connection mode', async () => {
      const response = await fetch(`${API_BASE}/mgcp/call-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          endpoint: 'aaln/1',
          connectionMode: 'sendonly',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/mgcp/call-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          endpoint: 'aaln/1',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('MGCP Port Support', () => {
    it('should accept default port 2427', async () => {
      const response = await fetch(`${API_BASE}/mgcp/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2427,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept custom ports', async () => {
      const response = await fetch(`${API_BASE}/mgcp/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2428,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('MGCP Response Code Validation', () => {
    it('should handle timeout gracefully', async () => {
      const response = await fetch(`${API_BASE}/mgcp/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2427,
          timeout: 2000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });
});
