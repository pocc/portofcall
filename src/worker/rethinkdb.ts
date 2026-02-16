/**
 * RethinkDB Wire Protocol Implementation
 *
 * Implements RethinkDB connectivity testing via the ReQL wire protocol (port 28015).
 * RethinkDB uses a binary handshake where the client sends a magic number, auth key,
 * and protocol version, then the server responds with a null-terminated status string.
 *
 * Protocol Flow (V0.4 - legacy, widely supported):
 * 1. Client sends magic number 0xd3ccaa08 (4 bytes, little-endian)
 * 2. Client sends auth_key_length (4 bytes, little-endian)
 * 3. Client sends auth_key bytes (if length > 0)
 * 4. Client sends protocol type 0x7e6970c7 (JSON, 4 bytes, little-endian)
 * 5. Server responds with null-terminated ASCII string ("SUCCESS\0" or error)
 *
 * Protocol Flow (V1.0 - current, SCRAM-SHA-256):
 * 1. Client sends magic number 0x400c2d20 (4 bytes, little-endian)
 * 2. Server/client exchange JSON SCRAM authentication messages
 *
 * Use Cases:
 * - RethinkDB server detection and version probing
 * - Authentication testing with auth key
 * - Protocol version detection (V0.4 vs V1.0)
 * - Real-time database connectivity verification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// RethinkDB magic numbers (little-endian)
const MAGIC_V0_4 = 0xD3CCAA08; // V0.4 legacy handshake
const MAGIC_V1_0 = 0x400C2D20; // V1.0 SCRAM handshake
const PROTOCOL_JSON = 0x7E6970C7; // JSON query protocol

/**
 * Read a null-terminated string from the socket.
 * RethinkDB V0.x responds with a null-terminated ASCII string.
 */
async function readNullTerminatedString(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxBytes: number = 4096,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < maxBytes) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;
    chunks.push(result.value);
    total += result.value.length;

    // Check if we've received the null terminator
    const lastChunk = result.value;
    if (lastChunk.includes(0)) break;
  }

  // Combine all chunks
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Find null terminator and decode
  const nullIdx = combined.indexOf(0);
  const end = nullIdx >= 0 ? nullIdx : combined.length;
  return new TextDecoder().decode(combined.slice(0, end));
}

/**
 * Build V0.4 handshake packet:
 * [magic:4LE] [auth_key_len:4LE] [auth_key:N] [protocol:4LE]
 */
function buildV04Handshake(authKey: string): Uint8Array {
  const authBytes = new TextEncoder().encode(authKey);
  const packet = new Uint8Array(4 + 4 + authBytes.length + 4);
  const view = new DataView(packet.buffer);

  view.setUint32(0, MAGIC_V0_4, true);           // Magic (LE)
  view.setUint32(4, authBytes.length, true);       // Auth key length (LE)
  if (authBytes.length > 0) {
    packet.set(authBytes, 8);                      // Auth key
  }
  view.setUint32(8 + authBytes.length, PROTOCOL_JSON, true); // Protocol (LE)

  return packet;
}

/**
 * Parse the V1.0 JSON response from RethinkDB.
 * After receiving the V1.0 magic, the server expects a JSON message.
 * If we don't send one, it may respond with an error or close.
 * We also try sending a minimal SCRAM init.
 */
function buildV10ScramInit(): Uint8Array {
  // V1.0 expects null-terminated JSON messages after the magic.
  // Send a minimal authentication_method message to get a response.
  const msg = JSON.stringify({
    protocol_version: 0,
    authentication_method: 'SCRAM-SHA-256',
    authentication: 'n,,n=admin,r=portofcall000000000000',
  });
  const msgBytes = new TextEncoder().encode(msg + '\0');

  const packet = new Uint8Array(4 + msgBytes.length);
  const view = new DataView(packet.buffer);
  view.setUint32(0, MAGIC_V1_0, true);
  packet.set(msgBytes, 4);
  return packet;
}

/**
 * Determine protocol version from server response
 */
