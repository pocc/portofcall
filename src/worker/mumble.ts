/**
 * Mumble Protocol Implementation
 *
 * Mumble is a free, open-source, low-latency, high-quality voice chat application
 * primarily designed for gaming. It's an alternative to proprietary solutions like
 * TeamSpeak and Discord's voice features.
 *
 * Protocol Overview:
 * - Port: 64738 (TCP for control, UDP for voice)
 * - Transport: TCP (control/state), UDP (voice data)
 * - Format: Binary protocol using Protocol Buffers (Protobuf)
 * - Encryption: TLS for TCP, OCB-AES128 for UDP
 *
 * Protocol Structure:
 * - Message Type (2 bytes, big-endian uint16)
 * - Message Length (4 bytes, big-endian uint32)
 * - Payload (variable, Protocol Buffer message)
 *
 * Message Types:
 * - 0: Version - Client/server version exchange
 * - 1: UDPTunnel - UDP voice data over TCP fallback
 * - 2: Authenticate - Client authentication
 * - 3: Ping - Keepalive/latency check
 * - 4: Reject - Authentication rejection
 * - 5: ServerSync - Server synchronization
 * - 6: ChannelRemove - Channel deleted
 * - 7: ChannelState - Channel info/state
 * - 8: UserRemove - User disconnected
 * - 9: UserState - User info/state
 * - 10: BanList - Server ban list
 * - 11: TextMessage - Chat message
 * - 12: PermissionDenied - Permission error
 * - 13: ACL - Access control list
 * - 14: QueryUsers - Query user info
 * - 15: CryptSetup - Encryption setup
 * - 16: ContextActionModify - Context menu action
 * - 17: ContextAction - Context menu trigger
 * - 18: UserList - User list
 * - 19: VoiceTarget - Voice target config
 * - 20: PermissionQuery - Permission query
 * - 21: CodecVersion - Audio codec version
 * - 22: UserStats - User statistics
 * - 23: RequestBlob - Request large data
 * - 24: ServerConfig - Server configuration
 * - 25: SuggestConfig - Suggest client config
 *
 * Version Message (Type 0):
 * - version_v1: Client version (16-bit: major, 8-bit: minor, 8-bit: patch)
 * - release: Release name (e.g., "1.3.0")
 * - os: Operating system (e.g., "Linux", "Windows")
 * - os_version: OS version string
 *
 * Connection Flow:
 * 1. Client → Server: Version message (Type 0)
 * 2. Server → Client: Version response with server info
 * 3. Client → Server: Authenticate message (Type 2)
 * 4. Server → Client: CryptSetup (Type 15), CodecVersion (21), ChannelState (7), UserState (9)
 * 5. Server → Client: ServerSync (Type 5) - authentication complete
 * 6. Voice communication begins (UDP or TCP tunnel)
 *
 * Use Cases:
 * - Gaming voice chat server detection
 * - VoIP infrastructure inventory
 * - Community server discovery
 * - Network service analysis
 * - Alternative to Discord/TeamSpeak detection
 *
 * Modern Usage:
 * - Popular for gaming communities
 * - Open-source alternative to proprietary VoIP
 * - Used by privacy-conscious users
 * - Self-hosted voice chat solution
 * - Low-latency (<50ms) requirements
 *
 * Reference:
 * - https://www.mumble.info/
 * - https://github.com/mumble-voip/mumble
 * - https://mumble-protocol.readthedocs.io/
 */

import { connect } from 'cloudflare:sockets';

interface MumbleRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface MumbleResponse {
  success: boolean;
  host: string;
  port: number;
  serverVersion?: string;
  serverRelease?: string;
  serverOS?: string;
  messageType?: number;
  messageTypeName?: string;
  rtt?: number;
  error?: string;
}

// Mumble Message Types
enum MumbleMessageType {
  Version = 0,
  UDPTunnel = 1,
  Authenticate = 2,
  Ping = 3,
  Reject = 4,
  ServerSync = 5,
  ChannelRemove = 6,
  ChannelState = 7,
  UserRemove = 8,
  UserState = 9,
  BanList = 10,
  TextMessage = 11,
  PermissionDenied = 12,
  ACL = 13,
  QueryUsers = 14,
  CryptSetup = 15,
  ContextActionModify = 16,
  ContextAction = 17,
  UserList = 18,
  VoiceTarget = 19,
  PermissionQuery = 20,
  CodecVersion = 21,
  UserStats = 22,
  RequestBlob = 23,
  ServerConfig = 24,
  SuggestConfig = 25,
}

/**
 * Build simple Mumble Version message (Type 0)
 * This is a simplified version without full Protobuf encoding
 */
