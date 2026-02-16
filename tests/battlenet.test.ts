import { describe, it, expect } from 'vitest';

describe('Battle.net BNCS Protocol Integration Tests', () => {
  const API_BASE = 'http://localhost:8787';

  describe('POST /api/battlenet/connect', () => {
    it('should validate missing host', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 6112,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('host');
    });

    it('should validate invalid port range', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'useast.battle.net',
          port: 70000,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should validate invalid protocol ID', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'useast.battle.net',
          port: 6112,
          protocolId: 99,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Protocol ID');
    });

    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent-battlenet-server.invalid',
          port: 6112,
          timeout: 5000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.host).toBe('nonexistent-battlenet-server.invalid');
      expect(data.port).toBe(6112);
    });

    it('should use default port 6112 when not specified', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'useast.battle.net',
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.port).toBe(6112);
    });

    it('should use default protocol ID 0x01 (Game) when not specified', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'useast.battle.net',
          port: 6112,
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.protocolId).toBe(1);
    });

    it('should handle timeout correctly', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET-1 (RFC 5737) - should timeout
          port: 6112,
          timeout: 2000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should reject GET requests', async () => {
      const response = await fetch(
        `${API_BASE}/api/battlenet/connect?host=useast.battle.net&port=6112`,
        { method: 'GET' }
      );

      expect(response.status).toBe(405);
    });

    it('should connect to Battle.net server and receive BNCS response', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'useast.battle.net',
          port: 6112,
          protocolId: 1, // Game protocol
          timeout: 15000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Either success with server response or failure with error
      if (data.success) {
        expect(data.serverResponse).toBe(true);
        expect(data.messageId).toBeDefined();
        expect(data.messageLength).toBeDefined();
      } else {
        // Connection might fail if Battle.net servers are down or blocking
        expect(data.error).toBeDefined();
      }

      expect(data.host).toBe('useast.battle.net');
      expect(data.port).toBe(6112);
      expect(data.protocolId).toBe(1);
    }, 20000);
  });

  describe('Protocol Message Format', () => {
    it('should include message ID in hex format for successful connections', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'useast.battle.net',
          port: 6112,
          protocolId: 1,
          timeout: 15000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      if (data.success && data.messageId !== undefined) {
        // Message ID should be a valid byte value
        expect(data.messageId).toBeGreaterThanOrEqual(0);
        expect(data.messageId).toBeLessThanOrEqual(255);
      }
    }, 20000);

    it('should return raw data in hex format when available', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'useast.battle.net',
          port: 6112,
          protocolId: 1,
          timeout: 15000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      if (data.success && data.rawData) {
        // Raw data should be hex-formatted string
        expect(data.rawData).toMatch(/^[0-9a-f\s]+$/);
      }
    }, 20000);
  });

  describe('Protocol Variants', () => {
    it('should support BNFTP protocol (0x02)', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'useast.battle.net',
          port: 6112,
          protocolId: 2, // BNFTP
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.protocolId).toBe(2);
    }, 15000);

    it('should support Telnet/Chat protocol (0x03)', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'useast.battle.net',
          port: 6112,
          protocolId: 3, // Telnet/Chat
          timeout: 10000,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.protocolId).toBe(3);
    }, 15000);
  });

  describe('Edge Cases', () => {
    it('should handle empty host string', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 6112,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle port 0', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'useast.battle.net',
          port: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle very large port number', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'useast.battle.net',
          port: 999999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle malformed JSON', async () => {
      const response = await fetch(`${API_BASE}/api/battlenet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });
});
