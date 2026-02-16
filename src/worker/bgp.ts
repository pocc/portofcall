/**
 * BGP (Border Gateway Protocol) Implementation
 *
 * Implements BGP connectivity testing via the BGP-4 protocol (port 179).
 * BGP is the routing protocol that makes the Internet work, exchanging
 * routing information between autonomous systems.
 *
 * Protocol Flow:
 * 1. Client connects to port 179
 * 2. Client sends OPEN message (version, AS number, hold time, router ID)
 * 3. Server responds with OPEN or NOTIFICATION
 * 4. If OPEN received, exchange KEEPALIVEs to confirm session
 *
 * Message Format:
 * - 16-byte marker (all 0xFF)
 * - 2-byte length
 * - 1-byte type (1=OPEN, 2=UPDATE, 3=NOTIFICATION, 4=KEEPALIVE)
 *
 * Use Cases:
 * - BGP speaker connectivity testing
 * - Router/peer version detection
 * - AS number verification
 * - Hold time negotiation check
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// BGP message types
const MSG_OPEN = 1;
const MSG_UPDATE = 2;
const MSG_NOTIFICATION = 3;
const MSG_KEEPALIVE = 4;

// BGP NOTIFICATION error codes
const ERROR_NAMES: Record<number, string> = {
  1: 'Message Header Error',
  2: 'OPEN Message Error',
  3: 'UPDATE Message Error',
  4: 'Hold Timer Expired',
  5: 'Finite State Machine Error',
  6: 'Cease',
};

// OPEN Message Error subcodes
const OPEN_ERROR_SUBCODES: Record<number, string> = {
  1: 'Unsupported Version Number',
  2: 'Bad Peer AS',
  3: 'Bad BGP Identifier',
  4: 'Unsupported Optional Parameter',
  5: 'Deprecated (Auth Failure)',
  6: 'Unacceptable Hold Time',
  7: 'Unsupported Capability',
};

/**
 * Build a BGP OPEN message
 */
function buildOpenMessage(localAS: number, holdTime: number, routerId: string): Uint8Array {
  // Parse router ID as IPv4
  const routerIdParts = routerId.split('.').map(Number);
  if (routerIdParts.length !== 4 || routerIdParts.some(p => isNaN(p) || p < 0 || p > 255)) {
    throw new Error('Invalid router ID format (must be IPv4 address)');
  }

  // OPEN message: version(1) + AS(2) + holdTime(2) + routerID(4) + optParamLen(1) = 10 bytes
  // Total: 19 (header) + 10 (open) = 29 bytes
  const length = 29;
  const msg = new Uint8Array(length);
  const view = new DataView(msg.buffer);

  // Marker: 16 bytes of 0xFF
  for (let i = 0; i < 16; i++) {
    msg[i] = 0xFF;
  }

  // Length
  view.setUint16(16, length);

  // Type: OPEN
  msg[18] = MSG_OPEN;

  // Version: BGP-4
  msg[19] = 4;

  // My Autonomous System (2 bytes)
  view.setUint16(20, localAS & 0xFFFF);

  // Hold Time (2 bytes)
  view.setUint16(22, holdTime);

  // BGP Identifier (Router ID as 4 IPv4 octets)
  msg[24] = routerIdParts[0];
  msg[25] = routerIdParts[1];
  msg[26] = routerIdParts[2];
  msg[27] = routerIdParts[3];

  // Optional Parameters Length: 0
  msg[28] = 0;

  return msg;
}

/**
 * Build a BGP KEEPALIVE message
 */
function buildKeepaliveMessage(): Uint8Array {
  const msg = new Uint8Array(19);
  for (let i = 0; i < 16; i++) {
    msg[i] = 0xFF;
  }
  const view = new DataView(msg.buffer);
  view.setUint16(16, 19);
  msg[18] = MSG_KEEPALIVE;
  return msg;
}

/**
 * Parse a BGP message from raw bytes
 */
