/**
 * MMS Protocol Implementation (Microsoft Media Server)
 *
 * Microsoft Media Server (MMS) is a proprietary streaming protocol developed
 * by Microsoft for Windows Media Services. It was the primary protocol for
 * streaming Windows Media Audio (WMA) and Windows Media Video (WMV) files
 * before HTTP-based streaming became dominant.
 *
 * Protocol Overview:
 * - Port: 1755 (TCP), 7007 (UDP variant - MMSU)
 * - Transport: TCP (MMST) or UDP (MMSU)
 * - Format: Binary protocol
 * - Variants: MMST (TCP), MMSU (UDP), MMSH (HTTP tunneling)
 *
 * Protocol Structure:
 * - Magic Header: 0x01 (protocol version)
 * - Command Code: Identifies request type
 * - Length Fields: Variable-length packets
 * - Payload: Command-specific data
 *
 * Common Commands:
 * - 0x01: Connect/Link request
 * - 0x02: Stream request
 * - 0x05: Start streaming
 * - 0x07: Stop streaming
 * - 0x15: Keepalive/ping
 * - 0x1E: Describe (get metadata)
 *
 * Server Response:
 * - 0x01: Connect response (server info, version)
 * - 0x05: Stream data packets
 * - 0x1E: Stream description (metadata)
 *
 * Connection Flow:
 * 1. Client → Server: Connect command (0x01)
 * 2. Server → Client: Connect response with server info
 * 3. Client → Server: Stream request (0x02)
 * 4. Server → Client: Stream response
 * 5. Client → Server: Start streaming (0x05)
 * 6. Server → Client: Media packets
 *
 * Header Format (simplified):
 * - Signature: 0x01 or MMS magic bytes
 * - Length: 2-4 bytes (packet length)
 * - Sequence: Packet sequence number
 * - Command: Command code
 * - Payload: Variable data
 *
 * Use Cases:
 * - Legacy Windows Media streaming detection
 * - Network forensics and traffic analysis
 * - Historical streaming protocol research
 * - Enterprise media server inventory
 *
 * Modern Alternatives:
 * - HTTP Live Streaming (HLS)
 * - MPEG-DASH
 * - Microsoft Smooth Streaming (HTTP-based)
 * - RTSP/RTP
 *
 * Note: MMS is largely deprecated but still found in legacy systems.
 */

import { connect } from 'cloudflare:sockets';

interface MMSRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface MMSResponse {
  success: boolean;
  host: string;
  port: number;
  serverVersion?: string;
  serverInfo?: string;
  commandCode?: number;
  commandName?: string;
  dataLength?: number;
  rtt?: number;
  error?: string;
}

// MMS Command Codes
enum MMSCommand {
  Connect = 0x01,
  StreamRequest = 0x02,
  StartStream = 0x05,
  StopStream = 0x07,
  Keepalive = 0x15,
  Describe = 0x1E,
}

/**
 * Build MMS Connect request packet
 * This is a simplified MMS connect - real MMS has more complex handshake
 */
function buildMMSConnect(): Buffer {
  // MMS Connect packet structure (simplified)
  // Real MMS protocol is more complex with GUIDs and capabilities
  const packet = Buffer.allocUnsafe(20);

  // Signature/Magic (simplified)
  packet.writeUInt8(0x01, 0); // Protocol version

  // Command code (Connect)
  packet.writeUInt8(MMSCommand.Connect, 1);

  // Length (big-endian)
  packet.writeUInt16BE(20, 2);

  // Sequence number
  packet.writeUInt32BE(0, 4);

  // Timestamp (placeholder)
  packet.writeUInt32BE(Date.now() & 0xFFFFFFFF, 8);

  // Flags and padding
  packet.fill(0, 12);

  return packet;
}

/**
 * Build MMS Describe request packet
 * Used to get stream metadata
 */
function buildMMSDescribe(): Buffer {
  const packet = Buffer.allocUnsafe(16);

  packet.writeUInt8(0x01, 0); // Protocol version
  packet.writeUInt8(MMSCommand.Describe, 1);
  packet.writeUInt16BE(16, 2);
  packet.writeUInt32BE(1, 4); // Sequence
  packet.fill(0, 8);

  return packet;
}

/**
 * Parse MMS response packet
 */
function parseMMSResponse(data: Buffer): {
  signature: number;
  commandCode: number;
  length: number;
  sequence?: number;
  isValidMMS: boolean;
} | null {
  if (data.length < 4) {
    return null;
  }

  const signature = data.readUInt8(0);

  // Check for MMS signature (0x01 is common, but there are variants)
  // Some servers use different magic bytes like 0x4D 0x4D 0x53 ("MMS")
  const isValidMMS = signature === 0x01 ||
    (data.length >= 3 && data.toString('ascii', 0, 3) === 'MMS');

  const commandCode = data.length > 1 ? data.readUInt8(1) : 0;
  const length = data.length >= 4 ? data.readUInt16BE(2) : data.length;
  const sequence = data.length >= 8 ? data.readUInt32BE(4) : undefined;

  return {
    signature,
    commandCode,
    length,
    sequence,
    isValidMMS,
  };
}

/**
 * Probe MMS server by attempting connection.
 * Detects Microsoft Media Server and basic protocol support.
 */
export async function handleMMSProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MMSRequest;
    const { host, port = 1755, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies MMSResponse), {
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
      } satisfies MMSResponse), {
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

      // Send MMS Connect request
      const connectRequest = buildMMSConnect();

      const writer = socket.writable.getWriter();
      await writer.write(connectRequest);
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
          error: 'No response from MMS server',
        } satisfies MMSResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parseMMSResponse(Buffer.from(value));

      if (!parsed || !parsed.isValidMMS) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid MMS response format',
        } satisfies MMSResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      // Map command code to name
      const commandNames: { [key: number]: string } = {
        [MMSCommand.Connect]: 'Connect',
        [MMSCommand.StreamRequest]: 'Stream Request',
        [MMSCommand.StartStream]: 'Start Stream',
        [MMSCommand.StopStream]: 'Stop Stream',
        [MMSCommand.Keepalive]: 'Keepalive',
        [MMSCommand.Describe]: 'Describe',
      };

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        commandCode: parsed.commandCode,
        commandName: commandNames[parsed.commandCode] || `Unknown (0x${parsed.commandCode.toString(16)})`,
        dataLength: parsed.length,
        rtt,
      } satisfies MMSResponse), {
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
      port: 1755,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies MMSResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Request stream description from MMS server.
 * Attempts to get metadata about available streams.
 */
export async function handleMMSDescribe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MMSRequest;
    const { host, port = 1755, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Send Connect then Describe
      const connectRequest = buildMMSConnect();
      const describeRequest = buildMMSDescribe();

      const writer = socket.writable.getWriter();
      await writer.write(connectRequest);
      await writer.write(describeRequest);
      writer.releaseLock();

      // Read responses
      const reader = socket.readable.getReader();

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      const maxResponseSize = 2000;

      try {
        while (totalBytes < maxResponseSize) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);

          if (done) break;

          if (value) {
            chunks.push(Buffer.from(value));
            totalBytes += value.length;

            // Stop after getting enough data
            if (chunks.length >= 2) break;
          }
        }
      } catch {
        // Connection closed or timeout (expected)
      }

      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: chunks.length > 0,
        host,
        port,
        message: chunks.length > 0 ? 'MMS server responded to describe' : 'No describe response',
        dataLength: totalBytes,
      }), {
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
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
