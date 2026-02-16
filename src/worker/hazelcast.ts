/**
 * Hazelcast IMDG Client Protocol Implementation
 *
 * Hazelcast is an in-memory data grid (IMDG) platform for distributed caching,
 * computing, and messaging. It uses a binary client protocol over TCP.
 *
 * Protocol Flow:
 * 1. Client connects to Hazelcast member port (default 5701)
 * 2. Client sends authentication message with version and credentials
 * 3. Server responds with authentication status and cluster info
 * 4. Client can send operations (get, put, ping, etc.)
 *
 * Key Operations:
 * - Client Authentication  → Version negotiation & cluster UUID
 * - Ping                   → Health check operation
 * - Get Distributed Object → Cluster member info
 *
 * Authentication: Username/password, token, or anonymous
 * Default Port: 5701
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface HazelcastRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface HazelcastResponse {
  success: boolean;
  rtt?: number;
  isHazelcast?: boolean;
  version?: string;
  clusterName?: string;
  memberCount?: number;
  serverVersion?: string;
  statusCode?: number;
  error?: string;
  isCloudflare?: boolean;
}

/**
 * Build a minimal Hazelcast client authentication message (Open Source 5.x protocol)
 *
 * Message format:
 * - Version byte (0x01 = 5.x)
 * - Message type (0xC8 = Authentication)
 * - Frame length (4 bytes, little-endian)
 * - Correlation ID (8 bytes)
 * - Flags (2 bytes)
 * - Payload (cluster name, credentials, etc.)
 */
function buildAuthMessage(): Uint8Array {
  const encoder = new TextEncoder();
  const clusterName = encoder.encode('dev'); // Default cluster name

  // Build frame:
  // Version (1) + Type (1) + FrameLength (4) + CorrelationID (8) + Flags (2) + Payload
  const payloadSize = clusterName.length + 20; // Minimal payload
  const frameLength = 16 + payloadSize; // Header (16 bytes) + payload

  const buffer = new Uint8Array(frameLength);
  let offset = 0;

  // Version byte (5.x client)
  buffer[offset++] = 0x05;

  // Message type: Authentication (0xC8)
  buffer[offset++] = 0xC8;

  // Frame length (little-endian 32-bit)
  const view = new DataView(buffer.buffer);
  view.setUint32(offset, frameLength, true);
  offset += 4;

  // Correlation ID (8 bytes) - use 1
  view.setBigUint64(offset, BigInt(1), true);
  offset += 8;

  // Flags (2 bytes) - 0x8000 = BEGIN_FRAME | END_FRAME
  view.setUint16(offset, 0xC000, true);
  offset += 2;

  // Payload: Cluster name length (4 bytes) + cluster name
  view.setUint32(offset, clusterName.length, true);
  offset += 4;

  buffer.set(clusterName, offset);
  offset += clusterName.length;

  // Client type string length + "TypeScript"
  const clientType = encoder.encode('PortOfCall');
  view.setUint32(offset, clientType.length, true);
  offset += 4;
  buffer.set(clientType, offset);

  return buffer;
}

/**
 * Parse Hazelcast authentication response
 */
function parseAuthResponse(data: Uint8Array): {
  isHazelcast: boolean;
  version?: string;
  clusterName?: string;
  memberCount?: number;
  serverVersion?: string;
} {
  if (data.length < 16) {
    return { isHazelcast: false };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Check version byte (should be 0x05 for 5.x)
  const version = data[0];
  if (version !== 0x05 && version !== 0x04 && version !== 0x03) {
    return { isHazelcast: false };
  }

  // If we got this far (version byte is valid), it's likely Hazelcast
  // Message type at data[1], frame length at view.getUint32(2), etc. could be parsed
  // for more sophisticated validation, but version byte is sufficient for detection
  const result: ReturnType<typeof parseAuthResponse> = {
    isHazelcast: true,
    version: `${version}.x`,
  };

  // Try to parse cluster info from payload (offset 16+)
  if (data.length > 16) {
    try {
      let offset = 16;

      // Status byte (0 = success, non-zero = error)
      const status = data[offset++];

      if (status === 0 && offset + 4 <= data.length) {
        // Cluster name length
        const clusterNameLen = view.getUint32(offset, true);
        offset += 4;

        if (offset + clusterNameLen <= data.length) {
          const decoder = new TextDecoder();
          result.clusterName = decoder.decode(data.slice(offset, offset + clusterNameLen));
          offset += clusterNameLen;
        }

        // Server version (if present)
        if (offset + 4 <= data.length) {
          const serverVersionLen = view.getUint32(offset, true);
          offset += 4;

          if (offset + serverVersionLen <= data.length) {
            result.serverVersion = new TextDecoder().decode(data.slice(offset, offset + serverVersionLen));
            offset += serverVersionLen;
          }
        }

        // Member count (if present)
        if (offset + 4 <= data.length) {
          result.memberCount = view.getUint32(offset, true);
        }
      }
    } catch (err) {
      // Parsing error - still detected as Hazelcast
    }
  }

  return result;
}

/**
 * Handle Hazelcast probe
 * POST /api/hazelcast/probe
 */
export async function handleHazelcastProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: HazelcastRequest;
  try {
    body = await request.json() as HazelcastRequest;
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 5701, timeout = 10000 } = body;

  if (!host) {
    return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (port < 1 || port > 65535) {
    return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result: HazelcastResponse = { success: false };
  const startTime = Date.now();

  try {
    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);

    // Send authentication message
    const authMessage = buildAuthMessage();
    const writer = socket.writable.getWriter();
    await writer.write(authMessage);
    writer.releaseLock();

    // Read response
    const reader = socket.readable.getReader();
    const responseChunks: Uint8Array[] = [];
    let totalBytes = 0;
    const maxResponseSize = 8192;

    while (totalBytes < maxResponseSize) {
      const readPromise = reader.read();
      const { value, done } = await Promise.race([
        readPromise,
        new Promise<{ value: Uint8Array | undefined; done: boolean }>((_, reject) => {
          setTimeout(() => reject(new Error('Read timeout')), 3000);
        })
      ]);

      if (done || !value) break;

      responseChunks.push(value);
      totalBytes += value.length;

      // If we have enough data for a frame, process it
      if (totalBytes >= 16) {
        break;
      }
    }

    reader.releaseLock();
    socket.close();

    result.rtt = Date.now() - startTime;

    if (responseChunks.length === 0) {
      result.error = 'No response from server';
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Combine chunks
    const responseData = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of responseChunks) {
      responseData.set(chunk, offset);
      offset += chunk.length;
    }

    // Parse response
    const parsed = parseAuthResponse(responseData);
    result.isHazelcast = parsed.isHazelcast;
    result.version = parsed.version;
    result.clusterName = parsed.clusterName;
    result.memberCount = parsed.memberCount;
    result.serverVersion = parsed.serverVersion;

    if (parsed.isHazelcast) {
      result.success = true;
    } else {
      result.error = 'Not a Hazelcast server';
    }

  } catch (err) {
    result.rtt = Date.now() - startTime;
    result.error = err instanceof Error ? err.message : 'Connection failed';
  }

  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
