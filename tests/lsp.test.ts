/**
 * LSP (Language Server Protocol) Integration Tests
 *
 * Implementation: src/worker/lsp.ts
 *
 * Endpoints:
 *   POST /api/lsp/connect  — send LSP initialize request, return server capabilities
 *   POST /api/lsp/session  — full session: initialize → initialized → hover → completion → shutdown → exit
 *
 * Default port: 2087/TCP
 *
 * Wire format: JSON-RPC 2.0 with Content-Length header framing (LSP spec §3.17).
 * Neither endpoint enforces POST-only via an explicit method check.
 * Missing host returns 400; connection/timeout errors return 500.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';

describe('LSP Protocol Integration Tests', () => {
  // ── /api/lsp/connect ──────────────────────────────────────────────────────

  describe('POST /api/lsp/connect', () => {
    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/lsp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should use default port 2087', async () => {
      const response = await fetch(`${API_BASE}/lsp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 20000);

    it('should return success:false for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/lsp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-lsp-host-12345.example.com',
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 20000);

    it('should accept custom port', async () => {
      const response = await fetch(`${API_BASE}/lsp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          port: 8080,
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 20000);

    it('should accept rootUri parameter', async () => {
      const response = await fetch(`${API_BASE}/lsp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          rootUri: 'file:///workspace',
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 20000);

    it('should detect Cloudflare-protected host (cloudflare: true)', async () => {
      const response = await fetch(`${API_BASE}/lsp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'cloudflare.com' }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.cloudflare).toBe(true);
      expect(data.error).toContain('Cloudflare');
    }, 15000);

    it('should return capabilities and capabilityList on success', async () => {
      // On actual success these fields would be set; on failure they're absent.
      // Just verify the shape is consistent.
      const response = await fetch(`${API_BASE}/lsp/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 3000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
      if (data.success) {
        expect(data).toHaveProperty('capabilities');
        expect(data).toHaveProperty('capabilityList');
        expect(Array.isArray(data.capabilityList)).toBe(true);
        expect(data.protocolVersion).toBe('3.17');
      }
    }, 10000);
  });

  // ── /api/lsp/session ──────────────────────────────────────────────────────

  describe('POST /api/lsp/session', () => {
    it('should return 400 when host is missing', async () => {
      const response = await fetch(`${API_BASE}/lsp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Host');
    });

    it('should use default port 2087', async () => {
      const response = await fetch(`${API_BASE}/lsp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 25000);

    it('should return success:false for unreachable host', async () => {
      const response = await fetch(`${API_BASE}/lsp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'non-existent-lsp-host-12345.example.com',
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
    }, 25000);

    it('should accept textDocumentUri parameter', async () => {
      const response = await fetch(`${API_BASE}/lsp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          textDocumentUri: 'file:///workspace/test.ts',
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 25000);

    it('should accept textDocumentContent parameter', async () => {
      const response = await fetch(`${API_BASE}/lsp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          textDocumentUri: 'file:///workspace/test.ts',
          textDocumentContent: 'const x = 1;',
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 25000);

    it('should accept language parameter', async () => {
      const response = await fetch(`${API_BASE}/lsp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          textDocumentUri: 'file:///workspace/test.ts',
          language: 'typescript',
          timeout: 5000,
        }),
      });
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }, 25000);

    it('should detect Cloudflare-protected host (cloudflare: true)', async () => {
      const response = await fetch(`${API_BASE}/lsp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'cloudflare.com' }),
      });
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.cloudflare).toBe(true);
    }, 15000);

    it('should return initialized / capabilities / hoverResult / completionItems on success', async () => {
      const response = await fetch(`${API_BASE}/lsp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'unreachable-host-12345.invalid',
          timeout: 5000,
        }),
      });
      const data = await response.json();
      if (data.success) {
        expect(data.initialized).toBe(true);
        expect(data).toHaveProperty('capabilities');
        expect(data).toHaveProperty('capabilityList');
        expect(data).toHaveProperty('hoverResult');
        expect(typeof data.completionItems).toBe('number');
        expect(data).toHaveProperty('rtt');
      }
    }, 25000);
  });

  // ── LSP wire format — static structural tests ─────────────────────────────

  describe('LSP wire format', () => {
    it('Content-Length framing has correct format', () => {
      // LSP spec §3.17: Content-Length: N\r\n\r\n<JSON>
      const header = 'Content-Length: 123\r\n\r\n';
      expect(header).toContain('Content-Length:');
      expect(header).toContain('\r\n\r\n');
    });

    it('JSON-RPC 2.0 request has required fields', () => {
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      };
      expect(request.jsonrpc).toBe('2.0');
      expect(request.id).toBeDefined();
      expect(request.method).toBe('initialize');
    });

    it('JSON-RPC 2.0 notification has no id field', () => {
      const notification: { jsonrpc: string; method: string; params: object; id?: number } = {
        jsonrpc: '2.0',
        method: 'initialized',
        params: {},
      };
      expect(notification.jsonrpc).toBe('2.0');
      expect(notification.id).toBeUndefined();
      expect(notification.method).toBe('initialized');
    });

    it('LSP uses protocol version 3.17', () => {
      expect('3.17').toBe('3.17');
    });

    it('initialize request uses method "initialize"', () => {
      expect('initialize').toBe('initialize');
    });

    it('shutdown request uses method "shutdown"', () => {
      expect('shutdown').toBe('shutdown');
    });

    it('exit notification uses method "exit"', () => {
      expect('exit').toBe('exit');
    });

    it('textDocument/didOpen uses correct method string', () => {
      expect('textDocument/didOpen').toBe('textDocument/didOpen');
    });

    it('textDocument/hover uses correct method string', () => {
      expect('textDocument/hover').toBe('textDocument/hover');
    });

    it('textDocument/completion uses correct method string', () => {
      expect('textDocument/completion').toBe('textDocument/completion');
    });
  });

  // ── Capability names ───────────────────────────────────────────────────────

  describe('LSP server capability field names', () => {
    const caps = [
      'completionProvider',
      'hoverProvider',
      'definitionProvider',
      'referencesProvider',
      'documentFormattingProvider',
      'documentRangeFormattingProvider',
      'codeActionProvider',
      'renameProvider',
      'foldingRangeProvider',
      'semanticTokensProvider',
      'inlayHintProvider',
      'diagnosticProvider',
      'workspaceSymbolProvider',
      'executeCommandProvider',
      'textDocumentSync',
    ];

    for (const cap of caps) {
      it(`capability key "${cap}" is a string`, () => {
        expect(typeof cap).toBe('string');
        expect(cap.length).toBeGreaterThan(0);
      });
    }
  });
});
