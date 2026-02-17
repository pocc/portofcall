import { describe, it, expect } from 'vitest';

const API_BASE = 'http://localhost:8787';

describe('SLP Protocol (Port 427)', () => {
  describe('Service Types - Input Validation', () => {
    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/slp/types`, {
        method: 'GET',
      });
      expect(response.status).toBe(405);
    });

    it('should require host', async () => {
      const response = await fetch(`${API_BASE}/api/slp/types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject invalid ports', async () => {
      const response = await fetch(`${API_BASE}/api/slp/types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'example.com',
          port: 99999,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Port');
    });
  });

  describe('Service Find - Input Validation', () => {
    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/slp/find`, {
        method: 'GET',
      });
      expect(response.status).toBe(405);
    });

    it('should require host', async () => {
      const response = await fetch(`${API_BASE}/api/slp/find`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceType: 'service:printer' }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should require service type', async () => {
      const response = await fetch(`${API_BASE}/api/slp/find`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com' }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Service type');
    });
  });

  describe('Attributes - Input Validation', () => {
    it('should reject GET requests', async () => {
      const response = await fetch(`${API_BASE}/api/slp/attributes`, {
        method: 'GET',
      });
      expect(response.status).toBe(405);
    });

    it('should require host', async () => {
      const response = await fetch(`${API_BASE}/api/slp/attributes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'service:printer:lpr://printer.example.com' }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should require service URL', async () => {
      const response = await fetch(`${API_BASE}/api/slp/attributes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com' }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Service URL');
    });
  });

  describe('Connection Tests', () => {
    it('should handle unreachable hosts gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/slp/types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 427,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 10000);

    it('should detect Cloudflare-protected hosts', async () => {
      const response = await fetch(`${API_BASE}/api/slp/types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 427,
        }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle wrong port (non-SLP service)', async () => {
      const response = await fetch(`${API_BASE}/api/slp/types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'google.com',
          port: 80,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      // Should either fail or get invalid response
      if (data.success) {
        expect(data.serviceTypes).toBeDefined();
      } else {
        expect(data.error).toBeDefined();
      }
    }, 10000);
  });

  describe('Response Structure', () => {
    it('should return proper error format for types failures', async () => {
      const response = await fetch(`${API_BASE}/api/slp/types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 427,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    }, 15000);

    it('should return proper error format for find failures', async () => {
      const response = await fetch(`${API_BASE}/api/slp/find`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 427,
          serviceType: 'service:printer',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error');
    }, 15000);

    it('should return proper error format for attributes failures', async () => {
      const response = await fetch(`${API_BASE}/api/slp/attributes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 427,
          url: 'service:printer:lpr://printer.example.com',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error');
    }, 15000);
  });
});
