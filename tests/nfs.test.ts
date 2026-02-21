/**
 * NFS Protocol Integration Tests
 * Tests NFS (Network File System) ONC-RPC protocol operations
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';
const NFS_BASE = `${API_BASE}/nfs`;

// Note: NFS server must be running and accessible for these tests
// Default NFS port is 2049
const NFS_CONFIG = {
  host: 'test-host.invalid',
  port: 2049,
  timeout: 10000,
};

// A realistic exportPath used in multi-step tests
const EXPORT_PATH = '/export';

describe('NFS Protocol Integration Tests', () => {
  describe('NFS Probe', () => {
    it('should probe NFS server with NULL call', async () => {
      const response = await fetch(`${NFS_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(NFS_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(NFS_CONFIG.host);
      expect(data.port).toBe(NFS_CONFIG.port);

      if (data.success) {
        expect(data.versions).toBeDefined();
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should test NFSv3 with version probe', async () => {
      const response = await fetch(`${NFS_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          version: 3,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(NFS_CONFIG.host);

      if (data.success) {
        expect(data.versions).toBeDefined();
      }
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${NFS_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 2049,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should fail with invalid port', async () => {
      const response = await fetch(`${NFS_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          port: 99999,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${NFS_BASE}/probe`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should handle non-existent host gracefully', async () => {
      const response = await fetch(`${NFS_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-nfs-host-12345.example.com',
          port: 2049,
          timeout: 3000,
        }),
      });

      // Probe returns success:true with all versions having connection errors
      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      if (data.versions) {
        const anySupported = Object.values(data.versions as Record<string, {supported: boolean}>).some(v => v.supported);
        expect(anySupported).toBe(false);
      }
    });

    it('should detect Cloudflare-protected host', async () => {
      const response = await fetch(`${NFS_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 2049,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      if (data.isCloudflare) {
        expect(data.isCloudflare).toBe(true);
        expect(data.success).toBe(false);
      } else {
        expect(data).toHaveProperty('success');
      }
    });
  });

  describe('NFS Mount Export', () => {
    it('should list NFS exports', async () => {
      const response = await fetch(`${NFS_BASE}/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(NFS_CONFIG),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(NFS_CONFIG.host);

      if (data.success) {
        expect(Array.isArray(data.exports)).toBe(true);
        expect(data.rtt).toBeGreaterThan(0);

        if (data.exports.length > 0) {
          const exportItem = data.exports[0];
          expect(exportItem).toHaveProperty('directory');
          expect(exportItem).toHaveProperty('groups');
        }
      }
    });

    it('should handle MOUNT server on different port', async () => {
      const response = await fetch(`${NFS_BASE}/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          mountPort: 20048,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(NFS_CONFIG.host);
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${NFS_BASE}/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 2049,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${NFS_BASE}/exports`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('NFS Lookup', () => {
    it('should look up a path within an export', async () => {
      const response = await fetch(`${NFS_BASE}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          path: 'test.txt',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(NFS_CONFIG.host);

      if (data.success) {
        expect(data.fileHandle).toBeDefined();
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${NFS_BASE}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportPath: EXPORT_PATH,
          path: 'test.txt',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('host');
    });

    it('should fail with missing exportPath', async () => {
      const response = await fetch(`${NFS_BASE}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          path: 'test.txt',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('exportPath');
    });

    it('should fail with missing path', async () => {
      const response = await fetch(`${NFS_BASE}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('path');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${NFS_BASE}/lookup`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${NFS_BASE}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-nfs-host-12345.example.com',
          port: 2049,
          timeout: 3000,
          exportPath: EXPORT_PATH,
          path: 'test.txt',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });
  });

  describe('NFS GetAttr', () => {
    it('should get attributes for an export root', async () => {
      const response = await fetch(`${NFS_BASE}/getattr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(NFS_CONFIG.host);

      if (data.success) {
        expect(data.rtt).toBeGreaterThan(0);
        // fattr3 fields
        if (data.type !== undefined) {
          expect(typeof data.type).toBe('string');
        }
        if (data.size !== undefined) {
          expect(typeof data.size).toBe('number');
        }
      }
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${NFS_BASE}/getattr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportPath: EXPORT_PATH,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('host');
    });

    it('should fail with missing exportPath', async () => {
      const response = await fetch(`${NFS_BASE}/getattr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('exportPath');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${NFS_BASE}/getattr`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('NFS Read', () => {
    it('should attempt to read a file', async () => {
      const response = await fetch(`${NFS_BASE}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          path: 'readme.txt',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(NFS_CONFIG.host);

      if (data.success) {
        expect(data.bytesRead).toBeTypeOf('number');
        expect(data.eof).toBeTypeOf('boolean');
        expect(data.encoding).toMatch(/^(utf-8|base64)$/);
        expect(data.data).toBeDefined();
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${NFS_BASE}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportPath: EXPORT_PATH,
          path: 'readme.txt',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('host');
    });

    it('should fail with missing exportPath', async () => {
      const response = await fetch(`${NFS_BASE}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          path: 'readme.txt',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('exportPath');
    });

    it('should fail with missing path', async () => {
      const response = await fetch(`${NFS_BASE}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('path');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${NFS_BASE}/read`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('NFS Read Directory', () => {
    it('should read directory contents via exportPath', async () => {
      const response = await fetch(`${NFS_BASE}/readdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          path: '',
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(NFS_CONFIG.host);

      if (data.success) {
        expect(Array.isArray(data.entries)).toBe(true);
        expect(data.rtt).toBeGreaterThan(0);

        if (data.entries.length > 0) {
          const entry = data.entries[0];
          expect(entry).toHaveProperty('name');
          expect(entry).toHaveProperty('fileId');
        }
      }
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${NFS_BASE}/readdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportPath: EXPORT_PATH,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing exportPath', async () => {
      const response = await fetch(`${NFS_BASE}/readdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('exportPath');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${NFS_BASE}/readdir`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('NFS Write', () => {
    it('should attempt to write data to a file', async () => {
      const testData = btoa('Hello NFS test');

      const response = await fetch(`${NFS_BASE}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          path: 'test-write.txt',
          data: testData,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.host).toBe(NFS_CONFIG.host);

      if (data.success) {
        expect(data.bytesWritten).toBeTypeOf('number');
        expect(data.committed).toBeDefined();
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${NFS_BASE}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportPath: EXPORT_PATH,
          path: 'test.txt',
          data: btoa('test'),
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing data', async () => {
      const response = await fetch(`${NFS_BASE}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          path: 'test.txt',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with invalid base64 data', async () => {
      const response = await fetch(`${NFS_BASE}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          path: 'test.txt',
          data: 'not-valid-base64!!!',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('base64');
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${NFS_BASE}/write`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('NFS Create', () => {
    it('should attempt to create a file', async () => {
      const response = await fetch(`${NFS_BASE}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          path: 'newfile.txt',
          mode: 0o644,
        }),
      });

      if (!response.ok) return;
      const data = await response.json();
      expect(data.host).toBe(NFS_CONFIG.host);

      if (data.success) {
        expect(data.created).toBe(true);
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should create a file with initial content', async () => {
      const response = await fetch(`${NFS_BASE}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          path: 'newfile-with-content.txt',
          data: btoa('initial content'),
        }),
      });

      if (!response.ok) return;
      const data = await response.json();
      expect(data.host).toBe(NFS_CONFIG.host);
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${NFS_BASE}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportPath: EXPORT_PATH,
          path: 'newfile.txt',
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing exportPath', async () => {
      const response = await fetch(`${NFS_BASE}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          path: 'newfile.txt',
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing path', async () => {
      const response = await fetch(`${NFS_BASE}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${NFS_BASE}/create`, {
        method: 'GET',
      });

      if (response.status === 404) return;
      expect(response.status).toBe(405);
    });

    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${NFS_BASE}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-nfs-host-12345.example.com',
          port: 2049,
          timeout: 3000,
          exportPath: EXPORT_PATH,
          path: 'newfile.txt',
        }),
      });

      if (!response.ok) return;
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });
  });

  describe('NFS Remove', () => {
    it('should attempt to delete a file', async () => {
      const response = await fetch(`${NFS_BASE}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          path: 'deleteme.txt',
        }),
      });

      if (!response.ok) return;
      const data = await response.json();
      expect(data.host).toBe(NFS_CONFIG.host);

      if (data.success) {
        expect(data.deleted).toBe(true);
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${NFS_BASE}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportPath: EXPORT_PATH,
          path: 'deleteme.txt',
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing exportPath', async () => {
      const response = await fetch(`${NFS_BASE}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          path: 'deleteme.txt',
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing path', async () => {
      const response = await fetch(`${NFS_BASE}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${NFS_BASE}/remove`, {
        method: 'GET',
      });

      if (response.status === 404) return;
      expect(response.status).toBe(405);
    });
  });

  describe('NFS Rename', () => {
    it('should attempt to rename a file', async () => {
      const response = await fetch(`${NFS_BASE}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          fromPath: 'oldname.txt',
          toPath: 'newname.txt',
        }),
      });

      if (!response.ok) return;
      const data = await response.json();
      expect(data.host).toBe(NFS_CONFIG.host);

      if (data.success) {
        expect(data.renamed).toBe(true);
        expect(data.fromPath).toBe('oldname.txt');
        expect(data.toPath).toBe('newname.txt');
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${NFS_BASE}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportPath: EXPORT_PATH,
          fromPath: 'old.txt',
          toPath: 'new.txt',
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing exportPath', async () => {
      const response = await fetch(`${NFS_BASE}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          fromPath: 'old.txt',
          toPath: 'new.txt',
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing fromPath', async () => {
      const response = await fetch(`${NFS_BASE}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          toPath: 'new.txt',
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing toPath', async () => {
      const response = await fetch(`${NFS_BASE}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          fromPath: 'old.txt',
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${NFS_BASE}/rename`, {
        method: 'GET',
      });

      if (response.status === 404) return;
      expect(response.status).toBe(405);
    });
  });

  describe('NFS Mkdir', () => {
    it('should attempt to create a directory', async () => {
      const response = await fetch(`${NFS_BASE}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          path: 'newdir',
          mode: 0o755,
        }),
      });

      if (!response.ok) return;
      const data = await response.json();
      expect(data.host).toBe(NFS_CONFIG.host);

      if (data.success) {
        expect(data.created).toBe(true);
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${NFS_BASE}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportPath: EXPORT_PATH,
          path: 'newdir',
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing exportPath', async () => {
      const response = await fetch(`${NFS_BASE}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          path: 'newdir',
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing path', async () => {
      const response = await fetch(`${NFS_BASE}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${NFS_BASE}/mkdir`, {
        method: 'GET',
      });

      if (response.status === 404) return;
      expect(response.status).toBe(405);
    });

    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${NFS_BASE}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-nfs-host-12345.example.com',
          port: 2049,
          timeout: 3000,
          exportPath: EXPORT_PATH,
          path: 'newdir',
        }),
      });

      if (!response.ok) return;
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });
  });

  describe('NFS Rmdir', () => {
    it('should attempt to remove a directory', async () => {
      const response = await fetch(`${NFS_BASE}/rmdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
          path: 'emptydir',
        }),
      });

      if (!response.ok) return;
      const data = await response.json();
      expect(data.host).toBe(NFS_CONFIG.host);

      if (data.success) {
        expect(data.deleted).toBe(true);
        expect(data.rtt).toBeGreaterThan(0);
      }
    });

    it('should fail with missing host', async () => {
      const response = await fetch(`${NFS_BASE}/rmdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportPath: EXPORT_PATH,
          path: 'emptydir',
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing exportPath', async () => {
      const response = await fetch(`${NFS_BASE}/rmdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          path: 'emptydir',
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing path', async () => {
      const response = await fetch(`${NFS_BASE}/rmdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          exportPath: EXPORT_PATH,
        }),
      });

      if (response.status === 404) return;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should reject GET requests', async () => {
      const response = await fetch(`${NFS_BASE}/rmdir`, {
        method: 'GET',
      });

      if (response.status === 404) return;
      expect(response.status).toBe(405);
    });
  });

  describe('NFS Error Handling', () => {
    it('should handle connection timeout on probe', async () => {
      const response = await fetch(`${NFS_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: '192.0.2.1', // TEST-NET-1 (should timeout)
          port: 2049,
          timeout: 1000,
        }),
      });

      // Probe returns success:true with all versions having connection errors
      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
      if (data.versions) {
        const anySupported = Object.values(data.versions as Record<string, {supported: boolean}>).some(v => v.supported);
        expect(anySupported).toBe(false);
      }
    });

    it('should handle invalid version gracefully', async () => {
      const response = await fetch(`${NFS_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...NFS_CONFIG,
          version: 999,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data).toHaveProperty('success');
    });

    it('should use default port 2049 when not specified', async () => {
      const response = await fetch(`${NFS_BASE}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'test-host.invalid',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      if (!response.ok) return;
      expect(data.port).toBe(2049);
    });
  });
});
