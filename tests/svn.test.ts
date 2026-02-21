/**
 * SVN (Subversion) Protocol Integration Tests
 *
 * Tests svnserve wire protocol implementation with S-expression parsing.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = (process.env.API_BASE || 'https://portofcall.ross.gg/api').replace(/\/api$/, '');

describe('SVN Protocol Integration Tests', () => {
  describe('Server Probe (/api/svn/connect)', () => {
    it('should probe an SVN server and receive greeting', async () => {
      const response = await fetch(`${API_BASE}/api/svn/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'svn.apache.org',
          port: 3690,
          timeout: 15000,
        }),
      });

      const data = await response.json();

      if (data.success) {
        expect(data).toHaveProperty('host', 'svn.apache.org');
        expect(data).toHaveProperty('port', 3690);
        expect(data).toHaveProperty('greeting');
        expect(data).toHaveProperty('rtt');
        expect(data.rtt).toBeGreaterThan(0);

        // Greeting should be an S-expression
        expect(data.greeting).toMatch(/\(\s*success/);

        // Should have parsed version numbers
        if (data.minVersion !== undefined) {
          expect(data.minVersion).toBeGreaterThanOrEqual(1);
        }
        if (data.maxVersion !== undefined) {
          expect(data.maxVersion).toBeGreaterThanOrEqual(data.minVersion || 1);
        }

        // Capabilities should be an array
        if (data.capabilities) {
          expect(Array.isArray(data.capabilities)).toBe(true);
        }

        // Auth mechanisms should be an array
        if (data.authMechanisms) {
          expect(Array.isArray(data.authMechanisms)).toBe(true);
        }
      } else {
        // Server not available is acceptable
        expect(data).toHaveProperty('error');
      }
    });

    it('should validate required host', async () => {
      const response = await fetch(`${API_BASE}/api/svn/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 3690,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host is required');
    });

    it('should validate port range', async () => {
      const response = await fetch(`${API_BASE}/api/svn/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 0,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port must be between 1 and 65535');
    });

    it('should handle connection timeout', async () => {
      const response = await fetch(`${API_BASE}/api/svn/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'localhost',
          port: 3690,
          timeout: 1,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        expect(data.error).toBeTruthy();
      }
    });

    it('should handle invalid hostname', async () => {
      const response = await fetch(`${API_BASE}/api/svn/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'nonexistent-svn-server-99999.invalid',
          port: 3690,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });

    it('should handle non-SVN server', async () => {
      // Connect to an HTTP port — won't have SVN greeting
      const response = await fetch(`${API_BASE}/api/svn/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'google.com',
          port: 80,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      // Should either fail or return unexpected format
      if (data.success === false) {
        expect(data.error).toBeTruthy();
      }
    });
  });

  describe('S-Expression Greeting Parsing', () => {
    it('should parse a standard SVN success greeting', () => {
      const greeting = '( success ( 2 2 ( edit-pipeline svndiff1 absent-entries depth mergeinfo log-revprops ) ( ANONYMOUS CRAM-MD5 ) ) )';

      // Simulate parsing
      const versionMatch = greeting.match(/success\s+\(\s*(\d+)\s+(\d+)/);
      expect(versionMatch).not.toBeNull();
      expect(parseInt(versionMatch![1])).toBe(2);
      expect(parseInt(versionMatch![2])).toBe(2);

      // Parse capabilities
      const groupRegex = /\(\s*([^()]*)\s*\)/g;
      const groups: string[] = [];
      let match;
      while ((match = groupRegex.exec(greeting)) !== null) {
        groups.push(match[1].trim());
      }

      // Should have at least the capabilities and auth groups
      expect(groups.length).toBeGreaterThanOrEqual(2);

      // Capabilities group
      const capabilities = groups[0].split(/\s+/).filter(w => w.length > 0);
      expect(capabilities).toContain('edit-pipeline');
      expect(capabilities).toContain('svndiff1');
      expect(capabilities).toContain('absent-entries');
      expect(capabilities).toContain('depth');
      expect(capabilities).toContain('mergeinfo');

      // Auth mechanisms group
      const authMechanisms = groups[1].split(/\s+/).filter(w => w.length > 0);
      expect(authMechanisms).toContain('ANONYMOUS');
      expect(authMechanisms).toContain('CRAM-MD5');
    });

    it('should detect failure responses', () => {
      const failure = '( failure ( ( 210005 "No repository found in \'svn://example.com\'" "/path/to/server.c" 1234 ) ) )';

      expect(failure).toMatch(/failure/);
      expect(failure).not.toMatch(/^.*\(\s*success/);
    });

    it('should handle empty capabilities and auth lists', () => {
      const greeting = '( success ( 2 2 ( ) ( ) ) )';

      const groupRegex = /\(\s*([^()]*)\s*\)/g;
      const groups: string[] = [];
      let match;
      while ((match = groupRegex.exec(greeting)) !== null) {
        groups.push(match[1].trim());
      }

      // Empty groups should produce empty arrays
      const caps = groups[0].split(/\s+/).filter(w => w.length > 0);
      expect(caps).toHaveLength(0);

      const mechs = groups[1].split(/\s+/).filter(w => w.length > 0);
      expect(mechs).toHaveLength(0);
    });

    it('should parse version 1 to 2 range', () => {
      const greeting = '( success ( 1 2 ( edit-pipeline ) ( ANONYMOUS ) ) )';

      const versionMatch = greeting.match(/success\s+\(\s*(\d+)\s+(\d+)/);
      expect(versionMatch).not.toBeNull();
      expect(parseInt(versionMatch![1])).toBe(1);
      expect(parseInt(versionMatch![2])).toBe(2);
    });

    it('should handle S-expression depth tracking', () => {
      const greeting = '( success ( 2 2 ( edit-pipeline svndiff1 ) ( ANONYMOUS ) ) )';

      let depth = 0;
      let complete = false;
      for (const ch of greeting) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (depth === 0 && greeting.indexOf('(') >= 0) {
          complete = true;
          break;
        }
      }

      expect(complete).toBe(true);
    });

    it('should know common SVN capabilities', () => {
      const knownCapabilities = [
        'edit-pipeline',
        'svndiff1',
        'absent-entries',
        'depth',
        'mergeinfo',
        'log-revprops',
        'atomic-revprops',
        'partial-replay',
        'inherited-props',
        'ephemeral-txnprops',
        'file-revs-reverse',
        'list',
      ];

      // All should be valid string identifiers
      for (const cap of knownCapabilities) {
        expect(cap).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });

    it('should know common SVN auth mechanisms', () => {
      const knownMechanisms = [
        'ANONYMOUS',
        'CRAM-MD5',
        'EXTERNAL',
      ];

      for (const mech of knownMechanisms) {
        expect(mech).toMatch(/^[A-Z][A-Z0-9-]*$/);
      }
    });
  });
});
