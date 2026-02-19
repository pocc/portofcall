/**
 * NSQ TCP Protocol Support for Cloudflare Workers
 *
 * NSQ is a realtime distributed messaging platform designed for
 * operating at scale. Used by Docker, Stripe, Segment, and others.
 *
 * Protocol:
 *   Client -> Server: "  V2" (4-byte magic preamble)
 *   Client -> Server: IDENTIFY\n{json}\n
 *   Server -> Client: [size:4][frame_type:4][data]
 *
 * Frame types:
 *   0 = FrameTypeResponse (OK, _heartbeat_, etc.)
 *   1 = FrameTypeError
 *   2 = FrameTypeMessage
 *
 * Commands:
 *   IDENTIFY - Client metadata and feature negotiation
 *   SUB topic channel - Subscribe to a topic
 *   PUB topic\n[size:4][data] - Publish a message
 *   NOP - No operation (keepalive)
 *   CLS - Close connection gracefully
 *
 * Default port: 4150 (TCP), 4151 (HTTP API)
 *
 * Use Cases:
 *   - nsqd health checking
 *   - Message publishing to topics
 *   - Server version and feature detection
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const NSQ_MAGIC_V2 = '  V2'; // Two spaces + "V2"

/**
 * Read a framed response from nsqd
 * Frame format: [size:4 bytes big-endian][frame_type:4 bytes big-endian][data]
 *
 * Returns both raw bytes and text-decoded data. For FrameTypeResponse (0) and
 * FrameTypeError (1), the text `data` field is authoritative. For
 * FrameTypeMessage (2), callers MUST use the `rawData` bytes because the
 * message frame contains binary fields (timestamp, attempts, message ID) that
 * are corrupted by UTF-8 text decoding.
 */
