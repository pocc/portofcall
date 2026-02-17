/**
 * FTP Protocol Integration Tests
 * Tests all FTP operations against live public FTP servers
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';
const FTP_BASE = `${API_BASE}/ftp`;

// Test server credentials (local docker vsftpd server)
const FTP_CONFIG = {
  host: 'localhost',
  port: 21,
  username: 'testuser',
  password: 'testpass123',
};

describe('FTP Protocol Integration Tests', () => {
  // Test 1: Connection
  describe('FTP Connect', () => {
    it('should connect to FTP server successfully', async () => {
      const response = await fetch(`${FTP_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(FTP_CONFIG),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.currentDirectory).toBeDefined();
      expect(typeof data.currentDirectory).toBe('string');
    });

    it('should fail with invalid credentials', async () => {
      const response = await fetch(`${FTP_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...FTP_CONFIG,
          password: 'wrong-password',
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should fail with missing parameters', async () => {
      const response = await fetch(`${FTP_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: FTP_CONFIG.host,
          // Missing username and password
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  // Test 2: List Directory
  describe('FTP List', () => {
    it('should list directory contents', async () => {
      const response = await fetch(`${FTP_BASE}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...FTP_CONFIG,
          path: '/',
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.files)).toBe(true);
      expect(data.path).toBe('/');

      // Verify file structure
      if (data.files.length > 0) {
        const file = data.files[0];
        expect(file).toHaveProperty('name');
        expect(file).toHaveProperty('size');
        expect(file).toHaveProperty('type');
        expect(file).toHaveProperty('modified');
        expect(['file', 'directory']).toContain(file.type);
      }
    });

    it('should support GET request with query parameters', async () => {
      const params = new URLSearchParams({
        host: FTP_CONFIG.host,
        port: FTP_CONFIG.port.toString(),
        username: FTP_CONFIG.username,
        password: FTP_CONFIG.password,
        path: '/',
      });

      const response = await fetch(`${FTP_BASE}/list?${params}`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.files)).toBe(true);
    });
  });

  // Test 3: Upload File
  describe('FTP Upload', () => {
    it('should upload file successfully', async () => {
      const testContent = `Test file uploaded at ${new Date().toISOString()}`;
      const blob = new Blob([testContent], { type: 'text/plain' });

      const formData = new FormData();
      formData.append('host', FTP_CONFIG.host);
      formData.append('port', FTP_CONFIG.port.toString());
      formData.append('username', FTP_CONFIG.username);
      formData.append('password', FTP_CONFIG.password);
      formData.append('remotePath', '/vitest-upload.txt');
      formData.append('file', blob, 'test.txt');

      const response = await fetch(`${FTP_BASE}/upload`, {
        method: 'POST',
        body: formData,
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.size).toBe(testContent.length);
      expect(data.message).toContain('Uploaded');
    });

    it('should fail with missing file', async () => {
      const formData = new FormData();
      formData.append('host', FTP_CONFIG.host);
      formData.append('port', FTP_CONFIG.port.toString());
      formData.append('username', FTP_CONFIG.username);
      formData.append('password', FTP_CONFIG.password);
      formData.append('remotePath', '/test.txt');
      // Missing file

      const response = await fetch(`${FTP_BASE}/upload`, {
        method: 'POST',
        body: formData,
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  // Test 4: Download File
  describe('FTP Download', () => {
    it('should download file successfully', async () => {
      const response = await fetch(`${FTP_BASE}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...FTP_CONFIG,
          remotePath: '/vitest-upload.txt',
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toBe('application/octet-stream');

      const content = await response.text();
      expect(content).toContain('Test file uploaded at');
    });

    it('should fail with non-existent file', async () => {
      const response = await fetch(`${FTP_BASE}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...FTP_CONFIG,
          remotePath: '/non-existent-file-12345.txt',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });
  });

  // Test 5: Rename File
  describe('FTP Rename', () => {
    it('should rename file successfully', async () => {
      const response = await fetch(`${FTP_BASE}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...FTP_CONFIG,
          fromPath: '/vitest-upload.txt',
          toPath: '/vitest-renamed.txt',
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('Renamed');
    });

    it('should fail with non-existent source file', async () => {
      const response = await fetch(`${FTP_BASE}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...FTP_CONFIG,
          fromPath: '/non-existent-source.txt',
          toPath: '/new-name.txt',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  // Test 6: Delete File
  describe('FTP Delete', () => {
    it('should delete file successfully', async () => {
      const response = await fetch(`${FTP_BASE}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...FTP_CONFIG,
          remotePath: '/vitest-renamed.txt',
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('Deleted');
    });

    it('should handle delete of non-existent file', async () => {
      const response = await fetch(`${FTP_BASE}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...FTP_CONFIG,
          remotePath: '/non-existent-file-12345.txt',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  // Test 7: Create Directory
  describe('FTP Mkdir', () => {
    it('should create directory successfully', async () => {
      const timestamp = Date.now();
      const response = await fetch(`${FTP_BASE}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...FTP_CONFIG,
          dirPath: `/vitest-dir-${timestamp}`,
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('Created directory');
    });
  });

  // Test 8: API Error Handling
  describe('FTP Error Handling', () => {
    it('should return 405 for GET on upload endpoint', async () => {
      const response = await fetch(`${FTP_BASE}/upload`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });

    it('should handle network errors gracefully', async () => {
      const response = await fetch(`${FTP_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-host-12345.example.com',
          port: 21,
          username: 'test',
          password: 'test',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });
  });
});
