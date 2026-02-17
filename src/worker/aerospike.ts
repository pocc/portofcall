/**
 * Aerospike Info Protocol Support for Cloudflare Workers
 *
 * Implements the Aerospike Info protocol - a simple text-based
 * request/response protocol used for querying cluster metadata,
 * health checking, and server diagnostics.
 *
 * Protocol:
 *   Client -> Server: "<command>\n"
 *   Server -> Client: "<response>\n"
 *
 * The info protocol uses newline-delimited messages. Requests are
 * single command names. Responses are tab-separated key-value pairs
 * or semicolon-separated lists depending on the command.
 *
 * Default port: 3000
 *
 * Common info commands:
 *   - build           → Server build version
 *   - node            → Node ID
 *   - status          → Server status (ok)
 *   - namespaces      → Semicolon-separated namespace list
 *   - namespace/<ns>  → Namespace configuration details
 *   - statistics       → Server-wide statistics
 *   - cluster-name    → Cluster name
 *   - features        → Supported feature flags
 *   - edition         → Enterprise or Community edition
 *   - service         → Access endpoint addresses
 *
 * Use Cases:
 *   - Aerospike cluster health monitoring
 *   - Server version and edition detection
 *   - Namespace enumeration and configuration
 *   - Cluster topology discovery
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Valid info commands that are safe to execute (read-only)
const VALID_COMMANDS = [
  'build',
  'node',
  'status',
  'namespaces',
  'statistics',
  'cluster-name',
  'features',
  'edition',
  'service',
  'services',
  'services-alumni',
  'peers-generation',
  'partition-generation',
  'logs',
  'sets',
  'bins',
  'sindex',
  'udf-list',
  'jobs:module=query',
  'jobs:module=scan',
];

/**
 * Send an info command to an Aerospike server and read the response
 */
async function sendInfoCommand(
  host: string,
  port: number,
  command: string,
  timeout: number,
): Promise<string> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  try {
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Aerospike info protocol: send command followed by newline
    await writer.write(new TextEncoder().encode(`${command}\n`));

    // Read the response
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const maxResponseSize = 256 * 1024; // 256KB max

    try {
      while (totalBytes < maxResponseSize) {
        const { value, done } = await Promise.race([
          reader.read(),
          timeoutPromise,
        ]);

        if (done || !value) break;

        chunks.push(value);
        totalBytes += value.length;

        // Check if response is complete (ends with newline)
        const text = new TextDecoder().decode(value);
        if (text.includes('\n')) break;
      }
    } catch {
      // Read timeout or connection closed
      if (chunks.length === 0) {
        throw new Error('Server closed connection without responding');
      }
    }

    // Combine chunks
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new TextDecoder().decode(combined).trim();
  } catch (error) {
    socket.close();
    throw error;
  }
}

/**
 * Parse an Aerospike info response into key-value pairs
 * Format: "key1=value1;key2=value2;..." or "tab-separated key\tvalue"
 */
function parseInfoResponse(response: string): Record<string, string> {
  const result: Record<string, string> = {};

  // Strip the command echo prefix if present (e.g., "build\t6.0.0")
  const tabIdx = response.indexOf('\t');
  const data = tabIdx >= 0 ? response.substring(tabIdx + 1) : response;

  // Try semicolon-separated key=value pairs
  const parts = data.split(';');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx > 0) {
      const key = part.substring(0, eqIdx).trim();
      const value = part.substring(eqIdx + 1).trim();
      result[key] = value;
    } else if (part.trim()) {
      // Single value without key
      result['_value'] = part.trim();
    }
  }

  return result;
}

/**
 * Handle Aerospike connection test (HTTP mode)
 * Connects and queries build, status, node, edition, cluster-name, namespaces
 */
