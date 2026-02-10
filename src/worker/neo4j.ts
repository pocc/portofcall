/**
 * Neo4j Bolt Protocol Implementation
 *
 * Implements Neo4j connectivity testing via the Bolt protocol (port 7687).
 * The Bolt protocol uses a binary handshake followed by PackStream-encoded
 * messages for graph database operations.
 *
 * Protocol Flow:
 * 1. Client sends magic number 0x6060B017 + 4 supported versions
 * 2. Server responds with chosen version (uint32)
 * 3. Client sends HELLO message with auth credentials
 * 4. Server responds with SUCCESS containing server info
 *
 * Use Cases:
 * - Neo4j server connectivity testing
 * - Bolt protocol version detection
 * - Server version and edition discovery
 * - Authentication verification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Bolt protocol magic number
const BOLT_MAGIC = 0x6060B017;

// PackStream encoding helpers
function packString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const length = bytes.length;

  if (length < 16) {
    const result = new Uint8Array(1 + length);
    result[0] = 0x80 | length;
    result.set(bytes, 1);
    return result;
  } else if (length < 256) {
    const result = new Uint8Array(2 + length);
    result[0] = 0xD0;
    result[1] = length;
    result.set(bytes, 2);
    return result;
  } else {
    const result = new Uint8Array(3 + length);
    result[0] = 0xD1;
    result[1] = (length >> 8) & 0xFF;
    result[2] = length & 0xFF;
    result.set(bytes, 3);
    return result;
  }
}

function packMap(entries: [string, Uint8Array][]): Uint8Array {
  const count = entries.length;
  const parts: Uint8Array[] = [];

  if (count < 16) {
    parts.push(new Uint8Array([0xA0 | count]));
  } else {
    parts.push(new Uint8Array([0xD8, count]));
  }

  for (const [key, value] of entries) {
    parts.push(packString(key));
    parts.push(value);
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function packStruct(tag: number, fields: Uint8Array[]): Uint8Array {
  const fieldCount = fields.length;
  const parts: Uint8Array[] = [];

  // Struct marker: 0xB0 | fieldCount (tiny struct)
  parts.push(new Uint8Array([0xB0 | fieldCount, tag]));

  for (const field of fields) {
    parts.push(field);
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Build a chunked Bolt message from PackStream-encoded data
 */
function buildChunkedMessage(data: Uint8Array): Uint8Array {
  // Chunk header (2 bytes big-endian length) + data + end marker (0x0000)
  const result = new Uint8Array(2 + data.length + 2);
  result[0] = (data.length >> 8) & 0xFF;
  result[1] = data.length & 0xFF;
  result.set(data, 2);
  // End marker already zero-filled
  return result;
}

/**
 * Parse a PackStream value from a buffer
 */
function unpackValue(data: Uint8Array, offset: number): [unknown, number] {
  if (offset >= data.length) return [null, offset];

  const marker = data[offset];

  // Tiny int (0x00-0x7F)
  if (marker >= 0x00 && marker <= 0x7F) {
    return [marker, offset + 1];
  }

  // Negative tiny int (0xF0-0xFF = -16 to -1)
  if (marker >= 0xF0 && marker <= 0xFF) {
    return [marker - 256, offset + 1];
  }

  // Tiny string (0x80-0x8F)
  if (marker >= 0x80 && marker <= 0x8F) {
    const length = marker & 0x0F;
    const str = new TextDecoder().decode(data.slice(offset + 1, offset + 1 + length));
    return [str, offset + 1 + length];
  }

  // Tiny list (0x90-0x9F)
  if (marker >= 0x90 && marker <= 0x9F) {
    const count = marker & 0x0F;
    const list: unknown[] = [];
    let pos = offset + 1;
    for (let i = 0; i < count; i++) {
      const [val, newPos] = unpackValue(data, pos);
      list.push(val);
      pos = newPos;
    }
    return [list, pos];
  }

  // Tiny map (0xA0-0xAF)
  if (marker >= 0xA0 && marker <= 0xAF) {
    const count = marker & 0x0F;
    const map: Record<string, unknown> = {};
    let pos = offset + 1;
    for (let i = 0; i < count; i++) {
      const [key, keyPos] = unpackValue(data, pos);
      const [val, valPos] = unpackValue(data, keyPos);
      map[String(key)] = val;
      pos = valPos;
    }
    return [map, pos];
  }

  // Tiny struct (0xB0-0xBF)
  if (marker >= 0xB0 && marker <= 0xBF) {
    const fieldCount = marker & 0x0F;
    const tag = data[offset + 1];
    const fields: unknown[] = [];
    let pos = offset + 2;
    for (let i = 0; i < fieldCount; i++) {
      const [val, newPos] = unpackValue(data, pos);
      fields.push(val);
      pos = newPos;
    }
    return [{ _tag: tag, _fields: fields }, pos];
  }

  // Null (0xC0)
  if (marker === 0xC0) return [null, offset + 1];

  // Float64 (0xC1)
  if (marker === 0xC1) {
    const view = new DataView(data.buffer, data.byteOffset + offset + 1, 8);
    return [view.getFloat64(0), offset + 9];
  }

  // Boolean false (0xC2)
  if (marker === 0xC2) return [false, offset + 1];

  // Boolean true (0xC3)
  if (marker === 0xC3) return [true, offset + 1];

  // Int8 (0xC8)
  if (marker === 0xC8) {
    const val = data[offset + 1];
    return [val > 127 ? val - 256 : val, offset + 2];
  }

  // Int16 (0xC9)
  if (marker === 0xC9) {
    const view = new DataView(data.buffer, data.byteOffset + offset + 1, 2);
    return [view.getInt16(0), offset + 3];
  }

  // Int32 (0xCA)
  if (marker === 0xCA) {
    const view = new DataView(data.buffer, data.byteOffset + offset + 1, 4);
    return [view.getInt32(0), offset + 5];
  }

  // String8 (0xD0)
  if (marker === 0xD0) {
    const length = data[offset + 1];
    const str = new TextDecoder().decode(data.slice(offset + 2, offset + 2 + length));
    return [str, offset + 2 + length];
  }

  // String16 (0xD1)
  if (marker === 0xD1) {
    const view = new DataView(data.buffer, data.byteOffset + offset + 1, 2);
    const length = view.getUint16(0);
    const str = new TextDecoder().decode(data.slice(offset + 3, offset + 3 + length));
    return [str, offset + 3 + length];
  }

  // Map8 (0xD8)
  if (marker === 0xD8) {
    const count = data[offset + 1];
    const map: Record<string, unknown> = {};
    let pos = offset + 2;
    for (let i = 0; i < count; i++) {
      const [key, keyPos] = unpackValue(data, pos);
      const [val, valPos] = unpackValue(data, keyPos);
      map[String(key)] = val;
      pos = valPos;
    }
    return [map, pos];
  }

  // Skip unknown marker
  return [null, offset + 1];
}

