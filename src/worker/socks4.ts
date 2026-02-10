/**
 * SOCKS4 Protocol Implementation
 *
 * SOCKS4 is a protocol for proxying TCP connections through a firewall.
 * It's the original version of SOCKS (superseded by SOCKS5).
 *
 * Protocol Flow:
 * 1. Client connects to SOCKS proxy server
 * 2. Client sends connection request (version, command, dest port/IP, userid)
 * 3. Server responds with grant/reject code
 * 4. If granted, TCP tunnel is established
 *
 * Use Cases:
 * - Firewall traversal
 * - Proxy testing
 * - SSH tunneling (ssh -D)
 * - Network debugging
 */

import { connect } from 'cloudflare:sockets';

interface Socks4Request {
  proxyHost: string;
  proxyPort?: number;
  destHost: string;
  destPort: number;
  userId?: string;
  useSocks4a?: boolean;
  timeout?: number;
}

interface Socks4Response {
  success: boolean;
  granted?: boolean;
  responseCode?: number;
  responseMessage?: string;
  boundAddress?: string;
  boundPort?: number;
  error?: string;
}

/**
 * SOCKS4 Response Codes
 */
const SOCKS4_RESPONSES: Record<number, string> = {
  0x5A: 'Request granted',
  0x5B: 'Request rejected or failed',
  0x5C: 'Request failed (client not reachable)',
  0x5D: 'Request failed (userid mismatch)',
};

/**
 * Convert hostname to IP address (simple DNS resolution placeholder)
 * In a real implementation, this would use actual DNS resolution
 */
function hostnameToIP(hostname: string): Uint8Array {
  // Check if already an IPv4 address
  const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipMatch) {
    return new Uint8Array([
      parseInt(ipMatch[1]),
      parseInt(ipMatch[2]),
      parseInt(ipMatch[3]),
      parseInt(ipMatch[4]),
    ]);
  }

  // For SOCKS4a, use special IP 0.0.0.1
  return new Uint8Array([0, 0, 0, 1]);
}

/**
 * Build SOCKS4 connection request packet
 */
function buildSocks4Request(
  destHost: string,
  destPort: number,
  userId: string = '',
  useSocks4a: boolean = false
): Uint8Array {
  const userIdBytes = new TextEncoder().encode(userId);
  const destIP = hostnameToIP(destHost);

  let packetSize = 9 + userIdBytes.length; // VN(1) + CD(1) + PORT(2) + IP(4) + USERID + NULL(1)

  // If using SOCKS4a with hostname, add hostname + null
  let hostnameBytes: Uint8Array | null = null;
  if (useSocks4a && (destIP[0] === 0 && destIP[1] === 0 && destIP[2] === 0)) {
    hostnameBytes = new TextEncoder().encode(destHost);
    packetSize += hostnameBytes.length + 1; // hostname + NULL
  }

  const packet = new Uint8Array(packetSize);
  let offset = 0;

  // VN: SOCKS version (0x04)
  packet[offset++] = 0x04;

  // CD: Command code (0x01 = CONNECT)
  packet[offset++] = 0x01;

  // DSTPORT: Destination port (2 bytes, network byte order / big-endian)
  packet[offset++] = (destPort >> 8) & 0xFF;
  packet[offset++] = destPort & 0xFF;

  // DSTIP: Destination IP (4 bytes)
  packet.set(destIP, offset);
  offset += 4;

  // USERID: User ID string (variable length)
  if (userIdBytes.length > 0) {
    packet.set(userIdBytes, offset);
    offset += userIdBytes.length;
  }

  // NULL: Null terminator for userid
  packet[offset++] = 0x00;

  // SOCKS4a: Add hostname if using special IP
  if (hostnameBytes) {
    packet.set(hostnameBytes, offset);
    offset += hostnameBytes.length;
    packet[offset++] = 0x00; // NULL terminator for hostname
  }

  return packet;
}

/**
 * Parse SOCKS4 server response
 */
function parseSocks4Response(response: Uint8Array): {
  granted: boolean;
  code: number;
  message: string;
  boundPort: number;
  boundAddress: string;
} {
  // Response format: VN(1) + CD(1) + DSTPORT(2) + DSTIP(4)
  if (response.length < 8) {
    throw new Error('Invalid SOCKS4 response: too short');
  }

  const vn = response[0];
  const cd = response[1];
  const boundPort = (response[2] << 8) | response[3];
  const boundAddress = `${response[4]}.${response[5]}.${response[6]}.${response[7]}`;

  // VN should be 0x00 (not 0x04) in response
  if (vn !== 0x00) {
    throw new Error(`Invalid SOCKS4 response: unexpected version ${vn}`);
  }

  const granted = cd === 0x5A;
  const message = SOCKS4_RESPONSES[cd] || `Unknown response code: 0x${cd.toString(16)}`;

  return {
    granted,
    code: cd,
    message,
    boundPort,
    boundAddress,
  };
}

/**
 * Test SOCKS4 proxy connection
 */
export async function handleSocks4Connect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as Socks4Request;
    const {
      proxyHost,
      proxyPort = 1080,
      destHost,
      destPort,
      userId = '',
      useSocks4a = true,
      timeout = 10000,
    } = body;

    // Validation
    if (!proxyHost) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Proxy host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!destHost) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Destination host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!destPort || destPort < 1 || destPort > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Valid destination port is required (1-65535)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (proxyPort < 1 || proxyPort > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Proxy port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Connect to SOCKS proxy server
    const socket = connect(`${proxyHost}:${proxyPort}`);

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      // Wait for connection with timeout
      await Promise.race([
        socket.opened,
        timeoutPromise,
      ]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Build and send SOCKS4 request
      const requestPacket = buildSocks4Request(destHost, destPort, userId, useSocks4a);
      await writer.write(requestPacket);

      // Read response (8 bytes)
      const { value: responseBytes } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (!responseBytes || responseBytes.length < 8) {
        throw new Error('No response or incomplete response from SOCKS proxy');
      }

      // Parse response
      const parsed = parseSocks4Response(responseBytes);

      // Clean up
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const result: Socks4Response = {
        success: true,
        granted: parsed.granted,
        responseCode: parsed.code,
        responseMessage: parsed.message,
        boundAddress: parsed.boundAddress,
        boundPort: parsed.boundPort,
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      // Connection or read error
      socket.close();
      throw error;
    }

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
