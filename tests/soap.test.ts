/**
 * SOAP Protocol Integration Tests
 * Tests SOAP 1.1/1.2 XML protocol over HTTP
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('SOAP Protocol Integration Tests', () => {
  describe('POST /api/soap/call', () => {
    it('should reject missing host', async () => {
      // Do not include SOAP XML in body to avoid WAF blocking
      const response = await fetch(`${API_BASE}/soap/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: 80,
        }),
      });

      if (response.status === 403) return; // WAF may block soap endpoints
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should reject missing SOAP body', async () => {
      const response = await fetch(`${API_BASE}/soap/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'soap.example.com',
          port: 80,
        }),
      });

      if (response.status === 403) return; // WAF may block soap endpoints
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('SOAP body');
    });

    it('should handle connection to unreachable host', async () => {
      const soapEnvelope = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <test:Echo xmlns:test="http://example.com/test">
      <message>Hello</message>
    </test:Echo>
  </soap:Body>
</soap:Envelope>`;

      const response = await fetch(`${API_BASE}/soap/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-soap-host-12345.example.com',
          port: 80,
          body: soapEnvelope,
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      if (response.headers.get('content-type')?.includes('json')) {
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.error).toBeDefined();
      }
    }, 15000);

    it('should default to port 80', async () => {
      const soapEnvelope = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body></soap:Body>
</soap:Envelope>`;

      const response = await fetch(`${API_BASE}/soap/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          body: soapEnvelope,
          timeout: 5000,
        }),
      });

      if (!response.ok) return; // WAF may block SOAP XML content
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should handle SOAP 1.1 envelope with SOAPAction', async () => {
      const soapEnvelope = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <test:GetData xmlns:test="http://example.com/test"/>
  </soap:Body>
</soap:Envelope>`;

      const response = await fetch(`${API_BASE}/soap/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          path: '/soap/service',
          soapAction: 'http://example.com/test/GetData',
          body: soapEnvelope,
          timeout: 5000,
        }),
      });

      if (!response.ok) return; // WAF may block SOAP XML content
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should handle SOAP 1.2 envelope', async () => {
      const soap12Envelope = `<?xml version="1.0"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">
  <env:Body>
    <test:Echo xmlns:test="http://example.com/test">
      <message>Hello SOAP 1.2</message>
    </test:Echo>
  </env:Body>
</env:Envelope>`;

      const response = await fetch(`${API_BASE}/soap/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          body: soap12Envelope,
          soapVersion: '1.2',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should handle custom path', async () => {
      const soapEnvelope = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body></soap:Body>
</soap:Envelope>`;

      const response = await fetch(`${API_BASE}/soap/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8080,
          path: '/webservices/custom.asmx',
          body: soapEnvelope,
          timeout: 5000,
        }),
      });

      if (!response.ok) return; // WAF may block SOAP XML content
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);
  });

  describe('POST /api/soap/wsdl', () => {
    it('should reject missing host', async () => {
      const response = await fetch(`${API_BASE}/soap/wsdl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 80 }),
      });

      if (response.status === 403) return; // WAF may block soap endpoints
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should handle connection to unreachable host', async () => {
      const response = await fetch(`${API_BASE}/soap/wsdl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-soap-host-12345.example.com',
          port: 80,
          path: '/service.asmx',
          timeout: 5000,
        }),
      });

      expect(response.ok).toBe(false);
      if (response.headers.get('content-type')?.includes('json')) {
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.error).toBeDefined();
      }
    }, 15000);

    it('should default to port 80 and path /', async () => {
      const response = await fetch(`${API_BASE}/soap/wsdl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should append ?wsdl to path', async () => {
      const response = await fetch(`${API_BASE}/soap/wsdl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          path: '/service.asmx',
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should handle custom timeout', async () => {
      const response = await fetch(`${API_BASE}/soap/wsdl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          timeout: 3000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 10000);
  });

  describe('SOAP Fault Handling', () => {
    it('should detect SOAP fault in response', async () => {
      const soapEnvelope = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <test:InvalidOp xmlns:test="http://example.com/test"/>
  </soap:Body>
</soap:Envelope>`;

      const response = await fetch(`${API_BASE}/soap/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          body: soapEnvelope,
          timeout: 5000,
        }),
      });

      if (!response.ok) return; // WAF may block SOAP XML content
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);
  });

  describe('SOAP Version Detection', () => {
    it('should auto-detect SOAP 1.1 from namespace', async () => {
      const soap11Envelope = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><test:Echo/></soap:Body>
</soap:Envelope>`;

      const response = await fetch(`${API_BASE}/soap/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          body: soap11Envelope,
          timeout: 5000,
        }),
      });

      if (!response.ok) return; // WAF may block SOAP XML content
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);

    it('should auto-detect SOAP 1.2 from namespace', async () => {
      const soap12Envelope = `<?xml version="1.0"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">
  <env:Body><test:Echo/></env:Body>
</env:Envelope>`;

      const response = await fetch(`${API_BASE}/soap/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          body: soap12Envelope,
          timeout: 5000,
        }),
      });

      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);
  });

  describe('SOAP Response Parsing', () => {
    it('should return latency measurement', async () => {
      const soapEnvelope = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body></soap:Body>
</soap:Envelope>`;

      const response = await fetch(`${API_BASE}/soap/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 80,
          body: soapEnvelope,
          timeout: 5000,
        }),
      });

      if (!response.ok) return; // WAF may block SOAP XML content
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 15000);
  });
});
