/**
 * LSP (Language Server Protocol) Implementation
 *
 * The Language Server Protocol (LSP) enables communication between code editors
 * and language servers for features like autocomplete, go-to-definition, and
 * diagnostics. LSP uses JSON-RPC 2.0 with a Content-Length header framing.
 *
 * Wire Format (unlike HTTP-based JSON-RPC):
 *   Content-Length: <byte-count>\r\n
 *   \r\n
 *   <JSON-RPC message>
 *
 * Protocol Flow:
 * 1. Client connects to language server via TCP
 * 2. Client sends "initialize" request
 * 3. Server responds with InitializeResult (capabilities)
 * 4. Client sends "initialized" notification
 * 5. Normal LSP session begins
 *
 * Spec: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare } from './cloudflare-detector';

interface LspConnectRequest {
  host: string;
  port?: number;
  rootUri?: string;
  timeout?: number;
}

interface LspCapabilities {
  textDocumentSync?: unknown;
  completionProvider?: unknown;
  hoverProvider?: boolean | unknown;
  definitionProvider?: boolean | unknown;
  referencesProvider?: boolean | unknown;
  documentFormattingProvider?: boolean | unknown;
  documentRangeFormattingProvider?: boolean | unknown;
  codeActionProvider?: boolean | unknown;
  renameProvider?: boolean | unknown;
  foldingRangeProvider?: boolean | unknown;
  semanticTokensProvider?: unknown;
  inlayHintProvider?: unknown;
  diagnosticProvider?: unknown;
  workspaceSymbolProvider?: boolean | unknown;
  executeCommandProvider?: unknown;
  [key: string]: unknown;
}

interface LspServerInfo {
  name?: string;
  version?: string;
}

interface LspInitializeResult {
  capabilities: LspCapabilities;
  serverInfo?: LspServerInfo;
}

interface LspConnectResponse {
  success: boolean;
  serverInfo?: LspServerInfo;
  capabilities?: LspCapabilities;
  capabilityList?: string[];
  protocolVersion?: string;
  error?: string;
  latencyMs?: number;
  cloudflare?: boolean;
}

/**
 * Encode a JSON-RPC message with LSP Content-Length framing.
 */
function encodeLspMessage(message: unknown): Uint8Array {
  const json = JSON.stringify(message);
  const encoder = new TextEncoder();
  const body = encoder.encode(json);
  const header = encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
  const result = new Uint8Array(header.byteLength + body.byteLength);
  result.set(header, 0);
  result.set(body, header.byteLength);
  return result;
}

/**
 * Parse an LSP-framed message from a buffer string.
 * Returns { message, remaining } or null if incomplete.
 */
function parseLspMessage(buffer: string): { message: unknown; remaining: string } | null {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;

  const headerSection = buffer.substring(0, headerEnd);
  const contentLengthMatch = headerSection.match(/Content-Length:\s*(\d+)/i);
  if (!contentLengthMatch) return null;

  const contentLength = parseInt(contentLengthMatch[1], 10);
  const bodyStart = headerEnd + 4;

  if (buffer.length < bodyStart + contentLength) return null;

  const bodyStr = buffer.substring(bodyStart, bodyStart + contentLength);
  const remaining = buffer.substring(bodyStart + contentLength);

  try {
    const message = JSON.parse(bodyStr);
    return { message, remaining };
  } catch {
    return null;
  }
}

/**
 * Read LSP messages from a socket until we get a response with the given id,
 * or until timeout.
 */
async function readLspResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  targetId: number,
  timeout: number,
): Promise<LspInitializeResult> {
  const decoder = new TextDecoder();
  let buffer = '';

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('LSP response timeout')), timeout);
  });

  while (true) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done) throw new Error('Connection closed before receiving response');

    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }

    // Try to parse complete messages from buffer
    let parsed = parseLspMessage(buffer);
    while (parsed) {
      const msg = parsed.message as { id?: number; result?: LspInitializeResult; error?: { message: string } };
      buffer = parsed.remaining;

      if (msg.id === targetId) {
        if (msg.error) {
          throw new Error(`LSP error: ${msg.error.message}`);
        }
        if (msg.result) {
          return msg.result;
        }
      }

      parsed = parseLspMessage(buffer);
    }
  }
}

/**
 * Extract a human-readable list of capabilities from the capabilities object.
 */
function extractCapabilityList(caps: LspCapabilities): string[] {
  const list: string[] = [];

  const check = (key: string, label: string) => {
    const val = caps[key];
    if (val === true || (val !== undefined && val !== null && val !== false)) {
      list.push(label);
    }
  };

  check('completionProvider', 'Code Completion');
  check('hoverProvider', 'Hover Information');
  check('definitionProvider', 'Go to Definition');
  check('referencesProvider', 'Find References');
  check('documentFormattingProvider', 'Document Formatting');
  check('documentRangeFormattingProvider', 'Range Formatting');
  check('codeActionProvider', 'Code Actions');
  check('renameProvider', 'Rename Symbol');
  check('foldingRangeProvider', 'Folding Ranges');
  check('semanticTokensProvider', 'Semantic Tokens');
  check('inlayHintProvider', 'Inlay Hints');
  check('diagnosticProvider', 'Diagnostics');
  check('workspaceSymbolProvider', 'Workspace Symbol Search');
  check('executeCommandProvider', 'Execute Command');

  const textDocSync = caps['textDocumentSync'];
  if (textDocSync !== undefined && textDocSync !== null) {
    list.push('Text Document Sync');
  }

  return list;
}

/**
 * Handle LSP connect — send initialize request and return server capabilities.
 */
export async function handleLspConnect(request: Request): Promise<Response> {
  let host: string | undefined;
  try {
    const body = await request.json() as LspConnectRequest;
    host = body.host;
    const port = body.port ?? 2087;
    const rootUri = body.rootUri ?? null;
    const timeout = body.timeout ?? 15000;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for Cloudflare protection
    const cfResult = await checkIfCloudflare(host);
    if (cfResult.isCloudflare) {
      const response: LspConnectResponse = {
        success: false,
        cloudflare: true,
        error: 'Host is protected by Cloudflare — direct TCP connection is not possible',
      };
      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Build initialize request
    const initializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        processId: null,
        clientInfo: {
          name: 'PortOfCall',
          version: '1.0.0',
        },
        capabilities: {
          textDocument: {
            synchronization: {},
            completion: {},
            hover: {},
            definition: {},
            references: {},
            formatting: {},
          },
          workspace: {
            workspaceFolders: true,
            configuration: true,
          },
        },
        rootUri,
        workspaceFolders: null,
      },
    };

    await writer.write(encodeLspMessage(initializeRequest));
    writer.releaseLock();

    const result = await readLspResponse(reader, 1, timeout);
    const latencyMs = Date.now() - start;

    reader.releaseLock();
    socket.close();

    const capabilityList = extractCapabilityList(result.capabilities);

    const response: LspConnectResponse = {
      success: true,
      serverInfo: result.serverInfo,
      capabilities: result.capabilities,
      capabilityList,
      protocolVersion: '3.17',
      latencyMs,
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const response: LspConnectResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'LSP connection failed',
    };
    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
