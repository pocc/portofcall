/**
 * Firebird SQL Database Protocol Handler (Port 3050)
 *
 * Firebird uses a custom binary wire protocol for client-server communication.
 * The protocol uses big-endian encoding and structured packet format.
 *
 * Wire Protocol:
 * - Client sends op_connect (opcode 1) with database path, protocol version, architecture
 * - Server responds with op_accept (opcode 2), op_reject (opcode 3), or op_response (opcode 9 for error)
 * - Opcodes are 32-bit big-endian integers
 * - Strings are length-prefixed (32-bit length + data + null terminator + padding to 4-byte boundary)
 *
 * Default Port: 3050
 * References:
 * - Firebird source: src/remote/protocol.h
 * - https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref40/firebird-40-language-reference.html
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Firebird wire protocol opcodes
const OP_CONNECT = 1;
const OP_ACCEPT = 2;
const OP_REJECT = 3;
const OP_RESPONSE = 9;

// Protocol versions
const PROTOCOL_VERSION13 = 13; // Modern Firebird 3.0+
const ARCHITECTURE_GENERIC = 1; // Generic client

interface FirebirdProbeResult {
  success: boolean;
  version?: string;
  protocol?: number;
  architecture?: number;
  accepted?: boolean;
  error?: string;
  rawOpcode?: number;
}

/**
 * Build a Firebird op_connect packet
 */
function buildConnectPacket(database: string): Uint8Array {
  const encoder = new TextEncoder();
  const parts: number[] = [];

  // Helper to write 32-bit big-endian integer
  const writeU32BE = (value: number) => {
    parts.push((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
  };

  // Helper to write counted string (length + data + null + padding)
  const writeCString = (str: string) => {
    const bytes = encoder.encode(str);
    const len = bytes.length + 1; // Include null terminator
    writeU32BE(len);
    parts.push(...bytes, 0); // Add null terminator
    // Pad to 4-byte boundary
    const padding = (4 - (len % 4)) % 4;
    for (let i = 0; i < padding; i++) parts.push(0);
  };

  // Opcode: op_connect
  writeU32BE(OP_CONNECT);

  // Operation: attach database (0)
  writeU32BE(0);

  // Connection string (database path)
  writeCString(database || '/tmp/test.fdb');

  // Protocol version count (1)
  writeU32BE(1);

  // User identification buffer length
  writeU32BE(0);

  // Protocol version string
  const versionStr = `P${PROTOCOL_VERSION13}\0\0\0`;
  parts.push(...encoder.encode(versionStr));

  // Architecture (generic = 1)
  writeU32BE(ARCHITECTURE_GENERIC);

  // Client name
  writeCString('Cloudflare Workers');

  // User name (empty - just probing)
  writeCString('');

  // Password (empty)
  writeCString('');

  // Additional parameters (empty)
  writeU32BE(0);

  return new Uint8Array(parts);
}

/**
 * Parse Firebird server response
 */
function parseServerResponse(data: Uint8Array): FirebirdProbeResult {
  if (data.length < 4) {
    return {
      success: false,
      error: `Response too short: ${data.length} bytes`,
    };
  }

  // Read opcode (32-bit big-endian)
  const opcode =
    (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];

  const result: FirebirdProbeResult = {
    success: false,
    rawOpcode: opcode,
  };

  if (opcode === OP_ACCEPT) {
    // op_accept response
    result.success = true;
    result.accepted = true;

    if (data.length >= 16) {
      // Protocol version (bytes 4-7)
      const protocol =
        (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
      result.protocol = protocol;

      // Architecture (bytes 8-11)
      const architecture =
        (data[8] << 24) | (data[9] << 16) | (data[10] << 8) | data[11];
      result.architecture = architecture;

      // Protocol type (bytes 12-15)
      const protocolType =
        (data[12] << 24) | (data[13] << 16) | (data[14] << 8) | data[15];

      result.version = `Firebird (Protocol ${protocol}, Arch ${architecture}, Type ${protocolType})`;
    } else {
      result.version = 'Firebird (version details incomplete)';
    }
  } else if (opcode === OP_REJECT) {
    result.error = 'Connection rejected (protocol version mismatch or unsupported client)';
  } else if (opcode === OP_RESPONSE) {
    result.error = 'Server returned error response (authentication or database issue)';
  } else {
    result.error = `Unknown opcode: ${opcode} (0x${opcode.toString(16)})`;
  }

  return result;
}

/**
 * Read response from socket with timeout
 */
async function readResponse(
  socket: Socket,
  timeoutMs: number = 5000
): Promise<Uint8Array> {
  const reader = socket.readable.getReader();
  const chunks: Uint8Array[] = [];

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
  );

  try {
    const readPromise = (async () => {
      const { value, done } = await reader.read();
      if (done || !value) {
        throw new Error('Connection closed before receiving data');
      }
      chunks.push(value);
      return value;
    })();

    await Promise.race([readPromise, timeoutPromise]);
  } finally {
    reader.releaseLock();
  }

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Convert Uint8Array to hex string for debugging
 */
function toHex(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

/**
 * Handle Firebird probe - send op_connect and parse response
 */
export async function handleFirebirdProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { host, port = 3050, database = '/tmp/test.fdb' } = await request.json<{
      host: string;
      port?: number;
      database?: string;
    }>();

    // Validation
    if (!host || typeof host !== 'string' || host.trim() === '') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Host is required',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (typeof port !== 'number' || port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Port must be between 1 and 65535',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Check if target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Connect to Firebird server
    const socket = connect({
      hostname: host,
      port: port,
    });

    const writer = socket.writable.getWriter();

    // Send op_connect packet
    const connectPacket = buildConnectPacket(database);
    await writer.write(connectPacket);

    // Read server response
    const response = await readResponse(socket, 8000);

    // Close connection
    await writer.close();
    await socket.close();

    // Parse response
    const result = parseServerResponse(response);

    return new Response(
      JSON.stringify({
        success: result.success,
        version: result.version,
        protocol: result.protocol,
        architecture: result.architecture,
        accepted: result.accepted,
        error: result.error,
        rawOpcode: result.rawOpcode,
        responseHex: toHex(response.slice(0, Math.min(64, response.length))),
        responseLength: response.length,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Firebird probe failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Handle Firebird version query (alias for probe)
 */
export async function handleFirebirdVersion(request: Request): Promise<Response> {
  return handleFirebirdProbe(request);
}
