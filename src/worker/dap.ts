/**
 * Debug Adapter Protocol (DAP) Implementation
 *
 * DAP is a JSON-based protocol used between IDEs/editors and debug adapters.
 * It provides a universal interface for debugging any language/runtime.
 *
 * Port: varies (5678 for debugpy, 4711 for netcoredbg, etc.)
 * Protocol: Length-prefixed JSON over TCP
 *
 * Message Format:
 *   Content-Length: N\r\n
 *   \r\n
 *   {json body of N bytes}
 *
 * Protocol Flow:
 * 1. Client connects to debug adapter over TCP
 * 2. Client sends `initialize` request with clientID and adapterID
 * 3. Adapter responds with `initialize` response (capabilities)
 * 4. Adapter sends `initialized` event (signals ready for configuration)
 * 5. Client sends configuration requests (setBreakpoints, configurationDone, etc.)
 * 6. Client sends `launch` or `attach` request
 * 7. Bidirectional event/request/response exchange during debug session
 *
 * Use Cases:
 * - Connect to remote debugpy (Python) sessions
 * - Connect to netcoredbg (.NET Core) debug adapters
 * - Connect to delve (Go) DAP server
 * - Inspect debug adapter capabilities
 * - Monitor debug events in real time
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface DAPRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface DAPMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
  // Present on 'request' and 'response' messages
  command?: string;
  // Present on 'response' messages — the seq of the corresponding request
  request_seq?: number;
  // Present on 'event' messages
  event?: string;
  // Present on 'response' messages — indicates success/failure
  success?: boolean;
  // Present on 'response' and 'event' messages
  body?: unknown;
  // Present on 'request' messages
  arguments?: unknown;
  // Present on 'response' messages when success is false — short error description
  message?: string;
}

/**
 * Encode a DAP message with Content-Length framing.
 * Content-Length is the byte length of the UTF-8 encoded JSON body.
 */
function encodeDAPMessage(body: unknown): Uint8Array {
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(JSON.stringify(body));
  const header = `Content-Length: ${jsonBytes.length}\r\n\r\n`;
  const headerBytes = encoder.encode(header);
  const result = new Uint8Array(headerBytes.length + jsonBytes.length);
  result.set(headerBytes);
  result.set(jsonBytes, headerBytes.length);
  return result;
}

/**
 * Parse one or more DAP messages from a byte buffer.
 *
 * Content-Length specifies the byte length of the JSON body (not character length),
 * so we must operate on raw bytes to correctly handle multi-byte UTF-8 characters.
 * Returns parsed message objects and any leftover unparsed bytes.
 */
function parseDAPMessages(buffer: Uint8Array<ArrayBuffer>): { messages: DAPMessage[]; remaining: Uint8Array<ArrayBuffer> } {
  const messages: DAPMessage[] = [];
  let offset = 0;
  const decoder = new TextDecoder();
  const HEADER_SEPARATOR = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]); // \r\n\r\n

  while (true) {
    const view = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, buffer.length - offset);
    const headerEnd = findByteSequence(view, HEADER_SEPARATOR);
    if (headerEnd === -1) break;

    const headerStr = decoder.decode(new Uint8Array(buffer.buffer, buffer.byteOffset + offset, headerEnd));
    const match = headerStr.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4; // skip \r\n\r\n

    if (view.length < bodyStart + contentLength) break;

    const bodyBytes = new Uint8Array(buffer.buffer, buffer.byteOffset + offset + bodyStart, contentLength);
    const bodyStr = decoder.decode(bodyBytes);
    try {
      messages.push(JSON.parse(bodyStr) as DAPMessage);
    } catch {
      // skip malformed message
    }

    offset += bodyStart + contentLength;
  }

  // Copy remaining bytes to a new standalone buffer
  const remaining = new Uint8Array(buffer.length - offset);
  remaining.set(new Uint8Array(buffer.buffer, buffer.byteOffset + offset, buffer.length - offset));

  return { messages, remaining };
}

/**
 * Find the index of a byte sequence within a Uint8Array.
 * Returns -1 if not found.
 */
