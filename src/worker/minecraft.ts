/**
 * Minecraft Server List Ping (SLP) Protocol Implementation
 *
 * The Server List Ping protocol is used by Minecraft clients to query
 * a server's status: version, MOTD, player count, and favicon.
 * This is separate from RCON (port 25575) which is for admin commands.
 *
 * Protocol Flow (wiki.vg/Server_List_Ping):
 * 1. Client → Handshake packet (protocol version, address, port, next_state=1)
 * 2. Client → Status Request (packet ID 0x00, empty)
 * 3. Server → Status Response (packet ID 0x00, JSON string)
 * 4. Client → Ping (packet ID 0x01, int64 payload)
 * 5. Server → Pong (packet ID 0x01, echoed int64)
 *
 * Packet Structure:
 *   [VarInt Length][VarInt PacketID][Payload...]
 *
 * VarInt Encoding:
 *   Variable-length integer (1-5 bytes), MSB continuation bit
 *   Same as Protocol Buffers varint encoding
 *
 * Default Port: 25565
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface MinecraftStatusRequest {
  host: string;
  port?: number;
  timeout?: number;
  protocolVersion?: number;
}

interface MinecraftPingRequest {
  host: string;
  port?: number;
  timeout?: number;
  protocolVersion?: number;
}

interface MinecraftStatusResponse {
  success: boolean;
  host?: string;
  port?: number;
  version?: {
    name: string;
    protocol: number;
  };
  players?: {
    max: number;
    online: number;
    sample?: Array<{ name: string; id: string }>;
  };
  description?: string;
  favicon?: string;
  latency?: number;
  rawJson?: string;
  error?: string;
  isCloudflare?: boolean;
}

// --- VarInt Encoding/Decoding ---

/**
 * Encode an integer as a VarInt (1-5 bytes, MSB continuation)
 */
function encodeVarInt(value: number): Uint8Array {
  const bytes: number[] = [];
  let v = value & 0xFFFFFFFF; // treat as unsigned 32-bit
  do {
    let byte = v & 0x7F;
    v >>>= 7;
    if (v !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (v !== 0);
  return new Uint8Array(bytes);
}

/**
 * Decode a VarInt from a buffer at the given offset
 * Returns [value, bytesRead]
 */
function decodeVarInt(data: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;

  while (true) {
    if (offset + bytesRead >= data.length) {
      throw new Error('VarInt: unexpected end of data');
    }
    const byte = data[offset + bytesRead];
    result |= (byte & 0x7F) << shift;
    bytesRead++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift >= 35) {
      throw new Error('VarInt too large');
    }
  }

  return [result, bytesRead];
}

// --- Packet Building ---

/**
 * Build a Minecraft protocol packet: [VarInt Length][PacketID + Payload]
 */
function buildPacket(packetId: number, payload: Uint8Array): Uint8Array {
  const idBytes = encodeVarInt(packetId);
  const innerLength = idBytes.length + payload.length;
  const lengthBytes = encodeVarInt(innerLength);

  const packet = new Uint8Array(lengthBytes.length + innerLength);
  packet.set(lengthBytes, 0);
  packet.set(idBytes, lengthBytes.length);
  packet.set(payload, lengthBytes.length + idBytes.length);
  return packet;
}

/**
 * Encode a string as [VarInt Length][UTF-8 bytes]
 */
function encodeString(str: string): Uint8Array {
  const encoder = new TextEncoder();
  const strBytes = encoder.encode(str);
  const lengthBytes = encodeVarInt(strBytes.length);
  const result = new Uint8Array(lengthBytes.length + strBytes.length);
  result.set(lengthBytes, 0);
  result.set(strBytes, lengthBytes.length);
  return result;
}

/**
 * Encode an unsigned short (16-bit big-endian)
 */
function encodeUnsignedShort(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  buf[0] = (value >> 8) & 0xFF;
  buf[1] = value & 0xFF;
  return buf;
}

/**
 * Build the Handshake packet (ID 0x00)
 * Fields: [VarInt ProtocolVersion][String ServerAddress][Unsigned Short Port][VarInt NextState]
 * NextState = 1 for Status
 */
function buildHandshakePacket(host: string, port: number, protocolVersion: number): Uint8Array {
  const versionBytes = encodeVarInt(protocolVersion);
  const addressBytes = encodeString(host);
  const portBytes = encodeUnsignedShort(port);
  const nextStateBytes = encodeVarInt(1); // 1 = Status

  const payload = new Uint8Array(
    versionBytes.length + addressBytes.length + portBytes.length + nextStateBytes.length,
  );
  let offset = 0;
  payload.set(versionBytes, offset); offset += versionBytes.length;
  payload.set(addressBytes, offset); offset += addressBytes.length;
  payload.set(portBytes, offset); offset += portBytes.length;
  payload.set(nextStateBytes, offset);

  return buildPacket(0x00, payload);
}

/**
 * Build the Status Request packet (ID 0x00, empty payload)
 */
function buildStatusRequestPacket(): Uint8Array {
  return buildPacket(0x00, new Uint8Array(0));
}

/**
 * Build the Ping packet (ID 0x01, int64 payload)
 */
function buildPingPacket(payload: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigInt64(0, payload, false); // big-endian
  return buildPacket(0x01, buf);
}

// --- Response Parsing ---

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

  // Try to read more data with a short delay (server may split response)
  try {
    const shortTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('read_done')), 500),
    );
    while (true) {
      const { value: next, done: nextDone } = await Promise.race([reader.read(), shortTimeout]);
      if (nextDone || !next) break;
      chunks.push(next);
      totalLen += next.length;
    }
  } catch {
    // Short timeout expired - we have all available data
  }

  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

