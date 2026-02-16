import { describe, it, expect } from 'vitest';

const WORKER_URL = 'http://localhost:8787';

describe('CVS pserver Integration', () => {
  describe('Connect', () => {
    it('should connect to CVS server and get greeting', async () => {
      const response = await fetch(`${WORKER_URL}/api/cvs/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cvs.example.com',
          port: 2401,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.greeting).toBeDefined();
    });

    it('should reject empty host for connect', async () => {
      const response = await fetch(`${WORKER_URL}/api/cvs/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 2401,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject invalid port for connect', async () => {
      const response = await fetch(`${WORKER_URL}/api/cvs/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cvs.example.com',
          port: -1,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('port');
    });

    it('should handle connection timeout for connect', async () => {
      const response = await fetch(`${WORKER_URL}/api/cvs/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET-1 (RFC 5737) - guaranteed to timeout
          port: 2401,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 35000); // 35 second timeout for network timeout test
  });

  describe('Login', () => {
    it('should attempt CVS authentication', async () => {
      const response = await fetch(`${WORKER_URL}/api/cvs/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cvs.example.com',
          port: 2401,
          repository: '/cvs',
          username: 'anonymous',
          password: 'anonymous',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.authenticated).toBeDefined();
    });

    it('should reject empty host for login', async () => {
      const response = await fetch(`${WORKER_URL}/api/cvs/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '',
          port: 2401,
          repository: '/cvs',
          username: 'user',
          password: 'pass',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject invalid port for login', async () => {
      const response = await fetch(`${WORKER_URL}/api/cvs/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cvs.example.com',
          port: 99999,
          repository: '/cvs',
          username: 'user',
          password: 'pass',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('port');
    });

    it('should reject missing repository for login', async () => {
      const response = await fetch(`${WORKER_URL}/api/cvs/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cvs.example.com',
          port: 2401,
          repository: '',
          username: 'user',
          password: 'pass',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Repository');
    });

    it('should reject missing username for login', async () => {
      const response = await fetch(`${WORKER_URL}/api/cvS/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cvs.example.com',
          port: 2401,
          repository: '/cvs',
          username: '',
          password: 'pass',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Username');
    });

    it('should reject missing password for login', async () => {
      const response = await fetch(`${WORKER_URL}/api/cvs/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cvs.example.com',
          port: 2401,
          repository: '/cvs',
          username: 'user',
          password: '',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Password');
    });
  });
});
