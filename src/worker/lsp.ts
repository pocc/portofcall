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
 *
 * Per the LSP spec, Content-Length counts bytes (not characters), and the
 * header block is terminated by \r\n\r\n.
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
 * Concatenate two Uint8Array buffers into a new one.
 */
function concatBytes(a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): Uint8Array {
  const result = new Uint8Array(a.byteLength + b.byteLength);
  result.set(a, 0);
  result.set(b, a.byteLength);
  return result;
}

/**
 * Find the byte offset of the \r\n\r\n header terminator in a Uint8Array.
 * Returns -1 if not found.
 */
function findHeaderEnd(buf: Uint8Array): number {
  // Search for 0x0D 0x0A 0x0D 0x0A (\r\n\r\n)
  for (let i = 0; i <= buf.byteLength - 4; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a && buf[i + 2] === 0x0d && buf[i + 3] === 0x0a) {
      return i;
    }
  }
  return -1;
}

/**
 * Parse an LSP-framed message from a byte buffer.
 *
 * Content-Length is specified in bytes per the LSP spec, so we operate on
 * raw bytes rather than decoded strings to avoid multi-byte UTF-8 character
 * miscounts.
 *
 * Returns { message, remaining } or null if the buffer is incomplete.
 */
function parseLspMessage(buffer: Uint8Array): { message: unknown; remaining: Uint8Array } | null {
  const headerEnd = findHeaderEnd(buffer);
  if (headerEnd === -1) return null;

  // Headers are always ASCII, safe to decode as a string
  const decoder = new TextDecoder();
  const headerSection = decoder.decode(buffer.subarray(0, headerEnd));
  const contentLengthMatch = headerSection.match(/Content-Length:\s*(\d+)/i);
  if (!contentLengthMatch) return null;

  const contentLength = parseInt(contentLengthMatch[1], 10);
  const bodyStart = headerEnd + 4; // skip \r\n\r\n

  if (buffer.byteLength < bodyStart + contentLength) return null;

  // Decode exactly contentLength bytes as the JSON body
  const bodyBytes = buffer.subarray(bodyStart, bodyStart + contentLength);
  const bodyStr = decoder.decode(bodyBytes);
  const remaining = buffer.subarray(bodyStart + contentLength);

  try {
    const message = JSON.parse(bodyStr);
    return { message, remaining: new Uint8Array(remaining) };
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
  let buffer = new Uint8Array(0);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('LSP response timeout')), timeout);
  });

  while (true) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done) throw new Error('Connection closed before receiving response');

    if (value) {
      buffer = concatBytes(buffer, value);
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
 * Handle LSP connect -- send initialize request and return server capabilities.
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
        error: 'Host is protected by Cloudflare -- direct TCP connection is not possible',
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

    // Build initialize request per LSP 3.17 spec
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

/**
 * Write a single LSP Content-Length framed message to the writer.
 */
async function sendLSPMessage(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  obj: unknown,
): Promise<void> {
  await writer.write(encodeLspMessage(obj));
}

/**
 * Read one complete Content-Length framed LSP message from the reader.
 *
 * Accumulates raw bytes until a full message is available, then returns the
 * parsed JSON and updates the byte buffer with any remainder.
 *
 * Uses byte-level buffering to correctly handle Content-Length (which counts
 * bytes, not characters) even when JSON payloads contain multi-byte UTF-8.
 */
async function readLSPMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  bufferRef: { value: Uint8Array },
  timeoutMs: number,
): Promise<unknown> {
  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LSP read timeout')), timeoutMs)
  );

  while (true) {
    const parsed = parseLspMessage(bufferRef.value);
    if (parsed) {
      bufferRef.value = parsed.remaining;
      return parsed.message;
    }

    const { value, done } = await Promise.race([reader.read(), deadline]);
    if (done) throw new Error('Connection closed while waiting for LSP message');
    if (value) {
      bufferRef.value = concatBytes(bufferRef.value, value);
    }
  }
}

interface LspSessionRequest {
  host: string;
  port?: number;
  timeout?: number;
  rootUri?: string;
  textDocumentUri?: string;
  textDocumentContent?: string;
  language?: string;
}

/**
 * Handle a full LSP session:
 * initialize -> initialized -> (optional) didOpen -> hover -> completion -> shutdown -> exit
 */
