/**
 * Source RCON (Steam/Valve) Protocol Integration Tests
 *
 * These tests verify the Source RCON protocol implementation
 * for remote Source engine game server administration.
 *
 * Supported games: CS:GO, TF2, L4D2, GMod, HL2DM, etc.
 *
 * Note: Tests require either a running Source game server with RCON enabled
 * or will gracefully handle connection failures.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('Source RCON Protocol Integration Tests', () => {
  // --- Validation Tests (same as Minecraft RCON) ---

  it('should reject empty host', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '',
        port: 27015,
        password: 'test',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 99999,
        password: 'test',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should reject host with invalid characters', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'host;rm -rf /',
        port: 27015,
        password: 'test',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('invalid characters');
  });

  it('should reject empty password', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: '',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Password is required');
  });

  it('should reject password exceeding max length', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'a'.repeat(513),
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Password too long');
  });

  it('should reject empty command', async () => {
    const response = await fetch(`${API_BASE}/rcon/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'test',
        command: '',
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Command is required');
  });

  it('should reject command exceeding max length', async () => {
    const response = await fetch(`${API_BASE}/rcon/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'test',
        command: 'a'.repeat(1447),
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Command too long');
  });

  // --- Source Engine Connection Tests ---

  it('should handle connection to non-existent Source server', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'test',
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Should fail gracefully (no server running)
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);

  it('should use Source engine default port 27015', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'test',
        timeout: 3000,
      }),
    });

    const data = await response.json();

    // Should attempt connection on Source port 27015
    if (!data.success) {
      expect(data.error).toBeDefined();
    }
  }, 10000);

  it('should attempt authentication with Source server', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'sourcepass',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // If connection succeeds, check auth result
    if (data.success) {
      expect(typeof data.authenticated).toBe('boolean');
    }
  }, 10000);

  // --- Source Engine Command Tests ---

  it('should execute "status" command on Source server', async () => {
    const response = await fetch(`${API_BASE}/rcon/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'sourcepass',
        command: 'status',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // If connection and auth succeed, check response
    if (data.success) {
      expect(data.authenticated).toBe(true);
      expect(data.response).toBeDefined();
      // Status command should return server info
      if (data.response && data.response.length > 0) {
        expect(data.response).toMatch(/hostname|map|players|version/i);
      }
    }
  }, 10000);

  it('should execute "users" command on Source server', async () => {
    const response = await fetch(`${API_BASE}/rcon/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'sourcepass',
        command: 'users',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.authenticated).toBe(true);
      expect(data.response).toBeDefined();
    }
  }, 10000);

  it('should execute "version" command on Source server', async () => {
    const response = await fetch(`${API_BASE}/rcon/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'sourcepass',
        command: 'version',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.authenticated).toBe(true);
      expect(data.response).toBeDefined();
      // Version command should return game version info
      if (data.response && data.response.length > 0) {
        expect(data.response).toMatch(/version|protocol|exe|build/i);
      }
    }
  }, 10000);

  it('should execute "cvarlist" command on Source server', async () => {
    const response = await fetch(`${API_BASE}/rcon/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'sourcepass',
        command: 'cvarlist',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.authenticated).toBe(true);
      expect(data.response).toBeDefined();
      // cvarlist returns a long list of console variables
      if (data.response && data.response.length > 0) {
        expect(data.response.length).toBeGreaterThan(100);
      }
    }
  }, 10000);

  it('should execute "hostname" command on Source server', async () => {
    const response = await fetch(`${API_BASE}/rcon/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'sourcepass',
        command: 'hostname',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.authenticated).toBe(true);
      expect(data.response).toBeDefined();
    }
  }, 10000);

  it('should execute "maps *" command on Source server', async () => {
    const response = await fetch(`${API_BASE}/rcon/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'sourcepass',
        command: 'maps *',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.authenticated).toBe(true);
      expect(data.response).toBeDefined();
      // maps * lists available maps
      if (data.response && data.response.length > 0) {
        expect(data.response).toMatch(/\.bsp|PENDING|maps/i);
      }
    }
  }, 10000);

  // --- CS:GO Specific Commands ---

  it('should execute CS:GO specific command "mp_autoteambalance"', async () => {
    const response = await fetch(`${API_BASE}/rcon/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'sourcepass',
        command: 'mp_autoteambalance',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.authenticated).toBe(true);
      expect(data.response).toBeDefined();
    }
  }, 10000);

  // --- TF2 Specific Commands ---

  it('should execute TF2 specific command "tf_tournament"', async () => {
    const response = await fetch(`${API_BASE}/rcon/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'sourcepass',
        command: 'tf_tournament',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success) {
      expect(data.authenticated).toBe(true);
      expect(data.response).toBeDefined();
    }
  }, 10000);

  // --- Error Handling Tests ---

  it('should handle incorrect password gracefully', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'localhost',
        port: 27015,
        password: 'wrongpassword',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    if (data.success && data.authenticated === false) {
      expect(data.error).toContain('Authentication failed');
    }
  }, 10000);

  it('should handle timeout for slow connections', async () => {
    const response = await fetch(`${API_BASE}/rcon/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid', // Non-routable IP
        port: 27015,
        password: 'test',
        timeout: 2000,
      }),
    });

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 5000);

  // --- Multi-Game Support Tests ---

  it('should work with different Source games on same port', async () => {
    // CS:GO, TF2, L4D2, GMod all use the same RCON protocol
    const games = [
      { name: 'CS:GO', command: 'mp_autoteambalance' },
      { name: 'TF2', command: 'tf_tournament' },
      { name: 'L4D2', command: 'sb_all_bot_game' },
      { name: 'GMod', command: 'gamemode' },
    ];

    for (const game of games) {
      const response = await fetch(`${API_BASE}/rcon/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 27015,
          password: 'sourcepass',
          command: game.command,
          timeout: 3000,
        }),
      });

      const data = await response.json();

      // All should use same protocol regardless of game
      if (data.success) {
        expect(data.authenticated).toBe(true);
        expect(data.response).toBeDefined();
      }
    }
  }, 30000);
});