function buildMumbleVersion(): Buffer {
  // Simplified version message
  // Real Mumble uses Protobuf encoding, but we'll send a minimal handshake

  // Version: 1.3.0 encoded as (1 << 16) | (3 << 8) | 0 = 0x010300
  const version = (1 << 16) | (3 << 8) | 0;

  // Simplified Protobuf-like payload
  // Field 1 (version): varint
  // Field 2 (release): string "1.3.0"
  // Field 3 (os): string "Linux"

  const payload = Buffer.concat([
    // Field 1: version (tag 1, type varint)
    Buffer.from([0x08]), // Tag 1, wire type 0 (varint)
    encodeVarint(version),
    // Field 2: release (tag 2, type string)
    Buffer.from([0x12, 0x05]), // Tag 2, wire type 2 (length-delimited), length 5
    Buffer.from('1.3.0', 'utf8'),
    // Field 3: os (tag 3, type string)
    Buffer.from([0x1A, 0x05]), // Tag 3, wire type 2, length 5
    Buffer.from('Linux', 'utf8'),
  ]);

  // Build message: Type (2 bytes) + Length (4 bytes) + Payload
  const header = Buffer.allocUnsafe(6);
  header.writeUInt16BE(MumbleMessageType.Version, 0); // Message type
  header.writeUInt32BE(payload.length, 2); // Payload length

  return Buffer.concat([header, payload]);
}

/**
 * Encode varint (Protobuf variable-length integer)
 */
function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];

  while (value > 0x7F) {
    bytes.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7F);

  return Buffer.from(bytes);
}

/**
 * Parse Mumble message header
 */
function parseMumbleMessage(data: Buffer): {
  messageType: number;
  messageLength: number;
  payload: Buffer;
} | null {
  if (data.length < 6) {
    return null;
  }

  const messageType = data.readUInt16BE(0);
  const messageLength = data.readUInt32BE(2);

  // Extract payload (may be less than messageLength if packet is fragmented)
  const payload = data.subarray(6, Math.min(6 + messageLength, data.length));

  return {
    messageType,
    messageLength,
    payload,
  };
}

/**
 * Parse Mumble Version payload (simplified Protobuf parsing)
 */
function parseVersionPayload(payload: Buffer): {
  version?: number;
  release?: string;
  os?: string;
} {
  const result: {
    version?: number;
    release?: string;
    os?: string;
  } = {};

  let offset = 0;

  while (offset < payload.length) {
    if (offset >= payload.length) break;

    // Read tag (field number + wire type)
    const tag = payload.readUInt8(offset);
    offset++;

    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    if (wireType === 0) {
      // Varint
      let value = 0;
      let shift = 0;
      while (offset < payload.length) {
        const byte = payload.readUInt8(offset);
        offset++;
        value |= (byte & 0x7F) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      if (fieldNumber === 1) {
        result.version = value;
      }
    } else if (wireType === 2) {
      // Length-delimited (string, bytes)
      if (offset >= payload.length) break;
      const length = payload.readUInt8(offset);
      offset++;
      if (offset + length > payload.length) break;
      const str = payload.toString('utf8', offset, offset + length);
      offset += length;
      if (fieldNumber === 2) {
        result.release = str;
      } else if (fieldNumber === 3) {
        result.os = str;
      }
    } else {
      // Unknown wire type, skip
      break;
    }
  }

  return result;
}

/**
 * Probe Mumble server by sending Version message.
 * Detects Mumble/Murmur server and version.
 */
export async function handleMumbleProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MumbleRequest;
    const { host, port = 64738, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies MumbleResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Port must be between 1 and 65535',
      } satisfies MumbleResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Send Mumble Version message
      const versionMessage = buildMumbleVersion();

      const writer = socket.writable.getWriter();
      await writer.write(versionMessage);
      writer.releaseLock();

      // Read server response
      const reader = socket.readable.getReader();

      const { value, done } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (done || !value) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response from Mumble server',
        } satisfies MumbleResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parseMumbleMessage(Buffer.from(value));

      if (!parsed) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid Mumble message format',
        } satisfies MumbleResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      // Parse version info if it's a Version message
      let versionInfo: { version?: number; release?: string; os?: string } = {};
      if (parsed.messageType === MumbleMessageType.Version) {
        versionInfo = parseVersionPayload(parsed.payload);
      }

      reader.releaseLock();
      socket.close();

      // Map message type to name
      const messageTypeNames: { [key: number]: string } = {
        [MumbleMessageType.Version]: 'Version',
        [MumbleMessageType.UDPTunnel]: 'UDPTunnel',
        [MumbleMessageType.Authenticate]: 'Authenticate',
        [MumbleMessageType.Ping]: 'Ping',
        [MumbleMessageType.Reject]: 'Reject',
        [MumbleMessageType.ServerSync]: 'ServerSync',
        [MumbleMessageType.CryptSetup]: 'CryptSetup',
        [MumbleMessageType.CodecVersion]: 'CodecVersion',
      };

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        messageType: parsed.messageType,
        messageTypeName: messageTypeNames[parsed.messageType] || `Unknown (${parsed.messageType})`,
        serverVersion: versionInfo.version?.toString(16),
        serverRelease: versionInfo.release,
        serverOS: versionInfo.os,
        rtt,
      } satisfies MumbleResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: 64738,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies MumbleResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Get detailed Mumble server version information.
 * Same as probe but with focus on version extraction.
 */
export async function handleMumbleVersion(request: Request): Promise<Response> {
  // Reuse probe logic
  return handleMumbleProbe(request);
}
