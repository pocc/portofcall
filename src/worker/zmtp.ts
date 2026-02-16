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
 * Build a ZMTP READY command with NULL mechanism
 * Command frame format:
 *   flag byte (0x04 = command, short)
 *   size byte (length of body)
 *   body:
 *     command-name-length (1 byte)
 *     command-name ("READY")
 *     metadata key-value pairs:
 *       key-length (4 bytes BE)
 *       key string
 *       value-length (4 bytes BE)
 *       value string
 */
function buildReadyCommand(socketType: string): Uint8Array {
  const commandName = new TextEncoder().encode('READY');
  const socketTypeKey = new TextEncoder().encode('Socket-Type');
  const socketTypeVal = new TextEncoder().encode(socketType);

  // Calculate body length
  const bodyLength =
    1 + commandName.length + // command name length + name
    4 + socketTypeKey.length + // key length + key
    4 + socketTypeVal.length; // value length + value

  const frame = new Uint8Array(2 + bodyLength);
  let offset = 0;

  // Flag: 0x04 = command, short frame
  frame[offset++] = 0x04;
  // Size
  frame[offset++] = bodyLength;
  // Command name length
  frame[offset++] = commandName.length;
  // Command name
  frame.set(commandName, offset);
  offset += commandName.length;

  // Metadata: Socket-Type
  frame[offset++] = (socketTypeKey.length >> 24) & 0xff;
  frame[offset++] = (socketTypeKey.length >> 16) & 0xff;
  frame[offset++] = (socketTypeKey.length >> 8) & 0xff;
  frame[offset++] = socketTypeKey.length & 0xff;
  frame.set(socketTypeKey, offset);
  offset += socketTypeKey.length;

  frame[offset++] = (socketTypeVal.length >> 24) & 0xff;
  frame[offset++] = (socketTypeVal.length >> 16) & 0xff;
  frame[offset++] = (socketTypeVal.length >> 8) & 0xff;
  frame[offset++] = socketTypeVal.length & 0xff;
  frame.set(socketTypeVal, offset);

  return frame;
}

/**
 * Parse metadata from a READY command body
 */
function parseMetadata(data: Uint8Array, startOffset: number): Record<string, string> {
  const metadata: Record<string, string> = {};
  let offset = startOffset;

  while (offset < data.length - 4) {
    // Try to read key length (4 bytes BE) - but ZMTP uses 1-byte key length
    // Actually ZMTP metadata uses: name-length (1 byte) + name + value-length (4 bytes BE) + value
    if (offset >= data.length) break;

    const keyLen = data[offset++];
    if (keyLen === 0 || offset + keyLen > data.length) break;

    const key = new TextDecoder().decode(data.slice(offset, offset + keyLen));
    offset += keyLen;

    if (offset + 4 > data.length) break;
    const valLen =
      (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
    offset += 4;

    if (valLen < 0 || offset + valLen > data.length) break;
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

      // Parse command response
      let serverSocketType: string | null = null;
      let serverIdentity: string | null = null;
      let commandName: string | null = null;
      const peerMetadata: Record<string, string> = {};

      if (cmdResponse.length > 2) {
        const flag = cmdResponse[0];
        const isCommand = (flag & 0x04) !== 0;
        if (isCommand && cmdResponse.length > 2) {
          const size = cmdResponse[1];
          if (size > 0 && cmdResponse.length > 2 + 1) {
            const nameLen = cmdResponse[2];
            if (nameLen > 0 && cmdResponse.length >= 3 + nameLen) {
              commandName = new TextDecoder().decode(cmdResponse.slice(3, 3 + nameLen));

              // Parse metadata after command name
              const metaStart = 3 + nameLen;
              if (metaStart < cmdResponse.length) {
                const meta = parseMetadata(cmdResponse.slice(2, 2 + size), 1 + nameLen);
                Object.assign(peerMetadata, meta);
                serverSocketType = meta['Socket-Type'] || null;
                serverIdentity = meta['Identity'] || null;
              }
            }
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