export async function handleAerospikeConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 3000, timeout = 10000 } = body;

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

    // Query build version to verify connectivity
    const buildResponse = await sendInfoCommand(host, port, 'build', timeout);

    // Parse the build version (format: "build\t6.0.0" or just "6.0.0")
    const buildVersion = buildResponse.includes('\t')
      ? buildResponse.split('\t')[1]
      : buildResponse;

    // Query additional info
    let status = 'unknown';
    let nodeId = 'unknown';
    let edition = 'unknown';
    let clusterName = 'unknown';
    let namespaces: string[] = [];

    try {
      const statusResp = await sendInfoCommand(host, port, 'status', timeout);
      status = statusResp.includes('\t') ? statusResp.split('\t')[1] : statusResp;
    } catch { /* optional */ }

    try {
      const nodeResp = await sendInfoCommand(host, port, 'node', timeout);
      nodeId = nodeResp.includes('\t') ? nodeResp.split('\t')[1] : nodeResp;
    } catch { /* optional */ }

    try {
      const editionResp = await sendInfoCommand(host, port, 'edition', timeout);
      edition = editionResp.includes('\t') ? editionResp.split('\t')[1] : editionResp;
    } catch { /* optional */ }

    try {
      const clusterResp = await sendInfoCommand(host, port, 'cluster-name', timeout);
      clusterName = clusterResp.includes('\t') ? clusterResp.split('\t')[1] : clusterResp;
    } catch { /* optional */ }

    try {
      const nsResp = await sendInfoCommand(host, port, 'namespaces', timeout);
      const nsData = nsResp.includes('\t') ? nsResp.split('\t')[1] : nsResp;
      namespaces = nsData ? nsData.split(';').filter(Boolean) : [];
    } catch { /* optional */ }

    const rtt = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      serverInfo: {
        build: buildVersion,
        status,
        nodeId,
        edition,
        clusterName,
        namespaces,
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

// ─── Aerospike Native Binary Protocol (AS_MSG) ───────────────────────────────
//
// Message format:
//   8-byte proto header: [version(1)=2, type(1)=3(AS_MSG), length(6 bytes BE)]
//   22-byte AS_MSG header: header_sz(1)=22, info1(1), info2(1), info3(1),
//                           unused(1), result_code(1), generation(4 BE),
//                           expiration(4 BE), transaction_ttl(4 BE),
//                           n_fields(2 BE), n_ops(2 BE)
//
// Field format: length(4 BE) + field_type(1) + data
// Op format:    length(4 BE) + op(1) + bin_type(1) + bin_version(1) +
//               bin_name_len(1) + bin_name + value
//
// Info1 flags: 0x04 = READ
// Info2 flags: 0x04 = WRITE
// Result code 0 = OK

const AS_INFO1_READ  = 0x04;
const AS_INFO2_WRITE = 0x04;

// Field type codes
const AS_FIELD_NAMESPACE   = 0;
const AS_FIELD_SET         = 1;
const AS_FIELD_KEY         = 3;

// Op type codes
const AS_OP_WRITE = 5;

// Bin value type codes
const AS_BIN_TYPE_INTEGER = 1;
const AS_BIN_TYPE_STRING  = 3;
const AS_BIN_TYPE_BLOB    = 7;

/**
 * Write a big-endian 32-bit integer into a byte array at offset
 */
function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset]     = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>>  8) & 0xff;
  buf[offset + 3] =  value         & 0xff;
}

/**
 * Write a big-endian 16-bit integer into a byte array at offset
 */
function writeUint16BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset]     = (value >> 8) & 0xff;
  buf[offset + 1] =  value       & 0xff;
}

/**
 * Read a big-endian 32-bit integer from a byte array at offset
 */
function readUint32BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
}

/**
 * Read a big-endian 16-bit integer from a byte array at offset
 */
function readUint16BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 8) | buf[offset + 1]) & 0xffff;
}

/**
 * Read a big-endian 48-bit integer (6 bytes) as a JS number (safe for lengths < 2^53)
 */
function readUint48BE(buf: Uint8Array, offset: number): number {
  const hi = readUint32BE(buf, offset);
  const lo = readUint16BE(buf, offset + 4);
  return hi * 0x10000 + lo;
}

/**
 * Encode a single Aerospike field (namespace, set, or key)
 */
function encodeAsField(fieldType: number, data: Uint8Array): Uint8Array {
  // length = 4 bytes (covers type byte + data), type = 1 byte
  const totalFieldLen = 1 + data.length; // type + data
  const buf = new Uint8Array(4 + totalFieldLen);
  writeUint32BE(buf, 0, totalFieldLen);
  buf[4] = fieldType;
  buf.set(data, 5);
  return buf;
}

/**
 * Encode the key field: type=AS_FIELD_KEY with value type prefix.
 * For string keys: prefix byte 0x03 (STRING) + UTF-8 bytes
 */
