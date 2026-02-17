/**
 * HL7 v2.x Protocol Integration Tests
 * Tests HL7 MLLP connectivity and message sending endpoints
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('HL7 v2.x Protocol Integration Tests', () => {
  describe('HL7 Connect (MLLP Connectivity)', () => {
    it('should handle connection to non-existent host', async () => {
      const response = await fetch(`${API_BASE}/hl7/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-hl7-host-12345.example.com',
          port: 2575,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/hl7/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 2575,
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Host');
    });

    it('should handle custom port parameter', async () => {
      const response = await fetch(`${API_BASE}/hl7/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2576,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle custom timeout parameter', async () => {
      const response = await fetch(`${API_BASE}/hl7/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2575,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);
  });

  describe('HL7 Send Message', () => {
    it('should handle connection failure when sending ADT^A01', async () => {
      const response = await fetch(`${API_BASE}/hl7/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-hl7-host-12345.example.com',
          port: 2575,
          messageType: 'ADT^A01',
          sendingApplication: 'TestApp',
          sendingFacility: 'TestFac',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    }, 15000);

    it('should fail with missing host parameter', async () => {
      const response = await fetch(`${API_BASE}/hl7/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 2575,
          messageType: 'ADT^A01',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle ORU^R01 message type', async () => {
      const response = await fetch(`${API_BASE}/hl7/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2575,
          messageType: 'ORU^R01',
          sendingApplication: 'LabSystem',
          sendingFacility: 'MainLab',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data.success).toBe(false);
    }, 10000);

    it('should handle custom sending/receiving application fields', async () => {
      const response = await fetch(`${API_BASE}/hl7/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2575,
          messageType: 'ADT^A01',
          sendingApplication: 'MyEHR',
          sendingFacility: 'MainHospital',
          receivingApplication: 'LabInfo',
          receivingFacility: 'ClinicalLab',
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('HL7 Error Handling', () => {
    it('should return 400 for missing host on connect', async () => {
      const response = await fetch(`${API_BASE}/hl7/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 2575,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing host on send', async () => {
      const response = await fetch(`${API_BASE}/hl7/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 2575,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle network errors gracefully', async () => {
      const response = await fetch(`${API_BASE}/hl7/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2575,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 15000);
  });

  describe('HL7 Cloudflare Detection', () => {
    it('should block connection to Cloudflare-protected host', async () => {
      const response = await fetch(`${API_BASE}/hl7/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'cloudflare.com',
          port: 2575,
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.isCloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 10000);
  });

  describe('HL7 Port Support', () => {
    it('should accept port 2575 (HL7 default)', async () => {
      const response = await fetch(`${API_BASE}/hl7/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2575,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);

    it('should accept port 2576 (HL7 alternative)', async () => {
      const response = await fetch(`${API_BASE}/hl7/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 2576,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });
});
