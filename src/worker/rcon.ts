/**
 * Minecraft RCON (Source RCON) Protocol Implementation
 *
 * RCON is a binary protocol originally from Valve's Source engine,
 * adopted by Minecraft for remote server administration.
 *
 * Protocol Flow:
 * 1. Client connects to server (default port 25575)
 * 2. Client sends SERVERDATA_AUTH packet with password
 * 3. Server responds with empty RESPONSE_VALUE then AUTH_RESPONSE
 * 4. Client sends SERVERDATA_EXECCOMMAND packets
 * 5. Server responds with SERVERDATA_RESPONSE_VALUE
 *
 * Packet Structure (little-endian):
 *   [Size:int32][RequestID:int32][Type:int32][Body:string\0][\0]
 *
 * Packet Types:
 *   3 = SERVERDATA_AUTH (client → server)
 *   2 = SERVERDATA_AUTH_RESPONSE / SERVERDATA_EXECCOMMAND
 *   0 = SERVERDATA_RESPONSE_VALUE
 */

import { connect } from 'cloudflare:sockets';

// RCON packet types
const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

interface RCONConnectRequest {
  host: string;
  port?: number;
  password: string;
  timeout?: number;
}

interface RCONCommandRequest {
  host: string;
  port?: number;
  password: string;
  command: string;
  timeout?: number;
}

interface RCONResponse {
  success: boolean;
  authenticated?: boolean;
  response?: string;
  serverInfo?: string;
  error?: string;
}

/**
 * Build an RCON packet
 *
 * Format: [Size:int32LE][ID:int32LE][Type:int32LE][Body:string\0][\0]
 * Size = ID(4) + Type(4) + Body(n) + Null(1) + Null(1) = n + 10
 */
function buildRCONPacket(requestId: number, type: number, body: string): Uint8Array {
  const encoder = new TextEncoder();
  const bodyBytes = encoder.encode(body);

  // Size field = 4 (id) + 4 (type) + bodyLen + 1 (null terminator) + 1 (pad null)
  const size = 4 + 4 + bodyBytes.length + 2;
  const totalLength = 4 + size; // 4 bytes for the size field itself

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  const array = new Uint8Array(buffer);

  // Size (little-endian int32)
  view.setInt32(0, size, true);
  // Request ID (little-endian int32)
  view.setInt32(4, requestId, true);
  // Type (little-endian int32)
  view.setInt32(8, type, true);
  // Body
  array.set(bodyBytes, 12);
  // Two null terminators (body terminator + packet pad)
  array[12 + bodyBytes.length] = 0;
  array[12 + bodyBytes.length + 1] = 0;

  return array;
}

/**
 * Parse an RCON packet from a buffer
 */
function parseRCONPacket(data: Uint8Array): { id: number; type: number; body: string; bytesConsumed: number } | null {
  if (data.length < 14) return null; // Minimum packet: 4 (size) + 4 (id) + 4 (type) + 2 (nulls)

  const view = new DataView(data.buffer, data.byteOffset);
  const size = view.getInt32(0, true);

  if (data.length < 4 + size) return null; // Incomplete packet

  const id = view.getInt32(4, true);
  const type = view.getInt32(8, true);

  // Body is from offset 12 to (4 + size - 2), excluding the two null terminators
  const bodyLength = size - 10; // size minus id(4) + type(4) + 2 nulls
  const decoder = new TextDecoder();
  const body = decoder.decode(data.slice(12, 12 + Math.max(0, bodyLength)));

  return {
    id,
    type,
    body,
    bytesConsumed: 4 + size,
  };
}

/**
 * Read all available data from a socket with timeout
 */
async function readFromSocket(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLen = 0;

  // Read first chunk (blocking)
  const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
  if (done || !value) return new Uint8Array(0);
  chunks.push(value);
  totalLen += value.length;

  // Try to read more data with a short delay (for multi-packet responses)
  try {
    const shortTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('read_done')), 200),
    );
    while (true) {
      const { value: next, done: nextDone } = await Promise.race([reader.read(), shortTimeout]);
      if (nextDone || !next) break;
      chunks.push(next);
      totalLen += next.length;
    }
  } catch {
    // Short timeout expired - we have all data
  }

  // Combine
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

