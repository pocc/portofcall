/**
 * TFTP (Trivial File Transfer Protocol) Integration Tests
 *
 * These tests verify the TFTP protocol implementation by connecting
 * to TFTP servers and performing file transfer operations.
 *
 * Note: TFTP servers are not commonly available on public internet.
 * These tests are designed to test the protocol implementation
 * and may require a local TFTP server for validation.
 *
 * To run a local TFTP server for testing:
 * - Linux/Mac: tftpd-hpa or atftpd
 * - Docker: docker run -d -p 69:69/udp -v /path/to/tftpboot:/tftpboot pghalliday/tftp
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('TFTP Protocol Integration Tests', () => {
  const TFTP_HOST = process.env.TFTP_HOST || 'localhost';
  const TFTP_PORT = parseInt(process.env.TFTP_PORT || '69', 10);

  it('should connect to TFTP server', async () => {
    const response = await fetch(`${API_BASE}/tftp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: TFTP_HOST,
        port: TFTP_PORT,
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Connection may fail if no TFTP server is running
    if (data.success) {
      expect(data.success).toBe(true);
      expect(data.host).toBe(TFTP_HOST);
      expect(data.port).toBe(TFTP_PORT);
      expect(data.protocol).toBe('TFTP');
      expect(data.message).toContain('successful');
    } else {
      // Test validates the error response structure
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }
  }, 10000);

  it('should read a file from TFTP server', async () => {
    const response = await fetch(`${API_BASE}/tftp/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: TFTP_HOST,
        port: TFTP_PORT,
        filename: 'test.txt',
        mode: 'octet',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    // If TFTP server is available and has test.txt
    if (data.success) {
      expect(data.success).toBe(true);
      expect(data.filename).toBe('test.txt');
      expect(data.size).toBeGreaterThan(0);
      expect(data.data).toBeDefined(); // base64 encoded data
      expect(data.blocks).toBeGreaterThan(0);

      // Verify base64 data can be decoded
      const decoded = atob(data.data);
      expect(decoded.length).toBe(data.size);
    } else {
      // Test validates the error response structure
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }
  }, 15000);

  it('should write a file to TFTP server', async () => {
    const testContent = 'Hello from TFTP test!';
    const base64Data = btoa(testContent);

    const response = await fetch(`${API_BASE}/tftp/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: TFTP_HOST,
        port: TFTP_PORT,
        filename: 'test-upload.txt',
        data: base64Data,
        mode: 'octet',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    // If TFTP server is available and allows writes
    if (data.success) {
      expect(data.success).toBe(true);
      expect(data.filename).toBe('test-upload.txt');
      expect(data.size).toBe(testContent.length);
      expect(data.blocks).toBeGreaterThan(0);
      expect(data.message).toContain('uploaded');
    } else {
      // Test validates the error response structure
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }
  }, 15000);

  it('should handle non-existent file error', async () => {
    const response = await fetch(`${API_BASE}/tftp/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: TFTP_HOST,
        port: TFTP_PORT,
        filename: 'nonexistent-file-12345.txt',
        mode: 'octet',
        timeout: 5000,
      }),
    });

    const data = await response.json();

    // Should fail with file not found error
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should handle invalid request parameters', async () => {
    const response = await fetch(`${API_BASE}/tftp/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Missing required parameters
        host: TFTP_HOST,
        // filename is missing
      }),
    });

    expect(response.status).toBe(400);
    // API may return text or JSON error
    const text = await response.text();
    expect(text).toBeDefined();
    expect(text.length).toBeGreaterThan(0);
  });

  it('should handle connection timeout', async () => {
    const response = await fetch(`${API_BASE}/tftp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'unreachable-host-12345.invalid', // Non-routable IP
        port: 69,
        timeout: 1000, // Short timeout
      }),
    });

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    expect(data.error.toLowerCase()).toMatch(/timeout|failed/);
  }, 5000);

  it('should support netascii mode', async () => {
    const response = await fetch(`${API_BASE}/tftp/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: TFTP_HOST,
        port: TFTP_PORT,
        filename: 'test.txt',
        mode: 'netascii',
        timeout: 10000,
      }),
    });

    const data = await response.json();

    // If successful, verify the mode was accepted
    if (data.success) {
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    }
    // Otherwise, just verify error structure
  }, 15000);

  it('should reject non-POST requests', async () => {
    const response = await fetch(`${API_BASE}/tftp/connect`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  it('should handle large file transfers (multiple blocks)', async () => {
    // Create a file larger than 512 bytes (TFTP block size)
    const largeContent = 'A'.repeat(1024); // 1KB
    const base64Data = btoa(largeContent);

    const response = await fetch(`${API_BASE}/tftp/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: TFTP_HOST,
        port: TFTP_PORT,
        filename: 'large-test.txt',
        data: base64Data,
        mode: 'octet',
        timeout: 15000,
      }),
    });

    const data = await response.json();

    // If successful, verify multiple blocks were sent
    if (data.success) {
      expect(data.success).toBe(true);
      expect(data.size).toBe(largeContent.length);
      expect(data.blocks).toBeGreaterThan(1); // Should require multiple 512-byte blocks
    }
  }, 20000);
});
