/**
 * YMSG Protocol Implementation (Yahoo Messenger)
 *
 * Yahoo Messenger Protocol (YMSG) was the protocol used by Yahoo! Messenger
 * for instant messaging. The service was shut down in 2018, but the protocol
 * remains of historical interest for IM protocol research.
 *
 * Protocol Overview:
 * - Ports: 5050 (primary), 5101 (alternate)
 * - Format: Binary protocol with 20-byte header + key-value pairs
 * - Versions: YMSG9 through YMSG16 (16 was final)
 * - Authentication: Yahoo! ID password or OAuth
 *
 * Packet Structure:
 * - Header (20 bytes):
 *   - Magic: "YMSG" (4 bytes)
 *   - Version: Protocol version (2 bytes)
 *   - Vendor ID: Usually 0 (2 bytes)
 *   - Length: Payload length (2 bytes)
 *   - Service: Command code (2 bytes)
 *   - Status: Status code (4 bytes)
 *   - Session ID: Unique session (4 bytes)
 *
 * - Payload: Key-value pairs separated by 0xC080
 *   - Format: key<0xC080>value<0xC080>key<0xC080>value...
 *
 * Service Codes:
 * - 0x01: Login
 * - 0x02: Logout
 * - 0x06: Message
 * - 0x12: Ping/Keepalive
 * - 0x4B: Auth request
 * - 0x54: Login v2
 * - 0x84: List
 *
 * Common Keys:
 * - 0: Username
 * - 1: Online status
 * - 5: Message sender
 * - 14: Message text
 * - 97: UTF-8 flag
 * - 244: Captcha
 *
 * Use Cases:
 * - Legacy Yahoo Messenger detection
 * - IM protocol archaeology
 * - Historical protocol research
 */

import { connect } from 'cloudflare:sockets';

interface YMSGRequest {
  host: string;
  port?: number;
  timeout?: number;
  version?: number;
}

interface YMSGResponse {
  success: boolean;
  host: string;
  port: number;
  version?: number;
  service?: number;
  serviceName?: string;
  status?: number;
  sessionId?: number;
  payloadLength?: number;
  rtt?: number;
  error?: string;
}

// YMSG Service Codes
enum YMSGService {
  Login = 0x01,
  Logout = 0x02,
  IsAway = 0x03,
  IsBack = 0x04,
  Idle = 0x05,
  Message = 0x06,
  IdAct = 0x07,
  IdDeact = 0x08,
  MailStat = 0x09,
  UserStat = 0x0A,
  NewMail = 0x0B,
  ChatOnline = 0x0D,
  ChatGoto = 0x0E,
  ChatJoin = 0x0F,
  Ping = 0x12,
  GameLogon = 0x28,
  GameLogoff = 0x29,
  GameMsg = 0x2A,
  AuthReq = 0x4B,
  AuthResp = 0x54,
  List = 0x84,
  AddBuddy = 0x83,
  RemBuddy = 0x84,
}

/**
 * Build YMSG packet header
 */
function buildYMSGHeader(
  version: number,
  vendorId: number,
  payloadLength: number,
  service: number,
  status: number,
  sessionId: number
): Buffer {
  const header = Buffer.allocUnsafe(20);

  // Magic "YMSG"
  header.write('YMSG', 0, 'ascii');

  // Version (big-endian uint16)
  header.writeUInt16BE(version, 4);

  // Vendor ID (big-endian uint16)
  header.writeUInt16BE(vendorId, 6);

  // Payload Length (big-endian uint16)
  header.writeUInt16BE(payloadLength, 8);

  // Service Code (big-endian uint16)
  header.writeUInt16BE(service, 10);

  // Status (big-endian uint32)
  header.writeUInt32BE(status, 12);

  // Session ID (big-endian uint32)
  header.writeUInt32BE(sessionId, 16);

  return header;
}

/**
 * Build YMSG ping packet
 */
function buildYMSGPing(version: number = 16): Buffer {
  // Ping has no payload, just header
  return buildYMSGHeader(
    version,    // Version
    0,          // Vendor ID
    0,          // Payload length
    YMSGService.Ping,  // Service code (ping)
    0,          // Status
    0           // Session ID
  );
}

/**
 * Parse YMSG packet header
 */
function parseYMSGHeader(data: Buffer): {
  magic: string;
  version: number;
  vendorId: number;
  payloadLength: number;
  service: number;
  status: number;
  sessionId: number;
} | null {
  if (data.length < 20) {
    return null;
  }

  const magic = data.toString('ascii', 0, 4);

  if (magic !== 'YMSG') {
    return null;
  }

  return {
    magic,
    version: data.readUInt16BE(4),
    vendorId: data.readUInt16BE(6),
    payloadLength: data.readUInt16BE(8),
    service: data.readUInt16BE(10),
    status: data.readUInt32BE(12),
    sessionId: data.readUInt32BE(16),
  };
}

/**
 * Probe Yahoo Messenger server by sending ping.
 * Detects YMSG server and version.
 */
export async function handleYMSGProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as YMSGRequest;
    const { host, port = 5050, timeout = 15000, version = 16 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies YMSGResponse), {
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
      } satisfies YMSGResponse), {
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

      // Build and send YMSG ping
      const ping = buildYMSGPing(version);

      const writer = socket.writable.getWriter();
      await writer.write(ping);
      writer.releaseLock();

      // Read response
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
          error: 'No response from YMSG server',
        } satisfies YMSGResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parseYMSGHeader(Buffer.from(value));

      if (!parsed) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid YMSG packet format',
        } satisfies YMSGResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      // Map service code to name
      const serviceNames: { [key: number]: string } = {
        [YMSGService.Login]: 'Login',
        [YMSGService.Logout]: 'Logout',
        [YMSGService.Message]: 'Message',
        [YMSGService.Ping]: 'Ping',
        [YMSGService.AuthReq]: 'Auth Request',
        [YMSGService.AuthResp]: 'Auth Response',
        [YMSGService.List]: 'List',
      };

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        version: parsed.version,
        service: parsed.service,
        serviceName: serviceNames[parsed.service] || `Unknown (0x${parsed.service.toString(16)})`,
        status: parsed.status,
        sessionId: parsed.sessionId,
        payloadLength: parsed.payloadLength,
        rtt,
      } satisfies YMSGResponse), {
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
      port: 5050,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies YMSGResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Detect Yahoo Messenger server version.
 * Tests multiple YMSG versions to find supported one.
 */
export async function handleYMSGVersionDetect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as YMSGRequest;
    const { host, port = 5050, timeout = 10000 } = body;

    // Try common versions: 16, 15, 13, 11, 10, 9
    const versions = [16, 15, 13, 11, 10, 9];

    for (const version of versions) {
      const probeRequest = new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify({ host, port, timeout, version }),
      });

      const response = await handleYMSGProbe(probeRequest);
      const data = await response.json() as YMSGResponse;

      if (data.success) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { success: _success, host: _host, port: _port, ...rest } = data;
        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          detectedVersion: version,
          ...rest,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      error: 'No supported YMSG version detected',
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
