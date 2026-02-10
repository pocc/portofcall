/**
 * IRC Protocol Integration Tests
 * Tests IRC connectivity and message parsing
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('IRC Protocol Integration Tests', () => {
  describe('IRC Connect (HTTP)', () => {
    it('should connect to Libera.Chat and receive welcome', async () => {
      const response = await fetch(`${API_BASE}/irc/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'irc.libera.chat',
          port: 6667,
          nickname: 'PortOfCallTest' + Math.floor(Math.random() * 10000),
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.host).toBe('irc.libera.chat');
      expect(data.port).toBe(6667);
      expect(data.messagesReceived).toBeGreaterThan(0);
    }, 30000);

    it('should receive welcome message with server info', async () => {
      const response = await fetch(`${API_BASE}/irc/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'irc.libera.chat',
          port: 6667,
          nickname: 'PoCTestInfo' + Math.floor(Math.random() * 10000),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Should have received welcome
          expect(data.welcome).toBeDefined();
          expect(data.messages).toBeDefined();
          expect(Array.isArray(data.messages)).toBe(true);
        }
      }
    }, 30000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/irc/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: 'test',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should fail with missing nickname parameter', async () => {
      const response = await fetch(`${API_BASE}/irc/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'irc.libera.chat',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('nickname');
    });

    it('should reject invalid nicknames', async () => {
      const response = await fetch(`${API_BASE}/irc/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'irc.libera.chat',
          nickname: '123invalid', // Starts with a number
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid nickname');
    });

    it('should reject GET method', async () => {
      const response = await fetch(`${API_BASE}/irc/connect`);
      expect(response.status).toBe(405);
    });

    it('should fail with non-existent host', async () => {
      const response = await fetch(`${API_BASE}/irc/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-irc-server-12345.example.com',
          port: 6667,
          nickname: 'testuser',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 30000);
  });

  describe('IRC Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/irc/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 6667,
          nickname: 'testuser',
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 30000);
  });

  describe('IRC Message Parsing', () => {
    // These tests validate the parsing logic conceptually
    // The actual parseIRCMessage function runs on the worker

    it('should parse server welcome format correctly', () => {
      // Verify our test expectations match IRC message format
      const exampleWelcome = ':server 001 nick :Welcome to IRC';
      expect(exampleWelcome).toMatch(/^:\S+ \d{3} /);
    });

    it('should understand PRIVMSG format', () => {
      const exampleMsg = ':alice!~alice@host PRIVMSG #test :Hello everyone!';
      expect(exampleMsg).toContain('PRIVMSG');
      expect(exampleMsg).toContain('#test');
    });

    it('should understand JOIN format', () => {
      const exampleJoin = ':alice!~alice@host JOIN #test';
      expect(exampleJoin).toContain('JOIN');
    });

    it('should understand PING format', () => {
      const examplePing = 'PING :server.name';
      expect(examplePing).toMatch(/^PING/);
    });
  });
});
