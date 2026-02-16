/**
 * Battle.net BNCS (Battle.net Chat Server) Protocol Implementation
 *
 * Battle.net is the online gaming service developed by Blizzard Entertainment.
 * The BNCS protocol is used by classic Blizzard games including:
 * - Diablo (1996)
 * - StarCraft (1998)
 * - Warcraft II: Battle.net Edition (1999)
 * - Diablo II (2000)
 * - Warcraft III (2002)
 *
 * Protocol Overview:
 * - Default Port: 6112
 * - Transport: TCP
 * - Binary protocol with little-endian byte order
 * - All messages prefixed with 0xFF header byte
 *
 * Message Structure:
 * - Header byte: 0xFF (1 byte)
 * - Message ID: (1 byte) - identifies message type
 * - Length: uint16 LE (2 bytes) - total message length including header
 * - Data: variable length message payload
 *
 * Connection Flow:
 * 1. Client connects to server on port 6112
 * 2. Client sends protocol selector byte:
 *    - 0x01: Game protocol (Diablo, StarCraft, etc.)
 *    - 0x02: BNFTP (Battle.net File Transfer Protocol)
 *    - 0x03: Telnet/Chat protocol
 * 3. Client sends BNCS messages (SID_* packets)
 * 4. Server responds with corresponding messages
 *
 * Common Message IDs (SID_*):
 * - 0x00: SID_NULL - Keepalive/ping
 * - 0x25: SID_PING - Server ping request
 * - 0x50: SID_AUTH_INFO - Authentication information request
 * - 0x51: SID_AUTH_CHECK - CD key verification
 *
 * References:
 * - BNETDocs: https://bnetdocs.org/
 * - Protocol Overview: https://bnetdocs.org/document/10/battle-net-chat-server-protocol-overview
 * - Protocol Headers: https://bnetdocs.org/document/16/protocol-headers
 */

import { connect } from 'cloudflare:sockets';

interface BattlenetRequest {
  host: string;
  port?: number;
  timeout?: number;
  protocolId?: number; // 0x01=Game, 0x02=BNFTP, 0x03=Telnet
}

interface BattlenetResponse {
  success: boolean;
  host: string;
  port: number;
  protocolId?: number;
  serverResponse?: boolean;
  messageId?: number;
  messageLength?: number;
  rawData?: string;
  error?: string;
  details?: string;
}

// BNCS Protocol Constants
const BNCS_HEADER_BYTE = 0xFF;

// Protocol selector bytes
const PROTOCOL_GAME = 0x01;
// const PROTOCOL_BNFTP = 0x02;
// const PROTOCOL_TELNET = 0x03;

// Message IDs (SID_*)
const SID_NULL = 0x00; // Keepalive/ping

/**
 * Build Battle.net BNCS message
 * Format: [0xFF | Message ID | Length (uint16 LE) | Data]
 */
function buildBNCSMessage(messageId: number, data?: Uint8Array): Uint8Array {
  const dataLength = data ? data.length : 0;
  const totalLength = 4 + dataLength; // 4-byte header + data

  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);

  // Header byte
  buffer[0] = BNCS_HEADER_BYTE;

  // Message ID
  buffer[1] = messageId;

  // Length (little-endian uint16)
  view.setUint16(2, totalLength, true);

  // Data
  if (data) {
    buffer.set(data, 4);
  }

  return buffer;
}

/**
 * Parse Battle.net BNCS message response
 */
function parseBNCSMessage(data: Uint8Array): Partial<BattlenetResponse> {
  if (data.length < 4) {
    throw new Error('Response too short for BNCS message header');
  }

  // Check header byte
  if (data[0] !== BNCS_HEADER_BYTE) {
    throw new Error(`Invalid BNCS header byte: expected 0xFF, got 0x${data[0].toString(16)}`);
  }

  const messageId = data[1];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const messageLength = view.getUint16(2, true); // little-endian

  const result: Partial<BattlenetResponse> = {
    serverResponse: true,
    messageId,
    messageLength,
  };

  // Convert data to hex string for inspection
  if (data.length > 4) {
    const dataBytes = Array.from(data.slice(4));
    result.rawData = dataBytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
  }

  return result;
}

/**
 * Handle Battle.net BNCS connection probe
 */
export async function handleBattlenetConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json() as BattlenetRequest;
    const { host, port = 6112, timeout = 15000, protocolId = PROTOCOL_GAME } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate port
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate protocol ID
    if (![PROTOCOL_GAME, 0x02, 0x03].includes(protocolId)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Protocol ID must be 0x01 (Game), 0x02 (BNFTP), or 0x03 (Telnet)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Connect to Battle.net server
    const socket = connect(`${host}:${port}`);

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      // Wait for connection
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Send protocol selector byte
        await writer.write(new Uint8Array([protocolId]));

        // Send SID_NULL (ping) message
        const nullMessage = buildBNCSMessage(SID_NULL);
        await writer.write(nullMessage);

        // Read response
        const { value, done } = await Promise.race([
          reader.read(),
          timeoutPromise,
        ]) as ReadableStreamReadResult<Uint8Array>;

        if (done || !value) {
          return new Response(JSON.stringify({
            success: false,
            host,
            port,
            protocolId,
            error: 'Connection closed by server',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Parse BNCS response
        const parsed = parseBNCSMessage(value);

        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          protocolId,
          ...parsed,
        } as BattlenetResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        protocolId,
        error: errorMessage,
      } as BattlenetResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } finally {
      try {
        await socket.close();
      } catch {
        // Ignore close errors
      }
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Request processing failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
