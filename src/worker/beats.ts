/**
 * Beats Protocol Implementation (Lumberjack v2)
 *
 * The Beats protocol (also known as Lumberjack) is a binary framing protocol
 * used by Elastic Beats (Filebeat, Metricbeat, Winlogbeat, etc.) to send
 * logs, metrics, and monitoring data to Logstash or Elasticsearch.
 *
 * Protocol Flow:
 * 1. Client sends WINDOW frame (protocol version + window size)
 * 2. Client sends DATA frames (compressed JSON events)
 * 3. Server responds with ACK frame (sequence number)
 * 4. Connection may be persistent for multiple batches
 *
 * Frame Types:
 * - Window ('2W'): Version + window size announcement
 * - Data ('2D'): Compressed JSON event data
 * - Compressed ('2C'): Zlib-compressed data batch
 * - JSON ('2J'): Uncompressed JSON event
 * - ACK ('2A'): Acknowledgment with sequence number
 *
 * Frame Format:
 * - Version (1 byte): '2'
 * - Frame Type (1 byte): 'W', 'D', 'C', 'J', 'A'
 * - Payload Length (4 bytes, big-endian)
 * - Payload (variable)
 *
 * Use Cases:
 * - Log shipping from servers to centralized logging
 * - Metrics collection and transmission
 * - Event data forwarding
 * - Security monitoring (Auditbeat, Packetbeat)
 * - Uptime monitoring (Heartbeat)
 */

import { connect } from 'cloudflare:sockets';

interface BeatsRequest {
  host: string;
  port?: number;
  events: Array<Record<string, unknown>>;
  windowSize?: number;
  timeout?: number;
}

interface BeatsResponse {
  success: boolean;
  host: string;
  port: number;
  acknowledged?: number;
  eventsSent?: number;
  rtt?: number;
  error?: string;
}

// Beats Protocol Constants
const BEATS_VERSION = 0x32; // '2' - Protocol version 2
const FRAME_TYPE = {
  WINDOW: 0x57, // 'W'
  DATA: 0x44,   // 'D'
  COMPRESSED: 0x43, // 'C'
  JSON: 0x4A,   // 'J'
  ACK: 0x41,    // 'A'
} as const;

/**
 * Encode a 32-bit unsigned integer as big-endian bytes.
 */
function encodeUint32BE(value: number): Uint8Array {
  const buffer = new Uint8Array(4);
  buffer[0] = (value >> 24) & 0xFF;
  buffer[1] = (value >> 16) & 0xFF;
  buffer[2] = (value >> 8) & 0xFF;
  buffer[3] = value & 0xFF;
  return buffer;
}

/**
 * Decode a 32-bit unsigned integer from big-endian bytes.
 */
function decodeUint32BE(buffer: Uint8Array, offset: number): number {
  return (
    ((buffer[offset] << 24) |
    (buffer[offset + 1] << 16) |
    (buffer[offset + 2] << 8) |
    buffer[offset + 3]) >>> 0
  );
}

/**
 * Encode Beats WINDOW frame.
 * Announces protocol version and window size (max events before ACK needed).
 */
function encodeWindowFrame(windowSize: number): Uint8Array {
  // Frame: Version + Type + WindowSize (4 bytes big-endian)
  const frame = new Uint8Array(6);
  frame[0] = BEATS_VERSION; // '2'
  frame[1] = FRAME_TYPE.WINDOW; // 'W'

  const windowBytes = encodeUint32BE(windowSize);
  frame.set(windowBytes, 2);

  return frame;
}

/**
 * Encode Beats JSON DATA frame.
 * Sends a single JSON event with sequence number.
 */
function encodeJsonFrame(sequenceNumber: number, event: Record<string, unknown>): Uint8Array {
  const jsonPayload = JSON.stringify(event);
  const jsonBytes = new TextEncoder().encode(jsonPayload);

  // Frame: Version + Type + SequenceNumber (4 bytes) + PayloadLength (4 bytes) + Payload
  const sequenceBytes = encodeUint32BE(sequenceNumber);
  const lengthBytes = encodeUint32BE(jsonBytes.length);

  const frame = new Uint8Array(2 + 4 + 4 + jsonBytes.length);
  frame[0] = BEATS_VERSION; // '2'
  frame[1] = FRAME_TYPE.JSON; // 'J'
  frame.set(sequenceBytes, 2);
  frame.set(lengthBytes, 6);
  frame.set(jsonBytes, 10);

  return frame;
}

/**
 * Parse Beats ACK frame.
 * Returns the sequence number acknowledged by the server.
 */
