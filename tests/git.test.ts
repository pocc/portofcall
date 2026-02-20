import { describe, it, expect } from 'vitest';

const API_BASE = (process.env.API_BASE || 'https://portofcall.ross.gg/api').replace(/\/api$/, '');

describe('Git Protocol (Port 9418)', () => {
  describe('Input Validation', () => {
    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/git/refs`, {
        method: 'GET',
      });
      expect(response.status).toBe(405);
    });

    it('should require host', async () => {
      const response = await fetch(`${API_BASE}/api/git/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: '/pub/scm/git/git.git' }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should require repo path', async () => {
      const response = await fetch(`${API_BASE}/api/git/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'git.kernel.org' }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Repository');
    });

    it('should reject invalid ports', async () => {
      const response = await fetch(`${API_BASE}/api/git/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'git.kernel.org',
          repo: '/pub/scm/git/git.git',
          port: 99999,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });
  });

  describe('Live Connection Tests', () => {
    it('should list refs from git.kernel.org (git.git)', async () => {
      const response = await fetch(`${API_BASE}/api/git/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'git.kernel.org',
          repo: '/pub/scm/git/git.git',
          timeout: 30000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data.refs).toBeDefined();
        expect(Array.isArray(data.refs)).toBe(true);
        expect(data.refs.length).toBeGreaterThan(0);
        expect(data.branchCount).toBeGreaterThan(0);
        expect(data.tagCount).toBeGreaterThan(0);
        expect(data.connectTimeMs).toBeGreaterThan(0);
        expect(data.totalTimeMs).toBeGreaterThan(0);

        // Should have HEAD
        const head = data.refs.find((r: { name: string }) => r.name === 'HEAD');
        expect(head).toBeDefined();
        expect(head.sha).toMatch(/^[0-9a-f]{40}$/);

        // Should have main or master branch
        const mainBranch = data.refs.find(
          (r: { name: string }) =>
            r.name === 'refs/heads/main' || r.name === 'refs/heads/master'
        );
        expect(mainBranch).toBeDefined();

        // Should have capabilities
        expect(data.capabilities).toBeDefined();
        expect(data.capabilities.length).toBeGreaterThan(0);
      } else {
        // Connection might fail in CI - just check error format
        expect(data.error).toBeDefined();
        expect(typeof data.error).toBe('string');
      }
    }, 45000);

    it('should handle nonexistent repos gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/git/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'git.kernel.org',
          repo: '/pub/scm/nonexistent/fake-repo.git',
          timeout: 15000,
        }),
      });

      const data = await response.json();
      // Should either fail or return empty refs
      if (data.success) {
        expect(data.refs.length).toBe(0);
      } else {
        expect(data.error).toBeDefined();
      }
    }, 20000);

    it('should handle unreachable hosts', async () => {
      const response = await fetch(`${API_BASE}/api/git/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          repo: '/test.git',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should detect Cloudflare-protected hosts', async () => {
      const response = await fetch(`${API_BASE}/api/git/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          repo: '/test.git',
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  describe('Response Structure', () => {
    it('should return properly structured refs', async () => {
      const response = await fetch(`${API_BASE}/api/git/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'git.kernel.org',
          repo: '/pub/scm/git/git.git',
          timeout: 30000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Each ref should have sha and name
        for (const ref of data.refs.slice(0, 5)) {
          expect(ref.sha).toBeDefined();
          expect(ref.sha).toMatch(/^[0-9a-f]{40}$/);
          expect(ref.name).toBeDefined();
          expect(typeof ref.name).toBe('string');
        }

        // Branch and tag counts should match
        const branchRefs = data.refs.filter((r: { name: string }) =>
          r.name.startsWith('refs/heads/')
        );
        const tagRefs = data.refs.filter((r: { name: string }) =>
          r.name.startsWith('refs/tags/')
        );
        expect(branchRefs.length).toBe(data.branchCount);
        expect(tagRefs.length).toBe(data.tagCount);
      }
    }, 45000);
  });
});