function parseBGPMessage(data: Uint8Array): {
  type: number;
  typeName: string;
  length: number;
  // OPEN fields
  version?: number;
  peerAS?: number;
  holdTime?: number;
  routerId?: string;
  optParamLen?: number;
  capabilities?: string[];
  // NOTIFICATION fields
  errorCode?: number;
  errorSubcode?: number;
  errorName?: string;
  errorDetail?: string;
} | null {
  if (data.length < 19) return null;

  // Verify marker (16 bytes of 0xFF)
  for (let i = 0; i < 16; i++) {
    if (data[i] !== 0xFF) return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const length = view.getUint16(16);
  const type = data[18];

  const typeNames: Record<number, string> = {
    [MSG_OPEN]: 'OPEN',
    [MSG_UPDATE]: 'UPDATE',
    [MSG_NOTIFICATION]: 'NOTIFICATION',
    [MSG_KEEPALIVE]: 'KEEPALIVE',
  };

  const result: ReturnType<typeof parseBGPMessage> = {
    type,
    typeName: typeNames[type] || `UNKNOWN(${type})`,
    length,
  };

  if (type === MSG_OPEN && data.length >= 29) {
    result.version = data[19];
    result.peerAS = view.getUint16(20);
    result.holdTime = view.getUint16(22);
    result.routerId = `${data[24]}.${data[25]}.${data[26]}.${data[27]}`;
    result.optParamLen = data[28];

    // Parse optional parameters for capabilities
    if (result.optParamLen && result.optParamLen > 0 && data.length >= 29 + result.optParamLen) {
      result.capabilities = parseCapabilities(data.slice(29, 29 + result.optParamLen));
    }
  }

  if (type === MSG_NOTIFICATION && data.length >= 21) {
    result.errorCode = data[19];
    result.errorSubcode = data[20];
    result.errorName = ERROR_NAMES[result.errorCode] || `Unknown(${result.errorCode})`;

    if (result.errorCode === 2) {
      result.errorDetail = OPEN_ERROR_SUBCODES[result.errorSubcode] || `Subcode ${result.errorSubcode}`;
    } else {
      result.errorDetail = `Subcode ${result.errorSubcode}`;
    }
  }

  return result;
}

/**
 * Parse BGP optional parameters / capabilities
 */
function parseCapabilities(data: Uint8Array): string[] {
  const caps: string[] = [];
  let offset = 0;

  const capNames: Record<number, string> = {
    1: 'Multiprotocol Extensions',
    2: 'Route Refresh',
    64: 'Graceful Restart',
    65: '4-Octet AS Number',
    69: 'ADD-PATH',
    70: 'Enhanced Route Refresh',
    71: 'Long-Lived Graceful Restart',
    73: 'FQDN Capability',
    128: 'Route Refresh (old)',
  };

  while (offset < data.length) {
    if (offset + 2 > data.length) break;
    const paramType = data[offset];
    const paramLen = data[offset + 1];
    offset += 2;

    if (paramType === 2) { // Capability
      let capOffset = 0;
      while (capOffset < paramLen && offset + capOffset + 2 <= data.length) {
        const capCode = data[offset + capOffset];
        const capLen = data[offset + capOffset + 1];
        const name = capNames[capCode] || `Capability(${capCode})`;
        caps.push(name);
        capOffset += 2 + capLen;
      }
    }

    offset += paramLen;
  }

  return caps;
}

/**
 * Handle BGP connection test
 */
export async function handleBGPConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      localAS?: number;
      routerId?: string;
      holdTime?: number;
      timeout?: number;
    };

    const {
      host,
      port = 179,
      localAS = 65000,
      routerId = '10.0.0.1',
      holdTime = 90,
      timeout = 10000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
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

    if (localAS < 1 || localAS > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'AS number must be between 1 and 65535',
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

    // Send BGP OPEN message
    const openMsg = buildOpenMessage(localAS, holdTime, routerId);
    await writer.write(openMsg);

    // Read response (OPEN or NOTIFICATION)
    let peerOpen: ReturnType<typeof parseBGPMessage> = null;
    let notification: ReturnType<typeof parseBGPMessage> = null;
    let keepaliveReceived = false;

    try {
      // Read first response
      const readResult = await Promise.race([reader.read(), timeoutPromise]);
      if (readResult.value && readResult.value.length >= 19) {
        const parsed = parseBGPMessage(readResult.value);
        if (parsed) {
          if (parsed.type === MSG_OPEN) {
            peerOpen = parsed;

            // Send KEEPALIVE to confirm
            await writer.write(buildKeepaliveMessage());

            // Try to read KEEPALIVE confirmation
            try {
              const readTimeout = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Keepalive timeout')), 3000);
              });
              const kaResult = await Promise.race([reader.read(), readTimeout]);
              if (kaResult.value && kaResult.value.length >= 19) {
                const kaParsed = parseBGPMessage(kaResult.value);
                if (kaParsed && kaParsed.type === MSG_KEEPALIVE) {
                  keepaliveReceived = true;
                } else if (kaParsed && kaParsed.type === MSG_NOTIFICATION) {
                  notification = kaParsed;
                }
              }
            } catch {
              // Keepalive timeout is OK — we still got the OPEN
            }
          } else if (parsed.type === MSG_NOTIFICATION) {
            notification = parsed;
          } else if (parsed.type === MSG_KEEPALIVE) {
            keepaliveReceived = true;
          }
        }
      }
    } catch {
      // Read timeout
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    if (peerOpen) {
      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        connectTime,
        peerOpen: {
          version: peerOpen.version,
          peerAS: peerOpen.peerAS,
          holdTime: peerOpen.holdTime,
          routerId: peerOpen.routerId,
          capabilities: peerOpen.capabilities || [],
        },
        sessionEstablished: keepaliveReceived,
        notification: notification ? {
          errorCode: notification.errorCode,
          errorSubcode: notification.errorSubcode,
          errorName: notification.errorName,
          errorDetail: notification.errorDetail,
        } : undefined,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (notification) {
      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        connectTime,
        peerOpen: null,
        sessionEstablished: false,
        notification: {
          errorCode: notification.errorCode,
          errorSubcode: notification.errorSubcode,
          errorName: notification.errorName,
          errorDetail: notification.errorDetail,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Connected but no BGP response
    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      peerOpen: null,
      sessionEstablished: false,
      notification: null,
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
