/**
 * ZMTP Protocol Implementation (ZeroMQ Message Transport Protocol)
 *
 * ZMTP is the wire protocol used by ZeroMQ for peer-to-peer messaging.
 * It handles connection setup, security mechanism negotiation, and
 * metadata exchange between ZeroMQ sockets.
 *
 * Protocol: Binary with defined greeting and handshake phases
 * Default port: 5555 (commonly used, not officially assigned)
 *
 * ZMTP 3.1 Greeting (64 bytes):
 *   Bytes 0-9:   Signature (0xff + 8 padding bytes + 0x7f)
 *   Byte 10:     Major version (3)
 *   Byte 11:     Minor version (1)
 *   Bytes 12-31: Mechanism (20 bytes, null-padded: "NULL", "PLAIN", "CURVE")
 *   Byte 32:     as-server flag (0 or 1)
 *   Bytes 33-63: Filler (31 zero bytes)
 *
 * After greeting, peers exchange READY commands with metadata:
 *   - Socket-Type: REQ, REP, DEALER, ROUTER, PUB, SUB, etc.
 *   - Identity: Socket identity string
 *
 * Security: Read-only probing. We send a NULL mechanism greeting
 * and parse the server's response to detect ZeroMQ version and type.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Build a ZMTP 3.1 greeting with NULL mechanism
 * Total: 64 bytes
 */
function buildZMTPGreeting(): Uint8Array {
  const greeting = new Uint8Array(64);

  // Signature: 0xff + 8 bytes padding + 0x7f
  greeting[0] = 0xff;
  // bytes 1-8 are zero (padding)
  greeting[9] = 0x7f;

  // Version: 3.1
  greeting[10] = 3; // major
  greeting[11] = 1; // minor

  // Mechanism: "NULL" (20 bytes, null-padded)
  const mechanism = new TextEncoder().encode('NULL');
  greeting.set(mechanism, 12);
  // bytes 16-31 are zero (null padding for mechanism)

  // as-server: 0 (we are a client)
  greeting[32] = 0;

  // bytes 33-63 are zero (filler)
  return greeting;
}

/**
 * Parse a ZMTP greeting response
 */
function parseZMTPGreeting(data: Uint8Array): {
  valid: boolean;
  majorVersion: number;
  minorVersion: number;
  mechanism: string;
  asServer: boolean;
  signatureValid: boolean;
} {
  if (data.length < 64) {
    // Partial greeting - try to parse what we have
    if (data.length >= 12) {
      return {
        valid: false,
        majorVersion: data[10],
        minorVersion: data[11],
        mechanism: 'unknown',
        asServer: false,
        signatureValid: data[0] === 0xff && data[9] === 0x7f,
      };
    }
    return {
      valid: false,
      majorVersion: 0,
      minorVersion: 0,
      mechanism: 'unknown',
      asServer: false,
      signatureValid: false,
    };
  }

  // Check signature
  const signatureValid = data[0] === 0xff && data[9] === 0x7f;

  // Version
  const majorVersion = data[10];
  const minorVersion = data[11];

  // Mechanism (20 bytes at offset 12, null-terminated)
  const mechBytes = data.slice(12, 32);
  const nullIdx = mechBytes.indexOf(0);
  const mechanism = new TextDecoder().decode(
    nullIdx >= 0 ? mechBytes.slice(0, nullIdx) : mechBytes
  );

  // as-server flag
  const asServer = data[32] === 1;

  return {
    valid: signatureValid && majorVersion >= 3,
    majorVersion,
    minorVersion,
    mechanism,
    asServer,
    signatureValid,
  };
}

/**
 * Encode a ZMTP command frame (short or long).
 *
 * Command frame wire format (ZMTP 3.1 §6):
 *   Short (body <= 255):
 *     0x04          flags byte (command, short)
 *     <1 byte>      body length
 *     <body>
 *   Long (body > 255):
 *     0x06          flags byte (command, long)
 *     <8 bytes BE>  body length
 *     <body>
 *
 * Command body layout:
 *   <1 byte>   command-name length
 *   <N bytes>  command-name (ASCII, e.g. "READY")
 *   <metadata pairs...>
 *
 * Metadata property format (ZMTP 3.1 §6.1):
 *   <1 byte>     property-name length  (1 byte, NOT 4)
 *   <N bytes>    property-name
 *   <4 bytes BE> property-value length
 *   <M bytes>    property-value
 */
