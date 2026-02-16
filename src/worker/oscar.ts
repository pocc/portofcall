/**
 * OSCAR Protocol Implementation (AOL Instant Messenger / ICQ)
 *
 * Open System for CommunicAtion in Realtime (OSCAR) was the protocol used by
 * AOL Instant Messenger (AIM) and ICQ for instant messaging. AIM was shut down
 * in 2017, but ICQ continued (now discontinued in 2024).
 *
 * Protocol Overview:
 * - Port: 5190 (TCP)
 * - Format: Binary FLAP (Frame Layer Protocol) + SNAC (Service-specific commands)
 * - Authentication: MD5 password hash or OAuth
 * - Versions: Multiple, with different SNAC families
 *
 * FLAP Frame Structure (6-byte header):
 * - Start Byte: 0x2A (asterisk '*')
 * - Frame Type/Channel (1 byte): 1=Signon, 2=SNAC, 3=Error, 4=Close, 5=Keepalive
 * - Sequence Number (2 bytes): Incrementing frame number
 * - Data Length (2 bytes): Length of frame data
 * - Data (variable): Payload
 *
 * SNAC Structure (10-byte header + data):
 * - Family ID (2 bytes): Service family (0x01=Generic, 0x02=Location, etc.)
 * - Subtype ID (2 bytes): Command within family
 * - Flags (2 bytes): SNAC flags
 * - Request ID (4 bytes): Request identifier
 * - Data (variable): SNAC-specific data
 *
 * FLAP Channels:
 * - 0x01: Signon/negotiation
 * - 0x02: SNAC data
 * - 0x03: Error
 * - 0x04: Close connection
 * - 0x05: Keepalive/ping
 *
 * Common SNAC Families:
 * - 0x0001: Generic service
 * - 0x0002: Location services
 * - 0x0003: Buddy list
 * - 0x0004: ICBM (messaging)
 * - 0x0013: SSI (server-stored info)
 * - 0x0017: Authorization/registration
 *
 * Use Cases:
 * - Legacy AIM/ICQ server detection
 * - IM protocol archaeology
 * - Historical protocol research
 */

import { connect } from 'cloudflare:sockets';

interface OSCARRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface OSCARResponse {
  success: boolean;
  host: string;
  port: number;
  channel?: number;
  channelName?: string;
  sequence?: number;
  dataLength?: number;
  rtt?: number;
  error?: string;
}

// FLAP Channel Types
enum FLAPChannel {
  Signon = 0x01,
  SNAC = 0x02,
  Error = 0x03,
  Close = 0x04,
  Keepalive = 0x05,
}

/**
 * Build FLAP frame header
 */
function buildFLAPFrame(channel: number, sequence: number, data: Buffer): Buffer {
  const header = Buffer.allocUnsafe(6);

  // Start byte (asterisk '*' = 0x2A)
  header.writeUInt8(0x2A, 0);

  // Channel/Frame type
  header.writeUInt8(channel, 1);

  // Sequence number (big-endian)
  header.writeUInt16BE(sequence, 2);

  // Data length (big-endian)
  header.writeUInt16BE(data.length, 4);

  return Buffer.concat([header, data]);
}

/**
 * Build OSCAR signon frame (FLAP channel 1)
 */
function buildOSCARSignon(): Buffer {
  // Signon data: Version (4 bytes)
  // Use version 1 for basic probe
  const signonData = Buffer.allocUnsafe(4);
  signonData.writeUInt32BE(0x00000001, 0);

  return buildFLAPFrame(FLAPChannel.Signon, 0, signonData);
}

/**
 * Parse FLAP frame header
 */
function parseFLAPFrame(data: Buffer): {
  startByte: number;
  channel: number;
  sequence: number;
  dataLength: number;
  data: Buffer;
} | null {
  if (data.length < 6) {
    return null;
  }

  const startByte = data.readUInt8(0);

  // Verify start byte is 0x2A (asterisk)
  if (startByte !== 0x2A) {
    return null;
  }

  const channel = data.readUInt8(1);
  const sequence = data.readUInt16BE(2);
  const dataLength = data.readUInt16BE(4);

  // Extract data (may be less than dataLength if packet is fragmented)
  const frameData = data.subarray(6, Math.min(6 + dataLength, data.length));

  return {
    startByte,
    channel,
    sequence,
    dataLength,
    data: frameData,
  };
}

/**
 * Probe OSCAR server by sending signon frame.
 * Detects AIM/ICQ server and protocol support.
 */
export async function handleOSCARProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as OSCARRequest;
    const { host, port = 5190, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies OSCARResponse), {
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
      } satisfies OSCARResponse), {
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

      // Build and send OSCAR signon frame
      const signon = buildOSCARSignon();

      const writer = socket.writable.getWriter();
      await writer.write(signon);
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
          error: 'No response from OSCAR server',
        } satisfies OSCARResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parseFLAPFrame(Buffer.from(value));

      if (!parsed) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid FLAP frame format',
        } satisfies OSCARResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      // Map channel to name
      const channelNames: { [key: number]: string } = {
        [FLAPChannel.Signon]: 'Signon',
        [FLAPChannel.SNAC]: 'SNAC Data',
        [FLAPChannel.Error]: 'Error',
        [FLAPChannel.Close]: 'Close',
        [FLAPChannel.Keepalive]: 'Keepalive',
      };

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        channel: parsed.channel,
        channelName: channelNames[parsed.channel] || `Unknown (0x${parsed.channel.toString(16)})`,
        sequence: parsed.sequence,
        dataLength: parsed.dataLength,
        rtt,
      } satisfies OSCARResponse), {
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
      port: 5190,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies OSCARResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Test OSCAR server capabilities.
 * Sends keepalive ping to test server responsiveness.
 */
export async function handleOSCARPing(request: Request): Promise<Response> {
  try {
    const body = await request.json() as OSCARRequest;
    const { host, port = 5190, timeout = 10000 } = body;

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

      // First send signon, then keepalive
      const signon = buildOSCARSignon();
      const keepalive = buildFLAPFrame(FLAPChannel.Keepalive, 1, Buffer.alloc(0));

      const writer = socket.writable.getWriter();
      await writer.write(signon);
      await writer.write(keepalive);
      writer.releaseLock();

      // Read responses
      const reader = socket.readable.getReader();

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      const maxResponseSize = 1000;

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

            // Stop after getting responses
            if (chunks.length >= 2) break;
          }
        }
      } catch {
        // Connection closed (expected)
      }

      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: chunks.length > 0,
        host,
        port,
        message: chunks.length > 0 ? 'OSCAR server responded to ping' : 'No ping response',
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