function detectProtocolVersion(response: string): {
  isRethinkDB: boolean;
  version: string;
  authenticated: boolean;
  message: string;
} {
  // V0.4 SUCCESS response
  if (response === 'SUCCESS') {
    return {
      isRethinkDB: true,
      version: 'V0.4 (Legacy)',
      authenticated: true,
      message: 'RethinkDB server detected. V0.4 handshake succeeded — authenticated.',
    };
  }

  // V0.4 error responses
  if (response.startsWith('ERROR:')) {
    return {
      isRethinkDB: true,
      version: 'V0.4 (Legacy)',
      authenticated: false,
      message: `RethinkDB server detected. ${response}`,
    };
  }

  // V1.0 JSON response (SCRAM flow)
  if (response.startsWith('{')) {
    try {
      const json = JSON.parse(response) as {
        success?: boolean;
        authentication?: string;
        max_protocol_version?: number;
        min_protocol_version?: number;
        error?: string;
        error_code?: number;
      };

      if (json.authentication !== undefined || json.max_protocol_version !== undefined) {
        return {
          isRethinkDB: true,
          version: 'V1.0 (SCRAM-SHA-256)',
          authenticated: false,
          message: `RethinkDB server detected. V1.0 SCRAM authentication available. Protocol versions: ${json.min_protocol_version ?? 0}-${json.max_protocol_version ?? 0}.`,
        };
      }

      if (json.error) {
        return {
          isRethinkDB: true,
          version: 'V1.0 (SCRAM-SHA-256)',
          authenticated: false,
          message: `RethinkDB server detected. ${json.error}`,
        };
      }

      if (json.success !== undefined) {
        return {
          isRethinkDB: true,
          version: 'V1.0 (SCRAM-SHA-256)',
          authenticated: json.success === true,
          message: `RethinkDB server detected. Auth ${json.success ? 'succeeded' : 'failed'}.`,
        };
      }
    } catch {
      // Not valid JSON, fall through
    }
  }

  // Check for common RethinkDB-like responses
  if (response.toLowerCase().includes('rethinkdb') || response.toLowerCase().includes('reql')) {
    return {
      isRethinkDB: true,
      version: 'Unknown',
      authenticated: false,
      message: `RethinkDB server detected. Response: ${response.substring(0, 200)}`,
    };
  }

  return {
    isRethinkDB: false,
    version: 'Unknown',
    authenticated: false,
    message: `Server responded but does not appear to be RethinkDB. Response: ${response.substring(0, 200)}`,
  };
}

/**
 * Handle RethinkDB connection test with V0.4 handshake + optional auth key
 */
export async function handleRethinkDBConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      authKey?: string;
      timeout?: number;
    };

    const { host, port = 28015, authKey = '', timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if the target is behind Cloudflare
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

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Send V0.4 handshake with auth key
    const handshakePacket = buildV04Handshake(authKey);
    await writer.write(handshakePacket);

    // Read null-terminated response
    const response = await readNullTerminatedString(reader, timeoutPromise);
    const rtt = Date.now() - startTime;

    const detection = detectProtocolVersion(response);

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      protocolVersion: 'V0.4',
      isRethinkDB: detection.isRethinkDB,
      authenticated: detection.authenticated,
      serverVersion: detection.version,
      rawResponse: response.substring(0, 500),
      message: detection.message,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle RethinkDB probe — tries V1.0 SCRAM handshake for modern detection,
 * falls back to V0.4 magic for legacy servers.
 */
export async function handleRethinkDBProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 28015, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if the target is behind Cloudflare
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

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Try V1.0 SCRAM probe first (sends magic + SCRAM init)
    const probePacket = buildV10ScramInit();
    await writer.write(probePacket);

    // Read response
    const response = await readNullTerminatedString(reader, timeoutPromise);
    const rtt = Date.now() - startTime;

    const detection = detectProtocolVersion(response);

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      isRethinkDB: detection.isRethinkDB,
      serverVersion: detection.version,
      rawResponse: response.substring(0, 500),
      message: detection.message,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
