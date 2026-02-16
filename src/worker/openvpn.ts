/**
 * OpenVPN Protocol Implementation
 *
 * SSL/TLS VPN protocol for secure point-to-point connections.
 * Port 1194 (TCP mode, with 2-byte length prefix framing).
 *
 * Endpoints implemented:
 * - Handshake — Send P_CONTROL_HARD_RESET_CLIENT_V2, detect server response
 *
 * In TCP mode, each OpenVPN packet is prefixed with a 2-byte big-endian length.
 * The packet itself starts with an opcode byte:
 *   High 5 bits: Opcode (message type)
 *   Low 3 bits: Key ID
 *
 * Followed by an 8-byte session ID and message-specific payload.
 *
 * Use Cases:
 * - OpenVPN server detection and fingerprinting
 * - VPN infrastructure health checking
 * - Protocol version identification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface OpenVPNRequest {
  host: string;
  port?: number;
  timeout?: number;
}

// OpenVPN opcodes (high 5 bits of first byte)
const OPCODES: Record<number, string> = {
  0x01: 'P_CONTROL_HARD_RESET_CLIENT_V1',
  0x02: 'P_CONTROL_HARD_RESET_SERVER_V1',
  0x03: 'P_CONTROL_SOFT_RESET_V1',
  0x04: 'P_CONTROL_V1',
  0x05: 'P_ACK_V1',
  0x06: 'P_DATA_V1',
  0x07: 'P_CONTROL_HARD_RESET_CLIENT_V2',
  0x08: 'P_CONTROL_HARD_RESET_SERVER_V2',
  0x09: 'P_DATA_V2',
  0x0a: 'P_CONTROL_HARD_RESET_CLIENT_V3',
  0x0b: 'P_CONTROL_WKC_V1',
};

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build an OpenVPN TCP Client Hello packet (P_CONTROL_HARD_RESET_CLIENT_V2)
 *
 * TCP framing: 2-byte big-endian length prefix + OpenVPN packet
 * OpenVPN packet:
 *   Byte 0: Opcode (0x07 << 3) | KeyID (0x00) = 0x38
 *   Bytes 1-8: Session ID (8 bytes, random)
 *   Byte 9: HMAC/ACK array length = 0 (no prior messages to ACK)
 *   Bytes 10-13: Packet ID (4 bytes, big-endian, starts at 0)
 */
function buildClientHello(): { packet: Uint8Array; sessionId: Uint8Array } {
  const sessionId = new Uint8Array(8);
  crypto.getRandomValues(sessionId);

  // OpenVPN payload (without TCP length prefix)
  const payload = new Uint8Array(14);

  // Opcode: P_CONTROL_HARD_RESET_CLIENT_V2 (0x07) << 3 | KeyID 0 = 0x38
  payload[0] = 0x38;

  // Session ID (8 bytes)
  payload.set(sessionId, 1);

  // Message Packet ID ACK array length = 0
  payload[9] = 0x00;

  // Packet ID = 0 (4 bytes big-endian)
  payload[10] = 0x00;
  payload[11] = 0x00;
  payload[12] = 0x00;
  payload[13] = 0x00;

  // TCP framing: 2-byte length prefix
  const tcpPacket = new Uint8Array(2 + payload.length);
  tcpPacket[0] = (payload.length >> 8) & 0xff;
  tcpPacket[1] = payload.length & 0xff;
  tcpPacket.set(payload, 2);

  return { packet: tcpPacket, sessionId };
}

/**
 * Parse an OpenVPN TCP response
 */
function parseResponse(data: Uint8Array): {
  opcode: number;
  opcodeName: string;
  keyId: number;
  sessionId: string;
  ackCount: number;
  remoteSessionId?: string;
  packetId?: number;
} | null {
  if (data.length < 2) return null;

  // TCP framing: read 2-byte length prefix
  const packetLen = (data[0] << 8) | data[1];
  if (data.length < 2 + packetLen || packetLen < 10) return null;

  const payload = data.slice(2, 2 + packetLen);

  // Parse opcode and key ID
  const opcode = (payload[0] >> 3) & 0x1f;
  const keyId = payload[0] & 0x07;
  const opcodeName = OPCODES[opcode] || `UNKNOWN_0x${opcode.toString(16)}`;

  // Session ID (8 bytes)
  const sessionId = bytesToHex(payload.slice(1, 9));

  // ACK array
  const ackCount = payload[9] || 0;

  let offset = 10 + (ackCount * 4); // Skip ACK packet IDs

  // If there are ACKs, there's a remote session ID after them
  let remoteSessionId: string | undefined;
  if (ackCount > 0 && offset + 8 <= payload.length) {
    remoteSessionId = bytesToHex(payload.slice(offset, offset + 8));
    offset += 8;
  }

  // Packet ID (4 bytes, if present)
  let packetId: number | undefined;
  if (offset + 4 <= payload.length) {
    packetId = (payload[offset] << 24) | (payload[offset + 1] << 16) |
               (payload[offset + 2] << 8) | payload[offset + 3];
  }

  return { opcode, opcodeName, keyId, sessionId, ackCount, remoteSessionId, packetId };
}

/**
 * Handle OpenVPN Handshake — Send Client Hello, read Server Hello
 */
export async function handleOpenVPNHandshake(request: Request): Promise<Response> {
  try {
    const body = await request.json() as OpenVPNRequest;
    const { host, port = 1194, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if behind Cloudflare
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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const handshakePromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Build and send Client Hello
        const { packet, sessionId } = buildClientHello();
        await writer.write(packet);

        // Read Server Response
        let responseData = new Uint8Array(0);
        const readTimeout = setTimeout(() => {}, timeout);

        // Read until we have enough for a TCP-framed OpenVPN response
        while (responseData.length < 16) {
          const { value, done } = await reader.read();
          if (done) break;
          const newData = new Uint8Array(responseData.length + value.length);
          newData.set(responseData);
          newData.set(value, responseData.length);
          responseData = newData;

          // Check if we have enough based on TCP length prefix
          if (responseData.length >= 2) {
            const expectedLen = (responseData[0] << 8) | responseData[1];
            if (responseData.length >= 2 + expectedLen) break;
          }

          if (responseData.length > 4096) break;
        }

        clearTimeout(readTimeout);
        const rtt = Date.now() - startTime;
        await socket.close();

        if (responseData.length < 12) {
          return {
            success: false,
            host,
            port,
            rtt,
            isOpenVPN: false,
            error: `Incomplete response: received ${responseData.length} bytes`,
          };
        }

        const parsed = parseResponse(responseData);

        if (!parsed) {
          return {
            success: false,
            host,
            port,
            rtt,
            isOpenVPN: false,
            error: 'Failed to parse OpenVPN response',
            rawHex: bytesToHex(responseData.slice(0, Math.min(64, responseData.length))),
          };
        }

        // Check for expected Server Hello response
        const isServerHello = parsed.opcode === 0x08; // P_CONTROL_HARD_RESET_SERVER_V2
        const isServerHelloV1 = parsed.opcode === 0x02; // V1

        return {
          success: isServerHello || isServerHelloV1,
          host,
          port,
          rtt,
          isOpenVPN: true,
          opcode: parsed.opcodeName,
          keyId: parsed.keyId,
          serverSessionId: parsed.sessionId,
          clientSessionId: bytesToHex(sessionId),
          ackCount: parsed.ackCount,
          remoteSessionId: parsed.remoteSessionId,
          packetId: parsed.packetId,
          protocolVersion: isServerHello ? 2 : (isServerHelloV1 ? 1 : undefined),
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([handshakePromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Connection timeout') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Connection timeout',
      }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