function encodeKeyField(key: string): Uint8Array {
  const keyBytes = new TextEncoder().encode(key);
  // Key field value: 1-byte particle type + key bytes
  const valueData = new Uint8Array(1 + keyBytes.length);
  valueData[0] = AS_BIN_TYPE_STRING;
  valueData.set(keyBytes, 1);
  return encodeAsField(AS_FIELD_KEY, valueData);
}


/**
 * Encode an AS_MSG op for write (PUT) — writes a named bin with a value
 */
function encodeWriteOp(binName: string, value: unknown): Uint8Array {
  const nameBytes = new TextEncoder().encode(binName.substring(0, 14));
  let binType: number;
  let valueBytes: Uint8Array;

  if (typeof value === 'number' && Number.isInteger(value)) {
    binType = AS_BIN_TYPE_INTEGER;
    // 8-byte big-endian integer
    valueBytes = new Uint8Array(8);
    const hi = Math.floor(value / 0x100000000);
    const lo = value >>> 0;
    writeUint32BE(valueBytes, 0, hi);
    writeUint32BE(valueBytes, 4, lo);
  } else if (typeof value === 'string') {
    binType = AS_BIN_TYPE_STRING;
    valueBytes = new TextEncoder().encode(value);
  } else {
    // Serialize as JSON blob
    binType = AS_BIN_TYPE_BLOB;
    valueBytes = new TextEncoder().encode(JSON.stringify(value));
  }

  // op_size = op(1) + bin_type(1) + bin_version(1) + bin_name_len(1) + bin_name + value
  const opSize = 4 + nameBytes.length + valueBytes.length;
  const buf = new Uint8Array(4 + opSize);
  writeUint32BE(buf, 0, opSize);
  buf[4] = AS_OP_WRITE;
  buf[5] = binType;
  buf[6] = 0; // bin_version
  buf[7] = nameBytes.length;
  buf.set(nameBytes, 8);
  buf.set(valueBytes, 8 + nameBytes.length);
  return buf;
}

/**
 * Build a complete Aerospike AS_MSG request
 *
 * @param info1       info1 flags (e.g. AS_INFO1_READ)
 * @param info2       info2 flags (e.g. AS_INFO2_WRITE)
 * @param fields      encoded field byte arrays
 * @param ops         encoded op byte arrays
 */
function buildAsMessage(
  info1: number,
  info2: number,
  fields: Uint8Array[],
  ops: Uint8Array[],
): Uint8Array {
  const AS_HEADER_SIZE = 22;
  const fieldBytes = fields.reduce((sum, f) => sum + f.length, 0);
  const opBytes = ops.reduce((sum, o) => sum + o.length, 0);
  const msgBodyLen = AS_HEADER_SIZE + fieldBytes + opBytes;

  // Proto header: 8 bytes
  const proto = new Uint8Array(8);
  proto[0] = 2; // version
  proto[1] = 3; // type = AS_MSG
  // length = 6 bytes BE (48-bit)
  const lenHi = Math.floor(msgBodyLen / 0x10000);
  const lenLo = msgBodyLen & 0xffff;
  writeUint32BE(proto, 2, lenHi);
  writeUint16BE(proto, 6, lenLo);

  // AS_MSG header: 22 bytes
  const header = new Uint8Array(AS_HEADER_SIZE);
  header[0] = AS_HEADER_SIZE; // header_sz
  header[1] = info1;
  header[2] = info2;
  header[3] = 0;  // info3
  header[4] = 0;  // unused
  header[5] = 0;  // result_code
  writeUint32BE(header, 6,  0); // generation
  writeUint32BE(header, 10, 0); // expiration (0 = never expire)
  writeUint32BE(header, 14, 0); // transaction_ttl
  writeUint16BE(header, 18, fields.length);
  writeUint16BE(header, 20, ops.length);

  // Concatenate everything
  const total = 8 + AS_HEADER_SIZE + fieldBytes + opBytes;
  const result = new Uint8Array(total);
  let offset = 0;
  result.set(proto, offset);   offset += 8;
  result.set(header, offset);  offset += AS_HEADER_SIZE;
  for (const f of fields) { result.set(f, offset); offset += f.length; }
  for (const o of ops)    { result.set(o, offset); offset += o.length; }
  return result;
}