/**
 * Validate RCON request inputs
 */
function validateRCONInput(host: string, port: number, password: string): string | null {
  if (!host || host.trim().length === 0) {
    return 'Host is required';
  }

  if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
    return 'Host contains invalid characters';
  }

  if (port < 1 || port > 65535) {
    return 'Port must be between 1 and 65535';
  }

  if (!password || password.length === 0) {
    return 'Password is required for RCON authentication';
  }

  if (password.length > 512) {
    return 'Password too long (max 512 characters)';
  }

  return null;
}

/**
 * Handle RCON connect/authenticate request
 *
 * POST /api/rcon/connect
 * Body: { host, port?, password, timeout? }
 */
export async function handleRCONConnect(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as RCONConnectRequest;
    const { host, port = 25575, password, timeout = 10000 } = body;

    const validationError = validateRCONInput(host, port, password);
    if (validationError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: validationError,
        } satisfies RCONResponse),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send AUTH packet (type 3)
      const authPacket = buildRCONPacket(1, SERVERDATA_AUTH, password);
      await writer.write(authPacket);
      writer.releaseLock();

      // Read auth response(s)
      // Server sends: empty RESPONSE_VALUE, then AUTH_RESPONSE
      const responseData = await readFromSocket(reader, timeoutPromise);
      reader.releaseLock();

      // Parse packets from response
      let offset = 0;
      let authenticated = false;

      while (offset < responseData.length) {
        const packet = parseRCONPacket(responseData.slice(offset));
        if (!packet) break;
        offset += packet.bytesConsumed;

        // AUTH_RESPONSE type = 2
        // If id == -1, auth failed
        if (packet.type === 2) {
          authenticated = packet.id !== -1;
        }
      }

      socket.close();

      const result: RCONResponse = {
        success: true,
        authenticated,
      };

      if (!authenticated) {
        result.error = 'Authentication failed - incorrect RCON password';
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } satisfies RCONResponse),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

/**
 * Handle RCON command execution
 *
 * POST /api/rcon/command
 * Body: { host, port?, password, command, timeout? }
 */
export async function handleRCONCommand(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as RCONCommandRequest;
    const { host, port = 25575, password, command, timeout = 10000 } = body;

    const validationError = validateRCONInput(host, port, password);
    if (validationError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: validationError,
        } satisfies RCONResponse),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    if (!command || command.trim().length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Command is required',
        } satisfies RCONResponse),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    if (command.length > 1446) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Command too long (max 1446 characters, RCON body limit)',
        } satisfies RCONResponse),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: Authenticate
      const authPacket = buildRCONPacket(1, SERVERDATA_AUTH, password);
      await writer.write(authPacket);

      // Read auth response
      const authData = await readFromSocket(reader, timeoutPromise);

      let authenticated = false;
      let authOffset = 0;
      while (authOffset < authData.length) {
        const packet = parseRCONPacket(authData.slice(authOffset));
        if (!packet) break;
        authOffset += packet.bytesConsumed;
        if (packet.type === 2) {
          authenticated = packet.id !== -1;
        }
      }

      if (!authenticated) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            authenticated: false,
            error: 'Authentication failed - incorrect RCON password',
          } satisfies RCONResponse),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      // Step 2: Execute command
      const cmdPacket = buildRCONPacket(2, SERVERDATA_EXECCOMMAND, command);
      await writer.write(cmdPacket);
      writer.releaseLock();

      // Read command response
      const cmdData = await readFromSocket(reader, timeoutPromise);
      reader.releaseLock();

      // Parse response body
      let responseText = '';
      let cmdOffset = 0;
      while (cmdOffset < cmdData.length) {
        const packet = parseRCONPacket(cmdData.slice(cmdOffset));
        if (!packet) break;
        cmdOffset += packet.bytesConsumed;
        if (packet.type === SERVERDATA_RESPONSE_VALUE) {
          responseText += packet.body;
        }
      }

      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          authenticated: true,
          response: responseText || '(No output)',
        } satisfies RCONResponse),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } satisfies RCONResponse),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