/**
 * Parse a Bolt response message from chunked data
 */
function parseResponse(data: Uint8Array): { tag: number; metadata: Record<string, unknown> } | null {
  if (data.length < 4) return null;

  // Read chunk size (first 2 bytes, big-endian)
  const chunkSize = (data[0] << 8) | data[1];
  if (chunkSize === 0) return null;

  // The chunk data starts at offset 2
  const chunkData = data.slice(2, 2 + chunkSize);

  // Parse the struct
  const [value] = unpackValue(chunkData, 0);

  if (value && typeof value === 'object' && '_tag' in (value as Record<string, unknown>)) {
    const struct = value as { _tag: number; _fields: unknown[] };
    const metadata = (struct._fields[0] as Record<string, unknown>) || {};
    return { tag: struct._tag, metadata };
  }

  return null;
}

/**
 * Format Bolt protocol version from uint32
 */
function formatVersion(version: number): string {
  const major = (version >> 8) & 0xFF;
  const minor = version & 0xFF;
  return `${major}.${minor}`;
}

/**
 * Handle Neo4j Bolt connection test
 */
export async function handleNeo4jConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 7687, timeout = 10000 } = body;

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
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // === Phase 1: Bolt Handshake ===
    // Send magic number + 4 protocol versions
    const handshake = new Uint8Array(20);
    const view = new DataView(handshake.buffer);
    view.setUint32(0, BOLT_MAGIC); // Magic preamble
    // Offer versions 5.4, 5.3, 4.4, 4.3 (newest first)
    view.setUint32(4, 0x00000504);  // v5.4
    view.setUint32(8, 0x00000503);  // v5.3
    view.setUint32(12, 0x00000404); // v4.4
    view.setUint32(16, 0x00000403); // v4.3

    await writer.write(handshake);

    // Read server's chosen version (4 bytes)
    const versionResult = await Promise.race([reader.read(), timeoutPromise]);
    if (versionResult.done || !versionResult.value) {
      throw new Error('Server closed connection during handshake');
    }

    const versionData = versionResult.value;
    if (versionData.length < 4) {
      throw new Error('Invalid handshake response');
    }

    const versionView = new DataView(versionData.buffer, versionData.byteOffset, 4);
    const selectedVersion = versionView.getUint32(0);

    if (selectedVersion === 0) {
      throw new Error('Server does not support any offered Bolt protocol versions');
    }

    const boltVersion = formatVersion(selectedVersion);

    // === Phase 2: HELLO message ===
    // Build HELLO with user_agent
    const helloMap = packMap([
      ['user_agent', packString('PortOfCall/1.0')],
      ['scheme', packString('none')],
    ]);

    const helloMessage = packStruct(0x01, [helloMap]); // HELLO = 0x01
    const chunkedHello = buildChunkedMessage(helloMessage);

    await writer.write(chunkedHello);

    // Read HELLO response
    let serverInfo: Record<string, unknown> = {};
    let helloSuccess = false;
    let authRequired = false;
    let errorMessage = '';

    try {
      const responseResult = await Promise.race([reader.read(), timeoutPromise]);
      if (responseResult.value && responseResult.value.length > 0) {
        const parsed = parseResponse(responseResult.value);
        if (parsed) {
          if (parsed.tag === 0x70) { // SUCCESS
            helloSuccess = true;
            serverInfo = parsed.metadata;
          } else if (parsed.tag === 0x7F) { // FAILURE
            authRequired = true;
            errorMessage = String(parsed.metadata.message || 'Authentication required');
          }
        }
      }
    } catch {
      // HELLO response timeout or error - still have handshake data
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      boltVersion,
      selectedVersion,
      helloSuccess,
      authRequired,
      errorMessage: errorMessage || undefined,
      serverInfo: {
        server: serverInfo.server || undefined,
        connection_id: serverInfo.connection_id || undefined,
        hints: serverInfo.hints || undefined,
      },
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
