/**
 * DICT Protocol Integration Tests
 *
 * These tests verify the DICT protocol implementation by querying
 * the public dict.org server for word definitions and matches.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('DICT Protocol Integration Tests', () => {
  it('should successfully define a common word', async () => {
    const response = await fetch(`${API_BASE}/dict/define`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: 'hello',
        database: '*',
        timeout: 15000,
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.word).toBe('hello');
    expect(data.server).toBe('dict.org:2628');
    expect(data.definitions).toBeDefined();
    expect(data.definitions.length).toBeGreaterThan(0);
    expect(data.count).toBeGreaterThan(0);
  }, 20000);

  it('should define a word from a specific database', async () => {
    const response = await fetch(`${API_BASE}/dict/define`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: 'algorithm',
        database: 'wn',
        timeout: 15000,
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.word).toBe('algorithm');
    expect(data.definitions).toBeDefined();
    if (data.definitions.length > 0) {
      expect(data.definitions[0].database).toBe('wn');
    }
  }, 20000);

  it('should return no definitions for a nonsense word', async () => {
    const response = await fetch(`${API_BASE}/dict/define`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: 'xyzzyplugh',
        database: '*',
        timeout: 15000,
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.definitions).toBeDefined();
    expect(data.definitions.length).toBe(0);
  }, 20000);

  it('should match words with prefix strategy', async () => {
    const response = await fetch(`${API_BASE}/dict/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: 'algo',
        database: '*',
        strategy: 'prefix',
        timeout: 15000,
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.word).toBe('algo');
    expect(data.strategy).toBe('prefix');
    expect(data.matches).toBeDefined();
    expect(data.matches.length).toBeGreaterThan(0);

    // Should find "algorithm" with prefix "algo"
    const words = data.matches.map((m: { word: string }) => m.word.toLowerCase());
    expect(words.some((w: string) => w.startsWith('algo'))).toBe(true);
  }, 20000);

  it('should list available databases', async () => {
    const response = await fetch(`${API_BASE}/dict/databases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeout: 15000,
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.server).toBe('dict.org:2628');
    expect(data.databases).toBeDefined();
    expect(data.databases.length).toBeGreaterThan(0);
    expect(data.count).toBeGreaterThan(0);

    // dict.org should have WordNet
    const dbNames = data.databases.map((db: { name: string }) => db.name);
    expect(dbNames).toContain('wn');
  }, 20000);

  it('should reject empty word for define', async () => {
    const response = await fetch(`${API_BASE}/dict/define`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: '',
        timeout: 15000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Word is required');
  });

  it('should reject empty word for match', async () => {
    const response = await fetch(`${API_BASE}/dict/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: '',
        timeout: 15000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Word is required');
  });

  it('should reject invalid characters in word', async () => {
    const response = await fetch(`${API_BASE}/dict/define`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: 'hello; DROP TABLE',
        timeout: 15000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Word contains invalid characters');
  });

  it('should reject invalid port number', async () => {
    const response = await fetch(`${API_BASE}/dict/define`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: 'test',
        port: 99999,
        timeout: 15000,
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });

  it('should handle soundex matching', async () => {
    const response = await fetch(`${API_BASE}/dict/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: 'kat',
        database: '*',
        strategy: 'soundex',
        timeout: 15000,
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.strategy).toBe('soundex');
    expect(data.matches).toBeDefined();
    // Soundex for "kat" should match "cat" and similar
    if (data.matches.length > 0) {
      expect(data.count).toBeGreaterThan(0);
    }
  }, 20000);

  it('should use default host and port when not specified', async () => {
    const response = await fetch(`${API_BASE}/dict/define`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: 'test',
        timeout: 15000,
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.server).toBe('dict.org:2628');
  }, 20000);
});