function parseAckFrame(data: Uint8Array): number | null {
  if (data.length < 6) {
    return null;
  }

  // Check frame header
  if (data[0] !== BEATS_VERSION || data[1] !== FRAME_TYPE.ACK) {
    return null;
  }

  // Extract sequence number
  const sequenceNumber = decodeUint32BE(data, 2);
  return sequenceNumber;
}

/**
 * Send events using the Beats protocol.
 */
export async function handleBeatsSend(request: Request): Promise<Response> {
  try {
    const body = await request.json() as BeatsRequest;
    const {
      host,
      port = 5044,
      events,
      windowSize = 1000,
      timeout = 15000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies BeatsResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!events || !Array.isArray(events) || events.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Events array is required and must not be empty',
      } satisfies BeatsResponse), {
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
      } satisfies BeatsResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Connect to Beats/Logstash server
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send WINDOW frame
      const windowFrame = encodeWindowFrame(windowSize);
      await writer.write(windowFrame);

      // Send JSON DATA frames for each event
      let sequenceNumber = 1;
      for (const event of events) {
        const jsonFrame = encodeJsonFrame(sequenceNumber, event);
        await writer.write(jsonFrame);
        sequenceNumber++;
      }

      writer.releaseLock();

      // Read ACK frame
      const readTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('ACK timeout')), timeout);
      });

      const { value: ackData, done } = await Promise.race([
        reader.read(),
        readTimeout,
      ]);

      if (done || !ackData) {
        throw new Error('No ACK received from server');
      }

      // Parse ACK
      const acknowledgedSeq = parseAckFrame(ackData);

      if (acknowledgedSeq === null) {
        throw new Error('Invalid ACK frame received');
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      // Check if all events were acknowledged
      const expectedSeq = events.length;
      const allAcknowledged = acknowledgedSeq >= expectedSeq;

      return new Response(JSON.stringify({
        success: allAcknowledged,
        host,
        port,
        acknowledged: acknowledgedSeq,
        eventsSent: events.length,
        rtt,
      } satisfies BeatsResponse), {
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
      port: 5044,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies BeatsResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

interface BeatsTLSResponse {
  tls: boolean;
  host: string;
  port: number;
  events?: number;
  acked?: boolean;
  sequenceAcked?: number;
  rtt?: number;
  error?: string;
}

/**
 * Send events using the Beats/Lumberjack v2 protocol over TLS.
 *
 * Identical to handleBeatsSend but establishes a TLS connection using
 * secureTransport: 'on' in the Cloudflare socket connect() call.
 * Default port is 5045 (conventional TLS Beats port).
 */
export async function handleBeatsTLS(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      events: Array<Record<string, string>>;
      windowSize?: number;
    };

    const {
      host,
      port = 5045,
      timeout = 15000,
      events,
      windowSize = 1000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        tls: true,
        host: '',
        port,
        error: 'Host is required',
      } satisfies BeatsTLSResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!events || !Array.isArray(events) || events.length === 0) {
      return new Response(JSON.stringify({
        tls: true,
        host,
        port,
        error: 'Events array is required and must not be empty',
      } satisfies BeatsTLSResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        tls: true,
        host,
        port,
        error: 'Port must be between 1 and 65535',
      } satisfies BeatsTLSResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Connect with TLS enabled
    const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send WINDOW frame
      const windowFrame = encodeWindowFrame(windowSize);
      await writer.write(windowFrame);

      // Send JSON DATA frames for each event
      let sequenceNumber = 1;
      for (const event of events) {
        const jsonFrame = encodeJsonFrame(sequenceNumber, event as Record<string, unknown>);
        await writer.write(jsonFrame);
        sequenceNumber++;
      }

      writer.releaseLock();

      // Read ACK frame
      const readTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('ACK timeout')), timeout);
      });

      const { value: ackData, done } = await Promise.race([
        reader.read(),
        readTimeout,
      ]);

      if (done || !ackData) {
        throw new Error('No ACK received from server');
      }

      const acknowledgedSeq = parseAckFrame(ackData);

      if (acknowledgedSeq === null) {
        throw new Error('Invalid ACK frame received');
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      const expectedSeq = events.length;
      const allAcknowledged = acknowledgedSeq >= expectedSeq;

      return new Response(JSON.stringify({
        tls: true,
        host,
        port,
        events: events.length,
        acked: allAcknowledged,
        sequenceAcked: acknowledgedSeq,
        rtt,
      } satisfies BeatsTLSResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      tls: true,
      host: '',
      port: 5045,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies BeatsTLSResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Test Beats connection by sending a ping-like event.
 */
export async function handleBeatsConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 5044, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    // Connect to Beats server
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const rtt = Date.now() - start;

      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        message: 'Beats connection successful',
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