/**
 * Parse the JSON description field into a plain text string
 * Minecraft uses either a string or a Chat component object
 */
function parseDescription(desc: unknown): string {
  if (typeof desc === 'string') return desc;
  if (desc && typeof desc === 'object') {
    const obj = desc as Record<string, unknown>;
    let text = '';
    if (typeof obj.text === 'string') text += obj.text;
    if (Array.isArray(obj.extra)) {
      for (const part of obj.extra) {
        if (typeof part === 'string') text += part;
        else if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
          text += (part as Record<string, unknown>).text;
        }
      }
    }
    return text || JSON.stringify(desc);
  }
  return String(desc);
}

// --- Input Validation ---

function validateMinecraftInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) {
    return 'Host is required';
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(host)) {
    return 'Host contains invalid characters';
  }

  if (port < 1 || port > 65535) {
    return 'Port must be between 1 and 65535';
  }

  return null;
}

// --- Handlers ---

/**
 * Handle Minecraft Server List Ping - Status query
 *
 * POST /api/minecraft/status
 * Body: { host, port?, timeout?, protocolVersion? }
 *
 * Returns server version, player count, MOTD, and favicon
 */
export async function handleMinecraftStatus(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as MinecraftStatusRequest;
    const {
      host,
      port = 25565,
      timeout = 10000,
      protocolVersion = 767, // 1.21.1 (current as of 2024)
    } = body;

    const validationError = validateMinecraftInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies MinecraftStatusResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Check if behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        } satisfies MinecraftStatusResponse),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
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

      // Step 1: Send Handshake + Status Request
      const handshake = buildHandshakePacket(host, port, protocolVersion);
      const statusRequest = buildStatusRequestPacket();

      // Send both packets together
      const combined = new Uint8Array(handshake.length + statusRequest.length);
      combined.set(handshake, 0);
      combined.set(statusRequest, handshake.length);
      await writer.write(combined);

      // Step 2: Read Status Response
      const responseData = await readFromSocket(reader, timeoutPromise);

      if (responseData.length === 0) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            error: 'No response from server',
          } satisfies MinecraftStatusResponse),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Parse: [VarInt PacketLength][VarInt PacketID][VarInt StringLength][UTF-8 JSON]
      let offset = 0;
      const [, lengthBytes] = decodeVarInt(responseData, offset);
      offset += lengthBytes;

      const [packetId, idBytes] = decodeVarInt(responseData, offset);
      offset += idBytes;

      if (packetId !== 0x00) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            error: `Unexpected packet ID: 0x${packetId.toString(16)}`,
          } satisfies MinecraftStatusResponse),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const [stringLength, strLenBytes] = decodeVarInt(responseData, offset);
      offset += strLenBytes;

      const decoder = new TextDecoder();
      const jsonStr = decoder.decode(responseData.slice(offset, offset + stringLength));

      // Step 3: Optional Ping/Pong for latency
      let latency: number | undefined;
      try {
        const pingPayload = BigInt(Date.now());
        const pingPacket = buildPingPacket(pingPayload);
        const pingStart = Date.now();
        await writer.write(pingPacket);

        const pongData = await readFromSocket(reader, timeoutPromise);
        if (pongData.length >= 10) {
          latency = Date.now() - pingStart;
        }
      } catch {
        // Ping failed - not critical, skip latency
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Parse the JSON response
      const serverInfo = JSON.parse(jsonStr) as Record<string, unknown>;

      const result: MinecraftStatusResponse = {
        success: true,
        host,
        port,
        version: serverInfo.version as MinecraftStatusResponse['version'],
        players: serverInfo.players as MinecraftStatusResponse['players'],
        description: parseDescription(serverInfo.description),
        latency,
        rawJson: jsonStr,
      };

      // Include favicon if present (data:image/png;base64,...)
      if (typeof serverInfo.favicon === 'string') {
        result.favicon = serverInfo.favicon;
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
      } satisfies MinecraftStatusResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle Minecraft Ping (latency-only measurement)
 *
 * POST /api/minecraft/ping
 * Body: { host, port?, timeout?, protocolVersion? }
 *
 * Performs the full handshake but focuses on the Ping/Pong latency
 */
export async function handleMinecraftPing(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as MinecraftPingRequest;
    const {
      host,
      port = 25565,
      timeout = 10000,
      protocolVersion = 767,
    } = body;

    const validationError = validateMinecraftInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
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
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

    try {
      const connectStart = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const tcpLatency = Date.now() - connectStart;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send Handshake + Status Request
      const handshake = buildHandshakePacket(host, port, protocolVersion);
      const statusRequest = buildStatusRequestPacket();
      const combined = new Uint8Array(handshake.length + statusRequest.length);
      combined.set(handshake, 0);
      combined.set(statusRequest, handshake.length);
      await writer.write(combined);

      // Read Status Response (required before Ping)
      await readFromSocket(reader, timeoutPromise);

      // Send Ping
      const pingPayload = BigInt(Date.now());
      const pingPacket = buildPingPacket(pingPayload);
      const pingStart = Date.now();
      await writer.write(pingPacket);

      // Read Pong
      const pongData = await readFromSocket(reader, timeoutPromise);
      const pingLatency = Date.now() - pingStart;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Verify pong
      let pongValid = false;
      if (pongData.length >= 10) {
        let offset = 0;
        const [, lb] = decodeVarInt(pongData, offset);
        offset += lb;
        const [pongId] = decodeVarInt(pongData, offset);
        pongValid = pongId === 0x01;
      }

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          tcpLatency,
          pingLatency,
          pongValid,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
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
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