export async function handleLSPSession(request: Request): Promise<Response> {
  let host: string | undefined;
  try {
    const body = await request.json() as LspSessionRequest;
    host = body.host;
    const port = body.port ?? 2087;
    const timeout = body.timeout ?? 20000;
    const rootUri = body.rootUri ?? null;
    const textDocumentUri = body.textDocumentUri ?? null;
    const textDocumentContent = body.textDocumentContent ?? '';
    const language = body.language ?? 'plaintext';

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfResult = await checkIfCloudflare(host);
    if (cfResult.isCloudflare) {
      return new Response(JSON.stringify({
        success: false,
        cloudflare: true,
        error: 'Host is protected by Cloudflare -- direct TCP connection is not possible',
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    const connectTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );
    await Promise.race([socket.opened, connectTimeout]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    // Shared byte buffer passed by reference between readLSPMessage calls
    const buf: { value: Uint8Array } = { value: new Uint8Array(0) };
    const msgTimeout = Math.min(timeout, 10000);

    // 1. Send initialize
    const initializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        processId: null,
        clientInfo: { name: 'PortOfCall', version: '1.0.0' },
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
    await sendLSPMessage(writer, initializeRequest);

    // Read responses until we find the one with id=1
    let initResult: LspInitializeResult | null = null;
    while (!initResult) {
      const msg = await readLSPMessage(reader, buf, msgTimeout) as {
        id?: number;
        result?: LspInitializeResult;
        error?: { message: string };
        method?: string;
      };
      if (msg.id === 1) {
        if (msg.error) throw new Error(`Initialize error: ${msg.error.message}`);
        initResult = msg.result ?? null;
      }
      // Skip notifications (no id) that arrive before the response
    }

    // 2. Send initialized notification (JSON-RPC 2.0 requires params field)
    await sendLSPMessage(writer, {
      jsonrpc: '2.0',
      method: 'initialized',
      params: {},
    });

    // 3. Optional: textDocument/didOpen
    if (textDocumentUri) {
      await sendLSPMessage(writer, {
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: textDocumentUri,
            languageId: language,
            version: 1,
            text: textDocumentContent,
          },
        },
      });
    }

    // 4. textDocument/hover (id=2)
    const hoverTarget = textDocumentUri ?? 'file:///untitled';
    await sendLSPMessage(writer, {
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/hover',
      params: {
        textDocument: { uri: hoverTarget },
        position: { line: 0, character: 0 },
      },
    });

    // 5. textDocument/completion (id=3)
    await sendLSPMessage(writer, {
      jsonrpc: '2.0',
      id: 3,
      method: 'textDocument/completion',
      params: {
        textDocument: { uri: hoverTarget },
        position: { line: 0, character: 0 },
      },
    });

    // Collect responses for id=2 and id=3
    let hoverResult: unknown = null;
    let completionResult: unknown = null;

    while (!hoverResult || !completionResult) {
      let msg: { id?: number; result?: unknown; error?: { message: string }; method?: string };
      try {
        msg = await readLSPMessage(reader, buf, msgTimeout) as typeof msg;
      } catch {
        // Timeout waiting for hover/completion -- server may not support them
        break;
      }
      if (msg.id === 2) hoverResult = msg.result ?? null;
      if (msg.id === 3) completionResult = msg.result ?? null;
    }

    // Count completion items
    let completionItems = 0;
    if (completionResult && typeof completionResult === 'object') {
      const cr = completionResult as { items?: unknown[]; isIncomplete?: boolean } | unknown[];
      if (Array.isArray(cr)) {
        completionItems = cr.length;
      } else if ('items' in cr && Array.isArray(cr.items)) {
        completionItems = cr.items.length;
      }
    }

    // 6. shutdown (id=4) -- JSON-RPC 2.0 requires params field even for void methods
    await sendLSPMessage(writer, { jsonrpc: '2.0', id: 4, method: 'shutdown', params: null });

    // Wait for shutdown response (id=4), tolerating a timeout
    try {
      let shutdownDone = false;
      while (!shutdownDone) {
        const msg = await readLSPMessage(reader, buf, 5000) as { id?: number };
        if (msg.id === 4) shutdownDone = true;
      }
    } catch {
      // Ignore timeout on shutdown
    }

    // 7. exit notification -- JSON-RPC 2.0 requires params field for all messages
    await sendLSPMessage(writer, { jsonrpc: '2.0', method: 'exit', params: null });

    const rtt = Date.now() - start;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    const capabilities = initResult?.capabilities ?? {};
    const capabilityList = extractCapabilityList(capabilities);

    return new Response(JSON.stringify({
      success: true,
      initialized: true,
      serverInfo: initResult?.serverInfo ?? null,
      capabilities,
      capabilityList,
      hoverResult,
      completionItems,
      rtt,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'LSP session failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