/**
 * Parse an Aerospike response message.
 * Returns result_code, generation, expiration, and decoded bins.
 */
function parseAsResponse(data: Uint8Array): {
  resultCode: number;
  generation: number;
  expiration: number;
  bins: Record<string, unknown>;
} {
  if (data.length < 30) {
    throw new Error(`Response too short: ${data.length} bytes`);
  }

  // Skip 8-byte proto header
  let offset = 8;

  // AS_MSG header (22 bytes)
  const headerSz   = data[offset];     // should be 22
  // info1 = data[offset + 1]
  // info2 = data[offset + 2]
  const resultCode = data[offset + 5];
  const generation = readUint32BE(data, offset + 6);
  const expiration = readUint32BE(data, offset + 10);
  const nFields    = readUint16BE(data, offset + 18);
  const nOps       = readUint16BE(data, offset + 20);
  offset += headerSz;

  // Skip fields
  for (let i = 0; i < nFields; i++) {
    if (offset + 4 > data.length) break;
    const fieldLen = readUint32BE(data, offset);
    offset += 4 + fieldLen;
  }

  // Parse ops (bin data)
  const bins: Record<string, unknown> = {};

  for (let i = 0; i < nOps; i++) {
    if (offset + 8 > data.length) break;
    const opLen = readUint32BE(data, offset);
    // op(1) + bin_type(1) + bin_version(1) + bin_name_len(1) = 4 bytes
    const binType    = data[offset + 5];
    const binNameLen = data[offset + 7];
    const nameStart  = offset + 8;
    const nameEnd    = nameStart + binNameLen;

    if (nameEnd > data.length) break;

    const binName = new TextDecoder().decode(data.slice(nameStart, nameEnd));
    const valueStart = nameEnd;
    const valueEnd   = offset + 4 + opLen;

    if (valueEnd > data.length) break;

    const valueBytes = data.slice(valueStart, valueEnd);

    let binValue: unknown;
    switch (binType) {
      case AS_BIN_TYPE_INTEGER: {
        // 8-byte big-endian integer
        const hi = readUint32BE(valueBytes, 0);
        const lo = readUint32BE(valueBytes, 4);
        binValue = hi * 0x100000000 + lo;
        break;
      }
      case AS_BIN_TYPE_STRING:
        binValue = new TextDecoder().decode(valueBytes);
        break;
      case AS_BIN_TYPE_BLOB: {
        // Try to parse as JSON, otherwise return hex
        const str = new TextDecoder().decode(valueBytes);
        try {
          binValue = JSON.parse(str);
        } catch {
          binValue = Array.from(valueBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        break;
      }
      default:
        binValue = Array.from(valueBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    bins[binName] = binValue;
    offset += 4 + opLen;
  }

  return { resultCode, generation, expiration, bins };
}

/**
 * Send an Aerospike binary protocol request and receive the response
 */
async function sendAsRequest(
  host: string,
  port: number,
  message: Uint8Array,
  timeout: number,
): Promise<Uint8Array> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  try {
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    await writer.write(message);

    // Read response — collect until we have the complete message
    // Proto header tells us the body length
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let expectedTotal = 0;

    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
      if (done || !value) break;

      chunks.push(value);
      totalBytes += value.length;

      // Once we have the 8-byte proto header, calculate expected length
      if (expectedTotal === 0 && totalBytes >= 8) {
        const hdrBuf = new Uint8Array(8);
        let pos = 0;
        for (const chunk of chunks) {
          const toCopy = Math.min(chunk.length, 8 - pos);
          hdrBuf.set(chunk.subarray(0, toCopy), pos);
          pos += toCopy;
          if (pos >= 8) break;
        }
        const bodyLen = readUint48BE(hdrBuf, 2);
        expectedTotal = 8 + bodyLen;
      }

      if (expectedTotal > 0 && totalBytes >= expectedTotal) {
        break;
      }
    }

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    // Combine chunks
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return combined;
  } catch (error) {
    socket.close();
    throw error;
  }
}

/**
 * Handle Aerospike KV GET operation
 * POST /api/aerospike/kv/get
 *
 * Sends an AS_MSG READ request for a record and returns its bins.
 */
export async function handleAerospikeKVGet(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      namespace: string;
      set: string;
      key: string;
    };

    const { host, port = 3000, timeout = 10000, namespace, set, key } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!namespace) {
      return new Response(JSON.stringify({ success: false, error: 'Namespace is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!key) {
      return new Response(JSON.stringify({ success: false, error: 'Key is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    // Build fields: namespace, set (if provided), key
    const fields: Uint8Array[] = [
      encodeAsField(AS_FIELD_NAMESPACE, new TextEncoder().encode(namespace)),
    ];
    if (set) {
      fields.push(encodeAsField(AS_FIELD_SET, new TextEncoder().encode(set)));
    }
    fields.push(encodeKeyField(key));

    // No ops — read all bins (n_ops=0, info1=READ means return all bins)
    const message = buildAsMessage(AS_INFO1_READ, 0, fields, []);

    const rawResponse = await sendAsRequest(host, port, message, timeout);
    const rtt = Date.now() - startTime;

    const parsed = parseAsResponse(rawResponse);

    if (parsed.resultCode !== 0) {
      const errorMessages: Record<number, string> = {
        2: 'Record not found',
        3: 'Record too large',
        4: 'Record expired',
        12: 'Access denied',
      };
      return new Response(JSON.stringify({
        success: false,
        resultCode: parsed.resultCode,
        error: errorMessages[parsed.resultCode] || `Server error code ${parsed.resultCode}`,
        rtt,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      key,
      namespace,
      set: set || undefined,
      generation: parsed.generation,
      ttl: parsed.expiration,
      bins: parsed.bins,
      rtt,
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

/**
 * Handle Aerospike KV PUT operation
 * POST /api/aerospike/kv/put
 *
 * Sends an AS_MSG WRITE request to store a record with the given bins.
 */
export async function handleAerospikeKVPut(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      namespace: string;
      set: string;
      key: string;
      bins: Record<string, unknown>;
    };

    const { host, port = 3000, timeout = 10000, namespace, set, key, bins } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!namespace) {
      return new Response(JSON.stringify({ success: false, error: 'Namespace is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!key) {
      return new Response(JSON.stringify({ success: false, error: 'Key is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!bins || typeof bins !== 'object' || Object.keys(bins).length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'At least one bin is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    // Build fields
    const fields: Uint8Array[] = [
      encodeAsField(AS_FIELD_NAMESPACE, new TextEncoder().encode(namespace)),
    ];
    if (set) {
      fields.push(encodeAsField(AS_FIELD_SET, new TextEncoder().encode(set)));
    }
    fields.push(encodeKeyField(key));

    // Build write ops for each bin
    const ops: Uint8Array[] = Object.entries(bins).map(([name, value]) => encodeWriteOp(name, value));

    const message = buildAsMessage(0, AS_INFO2_WRITE, fields, ops);

    const rawResponse = await sendAsRequest(host, port, message, timeout);
    const rtt = Date.now() - startTime;

    const parsed = parseAsResponse(rawResponse);

    if (parsed.resultCode !== 0) {
      const errorMessages: Record<number, string> = {
        3: 'Record too large',
        12: 'Access denied',
        22: 'Bin name too long (max 14 chars)',
      };
      return new Response(JSON.stringify({
        success: false,
        resultCode: parsed.resultCode,
        error: errorMessages[parsed.resultCode] || `Server error code ${parsed.resultCode}`,
        rtt,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      key,
      namespace,
      set: set || undefined,
      generation: parsed.generation,
      binsWritten: Object.keys(bins).length,
      rtt,
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

/**
 * Handle Aerospike info command execution
 * Sends any valid info command and returns the raw + parsed response
 */
export async function handleAerospikeInfo(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      command: string;
      timeout?: number;
    };

    const { host, port = 3000, command, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!command) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Command is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate command against allowed list (also allow namespace/<ns> pattern)
    const isNamespaceQuery = /^namespace\/[a-zA-Z0-9_-]+$/.test(command);
    if (!VALID_COMMANDS.includes(command) && !isNamespaceQuery) {
      return new Response(JSON.stringify({
        success: false,
        error: `Invalid command: "${command}". Valid commands: ${VALID_COMMANDS.join(', ')}, namespace/<name>`,
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
    const response = await sendInfoCommand(host, port, command, timeout);
    const rtt = Date.now() - startTime;

    // Parse structured data
    const parsed = parseInfoResponse(response);

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      command,
      rtt,
      response,
      parsed,
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