function encodeCommandFrame(commandName: string, properties: Array<[string, string]>): Uint8Array {
  const enc = new TextEncoder();
  const cmdNameBytes = enc.encode(commandName);

  // Body = 1-byte cmd-name-len + cmd-name + property pairs
  let bodyLen = 1 + cmdNameBytes.length;
  const propParts: Array<{ keyBytes: Uint8Array; valBytes: Uint8Array }> = [];
  for (const [key, val] of properties) {
    const keyBytes = enc.encode(key);
    const valBytes = enc.encode(val);
    // 1-byte name-length + name + 4-byte value-length + value
    bodyLen += 1 + keyBytes.length + 4 + valBytes.length;
    propParts.push({ keyBytes, valBytes });
  }

  const isLong = bodyLen > 255;
  const headerLen = isLong ? 9 : 2; // 1 flag + (8 or 1) size bytes
  const frame = new Uint8Array(headerLen + bodyLen);
  let off = 0;

  // 0x04 = command short, 0x06 = command long
  frame[off++] = isLong ? 0x06 : 0x04;
  if (isLong) {
    new DataView(frame.buffer).setBigUint64(off, BigInt(bodyLen), false);
    off += 8;
  } else {
    frame[off++] = bodyLen;
  }

  // Command-name-length (1 byte) + command-name
  frame[off++] = cmdNameBytes.length;
  frame.set(cmdNameBytes, off);
  off += cmdNameBytes.length;

  // Metadata properties: 1-byte name-len + name + 4-byte value-len + value
  for (const { keyBytes, valBytes } of propParts) {
    frame[off++] = keyBytes.length;
    frame.set(keyBytes, off); off += keyBytes.length;
    frame[off++] = (valBytes.length >>> 24) & 0xff;
    frame[off++] = (valBytes.length >>> 16) & 0xff;
    frame[off++] = (valBytes.length >>> 8) & 0xff;
    frame[off++] = valBytes.length & 0xff;
    frame.set(valBytes, off); off += valBytes.length;
  }

  return frame;
}

/**
 * Build a ZMTP READY command with NULL mechanism
 */
function buildReadyCommand(socketType: string): Uint8Array {
  return encodeCommandFrame('READY', [['Socket-Type', socketType]]);
}

/**
 * Parse metadata from a ZMTP command body (after the command-name field).
 *
 * Metadata format per ZMTP 3.1 §6.1:
 *   <1 byte>     property-name length
 *   <N bytes>    property-name
 *   <4 bytes BE> property-value length (unsigned)
 *   <M bytes>    property-value
 */
function parseMetadata(data: Uint8Array, startOffset: number): Record<string, string> {
  const metadata: Record<string, string> = {};
  let offset = startOffset;

  while (offset < data.length) {
    // 1-byte property-name length
    const keyLen = data[offset++];
    if (keyLen === 0 || offset + keyLen > data.length) break;

    const key = new TextDecoder().decode(data.slice(offset, offset + keyLen));
    offset += keyLen;

    // 4-byte property-value length (big-endian, unsigned)
    // Use DataView.getUint32 to avoid the signed-integer hazard of (byte << 24)
    if (offset + 4 > data.length) break;
    const valLen = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, false);
    offset += 4;

    if (offset + valLen > data.length) break;
    const val = new TextDecoder().decode(data.slice(offset, offset + valLen));
    offset += valLen;

    metadata[key] = val;
  }

  return metadata;
}

/**
 * Read TCP response data with timeout
 */
async function readResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  expectedBytes: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxBytes = 64 * 1024;
  const deadline = Date.now() + timeoutMs;

  while (totalBytes < expectedBytes) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) => {
      setTimeout(() => resolve({ done: true, value: undefined }), Math.min(remaining, 3000));
    });

    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;

    chunks.push(result.value);
    totalBytes += result.value.length;
    if (totalBytes >= maxBytes) break;
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