async function readFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number,
): Promise<{ frameType: number; data: string; rawData: Uint8Array }> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Read timeout')), timeout);
  });

  const readPromise = (async () => {
    // Read enough bytes for the frame header (8 bytes: 4-byte size + 4-byte frame_type)
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const maxSize = 64 * 1024; // 64KB max

    while (totalBytes < 8) {
      const { value, done } = await reader.read();
      if (done || !value) throw new Error('Connection closed before frame header');
      chunks.push(value);
      totalBytes += value.length;
    }

    // Combine all chunks into a single buffer
    const buffer = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Parse size (4 bytes big-endian) - includes frame_type + data
    const view = new DataView(buffer.buffer, buffer.byteOffset);
    const size = view.getInt32(0, false); // big-endian

    if (size < 4 || size > maxSize) {
      throw new Error(`Invalid frame size: ${size}`);
    }

    // Parse frame type (4 bytes big-endian)
    const frameType = view.getInt32(4, false);

    // Calculate how many data bytes we need beyond the header
    const neededBytes = size - 4; // size field includes frame_type (4) + data (size-4)
    let dataBytes = totalBytes - 8; // bytes we already have past the 8-byte header

    while (dataBytes < neededBytes) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      dataBytes += value.length;
      totalBytes += value.length;
    }

    // Recombine all chunks
    const fullBuffer = new Uint8Array(totalBytes);
    let off = 0;
    for (const chunk of chunks) {
      fullBuffer.set(chunk, off);
      off += chunk.length;
    }

    // Extract raw data portion (after 4-byte size + 4-byte frame_type)
    const rawData = fullBuffer.slice(8, 8 + neededBytes);
    // Text decode is safe for FrameTypeResponse and FrameTypeError; lossy for FrameTypeMessage
    const data = new TextDecoder().decode(rawData);

    return { frameType, data, rawData };
  })();

  try {
    const result = await Promise.race([readPromise, timeoutPromise]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    return result;
  } catch (error) {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Parse an NSQ message from the raw bytes of a FrameTypeMessage frame.
 *
 * Wire format: [timestamp:8 BE int64][attempts:2 BE uint16][messageId:16 bytes][body...]
 *
 * The 16-byte message ID is hex-encoded by nsqd, so the raw bytes are printable
 * ASCII hex characters. We decode them as-is (they are valid UTF-8/ASCII).
 */
function parseNSQMessage(raw: Uint8Array): {
  timestamp: bigint;
  attempts: number;
  messageId: string;
  body: string;
} | null {
  // Minimum message size: 8 (timestamp) + 2 (attempts) + 16 (message ID) = 26 bytes
  if (raw.length < 26) return null;

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

  // 8-byte nanosecond timestamp (int64 big-endian)
  const timestamp = view.getBigInt64(0, false);

  // 2-byte attempt count (uint16 big-endian)
  const attempts = view.getUint16(8, false);

  // 16-byte message ID (hex-encoded ASCII bytes)
  const messageId = new TextDecoder().decode(raw.slice(10, 26));

  // Remaining bytes are the message body
  const body = new TextDecoder().decode(raw.slice(26));

  return { timestamp, attempts, messageId, body };
}

/**
 * Handle NSQ connection test (HTTP mode)
 * Connects with V2 magic, sends IDENTIFY, reads response
 */
export async function handleNSQConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 4150, timeout = 10000 } = body;

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: Send V2 magic preamble
        await writer.write(new TextEncoder().encode(NSQ_MAGIC_V2));

        // Step 2: Send IDENTIFY with client metadata
        const identifyPayload = JSON.stringify({
          client_id: 'portofcall',
          hostname: 'portofcall.ross.gg',
          user_agent: 'portofcall/1.0',
          feature_negotiation: true,
        });
        const identifyBytes = new TextEncoder().encode(identifyPayload);

        // IDENTIFY command format: "IDENTIFY\n" + [4-byte big-endian size] + [json body]
        const identifyCmd = new TextEncoder().encode('IDENTIFY\n');
        const sizeBytes = new Uint8Array(4);
        new DataView(sizeBytes.buffer).setInt32(0, identifyBytes.length, false);

        const identifyFrame = new Uint8Array(identifyCmd.length + sizeBytes.length + identifyBytes.length);
        identifyFrame.set(identifyCmd);
        identifyFrame.set(sizeBytes, identifyCmd.length);
        identifyFrame.set(identifyBytes, identifyCmd.length + sizeBytes.length);
        await writer.write(identifyFrame);

        // Step 3: Read server response
        const response = await readFrame(reader, 5000);

        let serverInfo: Record<string, unknown> = {};
        if (response.frameType === 0) {
          // FrameTypeResponse - try to parse as JSON (IDENTIFY returns JSON when feature_negotiation=true)
          try {
            serverInfo = JSON.parse(response.data);
          } catch {
            // Plain text response like "OK"
            serverInfo = { response: response.data };
          }
        } else if (response.frameType === 1) {
          // FrameTypeError
          throw new Error(`NSQ error: ${response.data}`);
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const rtt = Date.now() - startTime;

        return {
          success: true,
          host,
          port,
          rtt,
          serverInfo: {
            version: serverInfo.version || undefined,
            maxRdyCount: serverInfo.max_rdy_count || undefined,
            maxMsgTimeout: serverInfo.max_msg_timeout || undefined,
            msgTimeout: serverInfo.msg_timeout || undefined,
            tlsRequired: serverInfo.tls_v1 || false,
            deflate: serverInfo.deflate || false,
            snappy: serverInfo.snappy || false,
            authRequired: serverInfo.auth_required || false,
            maxDeflateLevel: serverInfo.max_deflate_level || undefined,
            sampleRate: serverInfo.sample_rate || undefined,
          },
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
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

/**
 * Handle NSQ message publish
 * Connects, authenticates, publishes a message to a topic
 */
export async function handleNSQPublish(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      topic: string;
      message?: string;
      timeout?: number;
    };

    if (!body.host || !body.topic) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameters: host and topic',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate topic name (alphanumeric, dots, underscores, hyphens, 1-64 chars)
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(body.topic)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid topic name. Must be 1-64 chars: alphanumeric, dots, underscores, hyphens.',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port || 4150;
    const timeout = body.timeout || 10000;
    const message = body.message || '';

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send V2 magic
        await writer.write(new TextEncoder().encode(NSQ_MAGIC_V2));

        // Send IDENTIFY (minimal, no feature negotiation)
        const identifyPayload = JSON.stringify({
          client_id: 'portofcall',
          hostname: 'portofcall.ross.gg',
        });
        const identifyBytes = new TextEncoder().encode(identifyPayload);
        const identifyCmd = new TextEncoder().encode('IDENTIFY\n');
        const sizeBytes = new Uint8Array(4);
        new DataView(sizeBytes.buffer).setInt32(0, identifyBytes.length, false);

        const identifyFrame = new Uint8Array(identifyCmd.length + sizeBytes.length + identifyBytes.length);
        identifyFrame.set(identifyCmd);
        identifyFrame.set(sizeBytes, identifyCmd.length);
        identifyFrame.set(identifyBytes, identifyCmd.length + sizeBytes.length);
        await writer.write(identifyFrame);

        // Read IDENTIFY response
        const identifyResp = await readFrame(reader, 5000);
        if (identifyResp.frameType === 1) {
          throw new Error(`NSQ IDENTIFY error: ${identifyResp.data}`);
        }

        // Send PUB command
        // Format: "PUB <topic>\n" + [4-byte big-endian message size] + [message body]
        const msgBytes = new TextEncoder().encode(message);
        const pubCmd = new TextEncoder().encode(`PUB ${body.topic}\n`);
        const msgSizeBytes = new Uint8Array(4);
        new DataView(msgSizeBytes.buffer).setInt32(0, msgBytes.length, false);

        const pubFrame = new Uint8Array(pubCmd.length + msgSizeBytes.length + msgBytes.length);
        pubFrame.set(pubCmd);
        pubFrame.set(msgSizeBytes, pubCmd.length);
        pubFrame.set(msgBytes, pubCmd.length + msgSizeBytes.length);
        await writer.write(pubFrame);

        // Read PUB response
        const pubResp = await readFrame(reader, 5000);

        if (pubResp.frameType === 1) {
          throw new Error(`NSQ PUB error: ${pubResp.data}`);
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          message: `Published to topic "${body.topic}"`,
          topic: body.topic,
          messageSize: msgBytes.length,
          response: pubResp.data,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Publish failed',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
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

/**
 * Handle NSQ subscribe — connect, SUB a topic/channel, collect messages
 */
export async function handleNSQSubscribe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      topic: string;
      channel?: string;
      max_messages?: number;
      collect_ms?: number;
      timeout?: number;
    };

    if (!body.host || !body.topic) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, topic' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(body.topic)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid topic name' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port || 4150;
    const channel = body.channel || 'portofcall';

    // Validate channel name (same rules as topic)
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(channel)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid channel name' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const maxMessages = body.max_messages || 10;
    const collectMs = body.collect_ms || 2000;
    const timeout = body.timeout || 15000;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send V2 magic + IDENTIFY
        await writer.write(new TextEncoder().encode(NSQ_MAGIC_V2));

        const identifyPayload = JSON.stringify({ client_id: 'portofcall', hostname: 'portofcall.ross.gg' });
        const identifyBytes = new TextEncoder().encode(identifyPayload);
        const identifyCmd = new TextEncoder().encode('IDENTIFY\n');
        const sizeBuf = new Uint8Array(4);
        new DataView(sizeBuf.buffer).setInt32(0, identifyBytes.length, false);
        const identifyFrame = new Uint8Array(identifyCmd.length + sizeBuf.length + identifyBytes.length);
        identifyFrame.set(identifyCmd); identifyFrame.set(sizeBuf, identifyCmd.length);
        identifyFrame.set(identifyBytes, identifyCmd.length + sizeBuf.length);
        await writer.write(identifyFrame);

        // Read IDENTIFY response
        const identifyResp = await readFrame(reader, 5000);
        if (identifyResp.frameType === 1) throw new Error(`NSQ IDENTIFY error: ${identifyResp.data}`);

        // Send SUB topic channel
        await writer.write(new TextEncoder().encode(`SUB ${body.topic} ${channel}\n`));
        const subResp = await readFrame(reader, 5000);
        if (subResp.frameType === 1) throw new Error(`NSQ SUB error: ${subResp.data}`);

        // Send RDY 1 to start receiving messages
        await writer.write(new TextEncoder().encode(`RDY ${maxMessages}\n`));

        // Collect messages for collectMs duration
        const messages: { messageId: string; attempts: number; body: string; timestamp: number }[] = [];
        const collectEnd = Date.now() + collectMs;

        while (Date.now() < collectEnd && messages.length < maxMessages) {
          const remaining = collectEnd - Date.now();
          if (remaining <= 0) break;

          try {
            const frame = await readFrame(reader, Math.min(remaining, 1000));

            if (frame.frameType === 0) {
              // FrameTypeResponse — could be _heartbeat_
              if (frame.data === '_heartbeat_') {
                await writer.write(new TextEncoder().encode('NOP\n'));
              }
            } else if (frame.frameType === 2) {
              // FrameTypeMessage — MUST use rawData, not text-decoded data
              const parsed = parseNSQMessage(frame.rawData);
              if (parsed) {
                messages.push({
                  messageId: parsed.messageId,
                  attempts: parsed.attempts,
                  body: parsed.body,
                  timestamp: Number(parsed.timestamp / BigInt(1000000)), // Convert nanoseconds to milliseconds
                });
                // FIN to acknowledge
                await writer.write(new TextEncoder().encode(`FIN ${parsed.messageId}\n`));
              }
            }
          } catch {
            // Timeout collecting — that's fine
            break;
          }
        }

        // Send CLS to close gracefully
        await writer.write(new TextEncoder().encode('CLS\n'));

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          host,
          port,
          topic: body.topic,
          channel,
          messageCount: messages.length,
          messages: messages.slice(0, 10),
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Subscribe failed' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle NSQ deferred publish — publish a message to a topic with a delay (DPUB)
 *
 * POST /api/nsq/dpub
 * Body: { host, port?, topic, message, defer_time_ms, timeout? }
 * defer_time_ms: milliseconds to delay before delivery (1-3600000)
 */
export async function handleNSQDeferredPublish(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      topic: string;
      message: string;
      defer_time_ms: number;
      timeout?: number;
    };

    if (!body.host || !body.topic || !body.message || body.defer_time_ms === undefined) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, topic, message, defer_time_ms' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(body.topic)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid topic name' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const deferMs = Math.max(0, Math.min(3600000, Math.floor(body.defer_time_ms)));
    const host = body.host;
    const port = body.port || 4150;
    const timeout = body.timeout || 10000;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send V2 magic + IDENTIFY
        await writer.write(new TextEncoder().encode(NSQ_MAGIC_V2));

        const identifyPayload = JSON.stringify({ client_id: 'portofcall', hostname: 'portofcall.ross.gg' });
        const identifyBytes = new TextEncoder().encode(identifyPayload);
        const identifyCmd = new TextEncoder().encode('IDENTIFY\n');
        const idSizeBuf = new Uint8Array(4);
        new DataView(idSizeBuf.buffer).setInt32(0, identifyBytes.length, false);
        const identifyFrame = new Uint8Array(identifyCmd.length + idSizeBuf.length + identifyBytes.length);
        identifyFrame.set(identifyCmd); identifyFrame.set(idSizeBuf, identifyCmd.length);
        identifyFrame.set(identifyBytes, identifyCmd.length + idSizeBuf.length);
        await writer.write(identifyFrame);

        const identifyResp = await readFrame(reader, 5000);
        if (identifyResp.frameType === 1) throw new Error(`NSQ IDENTIFY error: ${identifyResp.data}`);

        // Build DPUB command: "DPUB <topic> <defer_time_ms>\n" + [4B size][message]
        const enc = new TextEncoder();
        const msgBytes = enc.encode(body.message);
        const dpubCmd = enc.encode(`DPUB ${body.topic} ${deferMs}\n`);
        const msgSize = new Uint8Array(4);
        new DataView(msgSize.buffer).setInt32(0, msgBytes.length, false);

        const dpubFrame = new Uint8Array(dpubCmd.length + 4 + msgBytes.length);
        let off = 0;
        dpubFrame.set(dpubCmd, off); off += dpubCmd.length;
        dpubFrame.set(msgSize, off); off += 4;
        dpubFrame.set(msgBytes, off);

        await writer.write(dpubFrame);

        const dpubResp = await readFrame(reader, 5000);
        if (dpubResp.frameType === 1) throw new Error(`NSQ DPUB error: ${dpubResp.data}`);

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          host,
          port,
          topic: body.topic,
          deferMs,
          messageBytes: msgBytes.length,
          response: dpubResp.data,
          message: `Message queued for delivery to '${body.topic}' after ${deferMs}ms`,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Deferred publish failed' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle NSQ multi-publish — atomically publish multiple messages to a topic (MPUB)
 */
export async function handleNSQMultiPublish(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      topic: string;
      messages: string[];
      timeout?: number;
    };

    if (!body.host || !body.topic || !Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required: host, topic, messages[]' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(body.topic)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid topic name' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (body.messages.length > 100) {
      return new Response(JSON.stringify({ success: false, error: 'Maximum 100 messages per MPUB' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port || 4150;
    const timeout = body.timeout || 10000;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send V2 magic + IDENTIFY
        await writer.write(new TextEncoder().encode(NSQ_MAGIC_V2));

        const identifyPayload = JSON.stringify({ client_id: 'portofcall', hostname: 'portofcall.ross.gg' });
        const identifyBytes = new TextEncoder().encode(identifyPayload);
        const identifyCmd = new TextEncoder().encode('IDENTIFY\n');
        const idSizeBuf = new Uint8Array(4);
        new DataView(idSizeBuf.buffer).setInt32(0, identifyBytes.length, false);
        const identifyFrame = new Uint8Array(identifyCmd.length + idSizeBuf.length + identifyBytes.length);
        identifyFrame.set(identifyCmd); identifyFrame.set(idSizeBuf, identifyCmd.length);
        identifyFrame.set(identifyBytes, identifyCmd.length + idSizeBuf.length);
        await writer.write(identifyFrame);

        const identifyResp = await readFrame(reader, 5000);
        if (identifyResp.frameType === 1) throw new Error(`NSQ IDENTIFY error: ${identifyResp.data}`);

        // Build MPUB body: [4B num_messages][for each: [4B msg_size][msg_bytes]]
        const enc = new TextEncoder();
        const encodedMsgs = body.messages.map(m => enc.encode(m));
        const totalBodySize = 4 + encodedMsgs.reduce((sum, m) => sum + 4 + m.length, 0);

        const mpubCmd = enc.encode(`MPUB ${body.topic}\n`);
        const outerSize = new Uint8Array(4);
        new DataView(outerSize.buffer).setInt32(0, totalBodySize, false);
        const numMsgs = new Uint8Array(4);
        new DataView(numMsgs.buffer).setInt32(0, encodedMsgs.length, false);

        const mpubFrame = new Uint8Array(mpubCmd.length + 4 + totalBodySize);
        let off = 0;
        mpubFrame.set(mpubCmd, off); off += mpubCmd.length;
        mpubFrame.set(outerSize, off); off += 4;
        mpubFrame.set(numMsgs, off); off += 4;

        for (const msgBytes of encodedMsgs) {
          const msgSize = new Uint8Array(4);
          new DataView(msgSize.buffer).setInt32(0, msgBytes.length, false);
          mpubFrame.set(msgSize, off); off += 4;
          mpubFrame.set(msgBytes, off); off += msgBytes.length;
        }

        await writer.write(mpubFrame);

        const mpubResp = await readFrame(reader, 5000);
        if (mpubResp.frameType === 1) throw new Error(`NSQ MPUB error: ${mpubResp.data}`);

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          host,
          port,
          topic: body.topic,
          messageCount: body.messages.length,
          totalBytes: encodedMsgs.reduce((sum, m) => sum + m.length, 0),
          response: mpubResp.data,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Multi-publish failed' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