function findByteSequence(haystack: Uint8Array<ArrayBuffer>, needle: Uint8Array<ArrayBuffer>): number {
  outer:
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Concatenate two Uint8Arrays into a new Uint8Array backed by ArrayBuffer.
 */
function concatBytes(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

/**
 * Handle DAP health check — connects and sends an initialize request.
 * Returns the adapter's capabilities from the initialize response.
 */
export async function handleDAPHealth(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await request.json() as DAPRequest;
    const { host, port = 5678, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();

    const initRequest: DAPMessage = {
      seq: 1,
      type: 'request',
      command: 'initialize',
      arguments: {
        clientID: 'portofcall',
        clientName: 'Port of Call',
        adapterID: 'probe',
        locale: 'en-US',
        linesStartAt1: true,
        columnsStartAt1: true,
        pathFormat: 'path',
        supportsVariableType: true,
        supportsVariablePaging: false,
        supportsRunInTerminalRequest: false,
        supportsMemoryReferences: false,
      },
    };

    await writer.write(encodeDAPMessage(initRequest));
    writer.releaseLock();

    const reader = socket.readable.getReader();
    let rawBuffer = new Uint8Array(0);
    const collectedMessages: DAPMessage[] = [];
    const readDeadline = Date.now() + timeout;

    // Read until we get an initialize response or timeout
    while (Date.now() < readDeadline && collectedMessages.length < 3) {
      const remaining = readDeadline - Date.now();
      if (remaining <= 0) break;

      const readPromise = reader.read();
      const timeoutRead = new Promise<{ value: undefined; done: true }>((resolve) => {
        setTimeout(() => resolve({ value: undefined, done: true }), Math.min(remaining, 2000));
      });

      const { value, done } = await Promise.race([readPromise, timeoutRead]);
      if (done) break;
      if (value) {
        rawBuffer = concatBytes(rawBuffer, value);
        const parsed = parseDAPMessages(rawBuffer);
        collectedMessages.push(...parsed.messages);
        rawBuffer = parsed.remaining;
      }

      // Stop once we have the initialize response
      if (collectedMessages.some(m => m.type === 'response' && m.command === 'initialize')) {
        break;
      }
    }

    reader.releaseLock();
    socket.close().catch(() => {});

    const latencyMs = Date.now() - start;
    const initResponse = collectedMessages.find(m => m.type === 'response' && m.command === 'initialize');
    const events = collectedMessages.filter(m => m.type === 'event');

    const success = initResponse !== undefined;

    return new Response(JSON.stringify({
      success,
      latencyMs,
      parsed: {
        capabilities: initResponse?.body ?? null,
        events: events.map(e => e.event),
        messageCount: collectedMessages.length,
        allMessages: collectedMessages,
      },
      error: success ? undefined : 'No initialize response received from adapter',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
      latencyMs: Date.now() - start,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Create a WebSocket tunnel to a DAP server.
 *
 * The browser client sends DAP message bodies as JSON strings (without framing).
 * The worker adds Content-Length framing before forwarding to the TCP socket.
 * Incoming TCP data is parsed, framing is stripped, and JSON bodies are sent to the browser.
 */
export async function handleDAPTunnel(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const host = url.searchParams.get('host');
  const port = url.searchParams.get('port') || '5678';

  if (!host) {
    return new Response('Host parameter is required', { status: 400 });
  }

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(getCloudflareErrorMessage(host, cfCheck.ip), { status: 403 });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  (async () => {
    let dapSocket: Socket | null = null;

    try {
      dapSocket = connect(`${host}:${port}`);
      await dapSocket.opened;

      server.send(JSON.stringify({
        type: 'connected',
        message: `DAP tunnel connected to ${host}:${port}`,
      }));

      const wsDecoder = new TextDecoder();
      let rawBuffer = new Uint8Array(0);

      // Browser -> DAP: add Content-Length framing
      server.addEventListener('message', async (event) => {
        try {
          const msg = event.data;
          let jsonStr: string;
          if (typeof msg === 'string') {
            jsonStr = msg;
          } else if (msg instanceof ArrayBuffer) {
            jsonStr = wsDecoder.decode(msg);
          } else {
            return;
          }

          // Parse to validate JSON and re-encode for framing
          const parsed = JSON.parse(jsonStr);
          const framed = encodeDAPMessage(parsed);
          const writer = dapSocket!.writable.getWriter();
          await writer.write(framed);
          writer.releaseLock();
        } catch (err) {
          server.send(JSON.stringify({
            type: 'error',
            error: `Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
          }));
        }
      });

      // DAP -> Browser: strip Content-Length framing
      // Acquire the reader once before the loop to avoid re-locking the stream
      (async () => {
        const reader = dapSocket!.readable.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();

            if (done) break;
            if (!value) continue;

            rawBuffer = concatBytes(rawBuffer, value);
            const { messages, remaining } = parseDAPMessages(rawBuffer);
            rawBuffer = remaining;

            for (const msg of messages) {
              server.send(JSON.stringify(msg));
            }
          }
        } catch {
          server.close(1011, 'DAP read error');
        } finally {
          reader.releaseLock();
        }
      })();

      server.addEventListener('close', () => {
        if (dapSocket) {
          dapSocket.close().catch(() => {});
        }
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'DAP tunnel failed';
      server.send(JSON.stringify({ type: 'error', error: errorMessage }));
      server.close(1011, errorMessage);
      if (dapSocket) {
        dapSocket.close().catch(() => {});
      }
    }
  })();

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