/**
 * Format bytes as hex string
 */
function toHex(data: Uint8Array, maxBytes = 64): string {
  const slice = data.slice(0, maxBytes);
  return Array.from(slice)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

/**
 * Probe a ZeroMQ endpoint by performing a ZMTP greeting handshake
 */
export async function handleZMTPProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 5555;
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send ZMTP 3.1 greeting (64 bytes)
      const greeting = buildZMTPGreeting();
      await writer.write(greeting);

      // Read server greeting (64 bytes)
      const responseData = await readResponse(reader, Math.min(timeout, 5000), 64);
      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (responseData.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            host,
            port,
            rtt,
            isZMTP: false,
            protocol: 'ZMTP',
            message: `TCP connected but no ZMTP greeting received (${rtt}ms)`,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      const parsed = parseZMTPGreeting(responseData);

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          isZMTP: parsed.signatureValid,
          signatureValid: parsed.signatureValid,
          version: parsed.valid ? `${parsed.majorVersion}.${parsed.minorVersion}` : null,
          majorVersion: parsed.majorVersion,
          minorVersion: parsed.minorVersion,
          mechanism: parsed.mechanism,
          asServer: parsed.asServer,
          greetingBytes: responseData.length,
          greetingHex: toHex(responseData),
          protocol: 'ZMTP',
          message: parsed.signatureValid
            ? `ZeroMQ ZMTP ${parsed.majorVersion}.${parsed.minorVersion} detected (${parsed.mechanism} mechanism) in ${rtt}ms`
            : `Non-ZMTP response received in ${rtt}ms`,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'ZMTP connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/** Build a ZMTP message frame (short or long) */
function buildMessageFrame(data: Uint8Array, more = false): Uint8Array {
  if (data.length > 255) {
    // Long frame: flags|0x02 + 8-byte BE length
    const frame = new Uint8Array(1 + 8 + data.length);
    frame[0] = (more ? 0x01 : 0x00) | 0x02;
    const view = new DataView(frame.buffer);
    view.setBigUint64(1, BigInt(data.length), false);
    frame.set(data, 9);
    return frame;
  }
  const frame = new Uint8Array(2 + data.length);
  frame[0] = more ? 0x01 : 0x00;
  frame[1] = data.length;
  frame.set(data, 2);
  return frame;
}

/**
 * Build a ZMTP SUBSCRIBE command frame for SUB sockets.
 *
 * The SUBSCRIBE command body is: cmd-name-len + "SUBSCRIBE" + topic-bytes.
 * The topic is a raw byte prefix filter (empty string subscribes to all).
 * Handles long frames (body > 255 bytes) correctly.
 */
function buildSubscribeCommand(topic: string): Uint8Array {
  const enc = new TextEncoder();
  const cmdName = enc.encode('SUBSCRIBE');
  const topicBytes = enc.encode(topic);
  // Body = 1-byte cmd-name-len + cmd-name + topic (no metadata encoding)
  const bodyLen = 1 + cmdName.length + topicBytes.length;
  const isLong = bodyLen > 255;
  const headerLen = isLong ? 9 : 2;
  const frame = new Uint8Array(headerLen + bodyLen);
  let off = 0;
  frame[off++] = isLong ? 0x06 : 0x04; // command flag
  if (isLong) {
    new DataView(frame.buffer).setBigUint64(off, BigInt(bodyLen), false);
    off += 8;
  } else {
    frame[off++] = bodyLen;
  }
  frame[off++] = cmdName.length;
  frame.set(cmdName, off); off += cmdName.length;
  frame.set(topicBytes, off);
  return frame;
}

/**
 * Parse a single ZMTP frame from a buffer at the given offset.
 * Handles both short (1-byte size) and long (8-byte size) frames.
 * Uses data.byteOffset for correct DataView positioning when the
 * Uint8Array is a view into a larger ArrayBuffer.
 *
 * Returns null if there are not enough bytes to parse a complete frame.
 */
function parseFrame(data: Uint8Array, offset: number): {
  isCommand: boolean;
  more: boolean;
  payload: Uint8Array;
  bytesConsumed: number;
} | null {
  if (offset >= data.length) return null;
  const flags = data[offset];
  const isLong = (flags & 0x02) !== 0;
  const isCommand = (flags & 0x04) !== 0;
  const more = (flags & 0x01) !== 0;

  let payloadLen: number;
  let headerSize: number;

  if (isLong) {
    if (offset + 9 > data.length) return null;
    payloadLen = Number(
      new DataView(data.buffer, data.byteOffset + offset + 1, 8).getBigUint64(0, false)
    );
    headerSize = 9;
  } else {
    if (offset + 2 > data.length) return null;
    payloadLen = data[offset + 1];
    headerSize = 2;
  }

  if (offset + headerSize + payloadLen > data.length) return null;
  const payload = data.slice(offset + headerSize, offset + headerSize + payloadLen);
  return { isCommand, more, payload, bytesConsumed: headerSize + payloadLen };
}

/**
 * Send a message to a ZMTP endpoint after completing the handshake
 * POST /api/zmtp/send
 */
export async function handleZMTPSend(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      host?: string; port?: number; socketType?: string; topic?: string;
      message?: string; timeout?: number;
    };
    if (!body.host) return new Response(JSON.stringify({ success: false, error: 'Host is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } });
    const { host, port = 5555, socketType = 'PUSH', topic = '', message = '', timeout = 10000 } = body;
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout));
    await Promise.race([socket.opened, timeoutPromise]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    try {
      // Greeting
      await writer.write(buildZMTPGreeting());
      await readResponse(reader, 3000, 64);
      // READY
      await writer.write(buildReadyCommand(socketType.toUpperCase()));
      await readResponse(reader, 3000, 256);
      const enc = new TextEncoder();
      const upperType = socketType.toUpperCase();
      // REQ sockets require an empty delimiter frame before the message body
      // per the ZMTP REQ/REP envelope convention (ZMTP 3.1 §2.2)
      if (upperType === 'REQ') {
        await writer.write(new Uint8Array([0x00, 0x00])); // empty delimiter frame
      }
      // Send message (with topic prefix for PUB)
      if (upperType === 'PUB' && topic) {
        await writer.write(buildMessageFrame(enc.encode(topic), true));
      }
      await writer.write(buildMessageFrame(enc.encode(message)));
      // For REQ/DEALER, wait for reply
      let reply: string | null = null;
      if (['REQ', 'DEALER'].includes(upperType)) {
        const replyData = await readResponse(reader, Math.min(timeout, 3000), 65536);
        // Parse reply frames properly using parseFrame (handles long frames)
        let off = 0;
        const parts: string[] = [];
        while (off < replyData.length) {
          const parsed = parseFrame(replyData, off);
          if (!parsed) break;
          if (!parsed.isCommand && parsed.payload.length > 0) {
            parts.push(new TextDecoder().decode(parsed.payload));
          }
          off += parsed.bytesConsumed;
        }
        reply = parts.length > 0 ? parts.join('') : null;
      }
      writer.releaseLock(); reader.releaseLock(); socket.close();
      return new Response(JSON.stringify({ success: true, host, port, socketType, messageSent: message, reply }),
        { headers: { 'Content-Type': 'application/json' } });
    } catch (e) { writer.releaseLock(); reader.releaseLock(); socket.close(); throw e; }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Subscribe and receive messages from a ZMTP endpoint
 * POST /api/zmtp/recv
 */
export async function handleZMTPRecv(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      host?: string; port?: number; socketType?: string; topic?: string; timeoutMs?: number;
    };
    if (!body.host) return new Response(JSON.stringify({ success: false, error: 'Host is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } });
    const { host, port = 5555, socketType = 'SUB', topic = '', timeoutMs = 2000 } = body;
    const socket = connect(`${host}:${port}`);
    const connTimeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connect timeout')), 10000));
    await Promise.race([socket.opened, connTimeout]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    try {
      await writer.write(buildZMTPGreeting());
      await readResponse(reader, 3000, 64);
      await writer.write(buildReadyCommand(socketType.toUpperCase()));
      await readResponse(reader, 3000, 256);
      if (socketType.toUpperCase() === 'SUB') {
        await writer.write(buildSubscribeCommand(topic));
      }
      // Collect messages for timeoutMs
      const messages: string[] = [];
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const chunk = await readResponse(reader, remaining, 65536);
        if (chunk.length === 0) break;
        // Parse frames using parseFrame (handles long frames and byteOffset correctly)
        let off = 0;
        while (off < chunk.length) {
          const frame = parseFrame(chunk, off);
          if (!frame) break;
          if (!frame.isCommand && frame.payload.length > 0) {
            messages.push(new TextDecoder().decode(frame.payload));
          }
          off += frame.bytesConsumed;
        }
      }
      writer.releaseLock(); reader.releaseLock(); socket.close();
      return new Response(JSON.stringify({ success: true, host, port, socketType, topic, messages, count: messages.length }),
        { headers: { 'Content-Type': 'application/json' } });
    } catch (e) { writer.releaseLock(); reader.releaseLock(); socket.close(); throw e; }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Perform a full ZMTP handshake including READY command exchange
 */
export async function handleZMTPHandshake(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      socketType?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 5555;
    const socketType = body.socketType || 'DEALER';
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate socket type
    const validTypes = ['REQ', 'REP', 'DEALER', 'ROUTER', 'PUB', 'SUB', 'XPUB', 'XSUB', 'PUSH', 'PULL', 'PAIR'];
    if (!validTypes.includes(socketType.toUpperCase())) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid socket type "${socketType}". Valid types: ${validTypes.join(', ')}`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: Send greeting
      const greeting = buildZMTPGreeting();
      await writer.write(greeting);

      // Step 2: Read server greeting
      const greetingResponse = await readResponse(reader, Math.min(timeout, 3000), 64);
      const greetingParsed = parseZMTPGreeting(greetingResponse);

      if (!greetingParsed.signatureValid) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return new Response(
          JSON.stringify({
            success: false,
            error: 'Not a ZMTP endpoint (invalid greeting signature)',
            greetingHex: toHex(greetingResponse),
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Step 3: Send READY command (for NULL mechanism, READY comes directly after greeting)
      const readyCmd = buildReadyCommand(socketType.toUpperCase());
      await writer.write(readyCmd);

      // Step 4: Read server's command response
      const cmdResponse = await readResponse(reader, Math.min(timeout, 3000), 256);
      const rtt = Date.now() - startTime;

      // Parse command response using parseFrame (handles both short and long frames)
      let serverSocketType: string | null = null;
      let serverIdentity: string | null = null;
      let commandName: string | null = null;
      const peerMetadata: Record<string, string> = {};

      if (cmdResponse.length >= 2) {
        const frame = parseFrame(cmdResponse, 0);
        if (frame && frame.isCommand && frame.payload.length >= 1) {
          const nameLen = frame.payload[0];
          if (nameLen > 0 && frame.payload.length >= 1 + nameLen) {
            commandName = new TextDecoder().decode(frame.payload.slice(1, 1 + nameLen));
            // Parse metadata after the command name
            const meta = parseMetadata(frame.payload, 1 + nameLen);
            Object.assign(peerMetadata, meta);
            serverSocketType = meta['Socket-Type'] || null;
            serverIdentity = meta['Identity'] || null;
          }
        }
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          isZMTP: true,
          version: `${greetingParsed.majorVersion}.${greetingParsed.minorVersion}`,
          mechanism: greetingParsed.mechanism,
          asServer: greetingParsed.asServer,
          handshakeComplete: commandName === 'READY',
          serverCommand: commandName,
          serverSocketType,
          serverIdentity,
          clientSocketType: socketType.toUpperCase(),
          peerMetadata,
          greetingHex: toHex(greetingResponse),
          commandHex: toHex(cmdResponse),
          protocol: 'ZMTP',
          message: commandName === 'READY'
            ? `ZMTP handshake complete: ${greetingParsed.mechanism} / ${serverSocketType || 'unknown'} socket in ${rtt}ms`
            : `ZMTP greeting OK (${greetingParsed.mechanism}) but handshake incomplete in ${rtt}ms`,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'ZMTP handshake failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
