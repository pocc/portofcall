/**
 * Aerospike Protocol Support for Cloudflare Workers
 *
 * Implements both the Aerospike Info protocol and the AS_MSG binary protocol
 * for querying cluster metadata, health checking, and KV operations.
 *
 * Info Protocol (type=1):
 *   All messages are framed with an 8-byte proto header:
 *     [version(1)=2, type(1)=1, length(6 bytes BE)]
 *   followed by the command text (e.g. "build\n").
 *   Responses use the same framing with the response body.
 *
 * AS_MSG Protocol (type=3):
 *   8-byte proto header + 22-byte AS_MSG header + fields + ops
 *   Used for KV GET/PUT operations.
 *
 * Default port: 3000
 *
 * Common info commands:
 *   - build           -> Server build version
 *   - node            -> Node ID
 *   - status          -> Server status (ok)
 *   - namespaces      -> Semicolon-separated namespace list
 *   - namespace/<ns>  -> Namespace configuration details
 *   - statistics      -> Server-wide statistics
 *   - cluster-name    -> Cluster name
 *   - features        -> Supported feature flags
 *   - edition         -> Enterprise or Community edition
 *   - service         -> Access endpoint addresses
 *
 * Use Cases:
 *   - Aerospike cluster health monitoring
 *   - Server version and edition detection
 *   - Namespace enumeration and configuration
 *   - Cluster topology discovery
 *   - KV record get/put operations
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ─── Shared byte helpers ──────────────────────────────────────────────────────

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
 * Write a big-endian 48-bit integer (6 bytes) into a byte array at offset.
 * Used for the proto header length field.
 */
function writeUint48BE(buf: Uint8Array, offset: number, value: number): void {
  const hi = Math.floor(value / 0x10000);
  const lo = value & 0xffff;
  writeUint32BE(buf, offset, hi);
  writeUint16BE(buf, offset + 4, lo);
}

// ─── RIPEMD-160 (needed for key digest computation) ───────────────────────────
//
// Aerospike uses RIPEMD-160(set_name + key_bytes) as the 20-byte record digest
// for partition routing. We implement it here in pure JS since Cloudflare Workers
// do not expose RIPEMD-160 via WebCrypto.

function ripemd160(msg: Uint8Array): Uint8Array {
  // Initial hash values
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  // Pre-processing: add padding
  const msgLen = msg.length;
  const bitLen = msgLen * 8;
  // Padding: append 0x80, then zeros, then 64-bit LE length
  // Total length must be multiple of 64 bytes
  const padLen = (55 - (msgLen % 64) + 64) % 64 + 1;
  const padded = new Uint8Array(msgLen + padLen + 8);
  padded.set(msg);
  padded[msgLen] = 0x80;
  // 64-bit little-endian bit length at the end
  padded[padded.length - 8] = bitLen & 0xff;
  padded[padded.length - 7] = (bitLen >>> 8) & 0xff;
  padded[padded.length - 6] = (bitLen >>> 16) & 0xff;
  padded[padded.length - 5] = (bitLen >>> 24) & 0xff;
  // For messages < 512MB the upper 32 bits are 0

  // Helper functions
  const rl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  const add = (...args: number[]) => {
    let s = 0;
    for (const a of args) s = (s + a) >>> 0;
    return s;
  };

  // Round functions
  const f0 = (x: number, y: number, z: number) => (x ^ y ^ z) >>> 0;
  const f1 = (x: number, y: number, z: number) => ((x & y) | (~x & z)) >>> 0;
  const f2 = (x: number, y: number, z: number) => ((x | ~y) ^ z) >>> 0;
  const f3 = (x: number, y: number, z: number) => ((x & z) | (y & ~z)) >>> 0;
  const f4 = (x: number, y: number, z: number) => (x ^ (y | ~z)) >>> 0;

  // Constants
  const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
  const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];

  // Message word selection
  const RL = [
    0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,
    7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,
    3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,
    1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,
    4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13,
  ];
  const RR = [
    5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,
    6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,
    15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,
    8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,
    12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11,
  ];

  // Rotation amounts
  const SL = [
    11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,
    7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,
    11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,
    11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,
    9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6,
  ];
  const SR = [
    8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,
    9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,
    9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,
    15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,
    8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11,
  ];

  const fns = [f0, f1, f2, f3, f4];

  // Process each 64-byte block
  const view = new DataView(padded.buffer);
  for (let i = 0; i < padded.length; i += 64) {
    // Read 16 words (little-endian)
    const X: number[] = [];
    for (let j = 0; j < 16; j++) {
      X[j] = view.getUint32(i + j * 4, true);
    }

    let al = h0, bl = h1, cl = h2, dl = h3, el = h4;
    let ar = h0, br = h1, cr = h2, dr = h3, er = h4;

    for (let j = 0; j < 80; j++) {
      const round = Math.floor(j / 16);

      // Left
      let t = add(al, fns[round](bl, cl, dl), X[RL[j]], KL[round]);
      t = add(rl(t, SL[j]), el);
      al = el; el = dl; dl = rl(cl, 10); cl = bl; bl = t;

      // Right (reverse round order: 4,3,2,1,0)
      const rround = 4 - round;
      t = add(ar, fns[rround](br, cr, dr), X[RR[j]], KR[round]);
      t = add(rl(t, SR[j]), er);
      ar = er; er = dr; dr = rl(cr, 10); cr = br; br = t;
    }

    const t = add(h1, cl, dr);
    h1 = add(h2, dl, er);
    h2 = add(h3, el, ar);
    h3 = add(h4, al, br);
    h4 = add(h0, bl, cr);
    h0 = t;
  }

  // Output 20 bytes (little-endian)
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, true);
  outView.setUint32(4, h1, true);
  outView.setUint32(8, h2, true);
  outView.setUint32(12, h3, true);
  outView.setUint32(16, h4, true);
  return out;
}

/**
 * Compute the Aerospike key digest: RIPEMD-160(set_name + key_value_bytes).
 * For a string key, the key bytes are the raw UTF-8 of the string.
 */
function computeDigest(setName: string, key: string): Uint8Array {
  const setBytes = new TextEncoder().encode(setName);
  const keyBytes = new TextEncoder().encode(key);
  const combined = new Uint8Array(setBytes.length + keyBytes.length);
  combined.set(setBytes, 0);
  combined.set(keyBytes, setBytes.length);
  return ripemd160(combined);
}

// ─── Aerospike Info Protocol ──────────────────────────────────────────────────

// Proto header type for Info protocol
const AS_PROTO_TYPE_INFO = 1;

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
 * Build an Aerospike proto header (8 bytes).
 *
 * Format: [version(1)][type(1)][length(6 bytes BE)]
 *
 * @param type   Protocol message type (1=INFO, 3=AS_MSG)
 * @param length Body length in bytes (after the 8-byte header)
 */
function buildProtoHeader(type: number, length: number): Uint8Array {
  const header = new Uint8Array(8);
  header[0] = 2;    // protocol version
  header[1] = type;  // message type
  writeUint48BE(header, 2, length);
  return header;
}

/**
 * Send a framed message to an Aerospike server and read the framed response.
 * Used by both the info protocol and the AS_MSG binary protocol.
 *
 * Handles the 8-byte proto header framing on both send and receive sides.
 */
async function sendFramedRequest(
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

    // Read response -- collect until we have the complete message.
    // The 8-byte proto header tells us the body length.
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let expectedTotal = 0;

    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
      if (done || !value) break;

      chunks.push(value);
      totalBytes += value.length;

      // Once we have the 8-byte proto header, calculate expected total length
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
 * Send an info command to an Aerospike server and read the response.
 *
 * The info protocol uses the standard Aerospike proto header framing:
 *   Request:  [proto_header type=1][command_text\n]
 *   Response: [proto_header type=1][response_text\n]
 */
async function sendInfoCommand(
  host: string,
  port: number,
  command: string,
  timeout: number,
): Promise<string> {
  // Build the info request: proto header + command text + newline
  const commandBytes = new TextEncoder().encode(`${command}\n`);
  const protoHeader = buildProtoHeader(AS_PROTO_TYPE_INFO, commandBytes.length);

  // Concatenate proto header + command body
  const message = new Uint8Array(protoHeader.length + commandBytes.length);
  message.set(protoHeader, 0);
  message.set(commandBytes, protoHeader.length);

  const response = await sendFramedRequest(host, port, message, timeout);

  if (response.length < 8) {
    throw new Error('Server closed connection without responding');
  }

  // Skip the 8-byte proto header to get the response body
  const bodyBytes = response.slice(8);
  return new TextDecoder().decode(bodyBytes).trim();
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
// Op format:    length(4 BE) + op(1) + particle_type(1) + version(1) +
//               bin_name_len(1) + bin_name + value
//
// Result code 0 = OK

// Proto header type for AS_MSG
const AS_PROTO_TYPE_AS_MSG = 3;

// AS_MSG info1 flags
const AS_MSG_INFO1_READ    = 0x01;
const AS_MSG_INFO1_GET_ALL = 0x02;

// AS_MSG info2 flags
const AS_MSG_INFO2_WRITE = 0x01;

// Field type codes
const AS_FIELD_NAMESPACE   = 0;
const AS_FIELD_SET         = 1;
const AS_FIELD_KEY         = 2;
const AS_FIELD_DIGEST      = 4;

// Op type codes
const AS_OP_READ  = 1;
const AS_OP_WRITE = 2;

// Bin particle type codes (used in key field prefix and op encoding)
const AS_PARTICLE_TYPE_INTEGER = 1;
const AS_PARTICLE_TYPE_STRING  = 3;
const AS_PARTICLE_TYPE_BLOB    = 4;

/**
 * Encode a single Aerospike field (namespace, set, digest, or key).
 *
 * Field wire format: [field_size(4 BE)][field_type(1)][data...]
 * where field_size = 1 (type byte) + data.length
 */
function encodeAsField(fieldType: number, data: Uint8Array): Uint8Array {
  const totalFieldLen = 1 + data.length; // type byte + data
  const buf = new Uint8Array(4 + totalFieldLen);
  writeUint32BE(buf, 0, totalFieldLen);
  buf[4] = fieldType;
  buf.set(data, 5);
  return buf;
}

/**
 * Encode the key field (field type 2): stores the user key for later retrieval.
 * Format: [particle_type(1)][key_bytes...]
 * For string keys: particle_type = 3 (STRING)
 */
function encodeKeyField(key: string): Uint8Array {
  const keyBytes = new TextEncoder().encode(key);
  const valueData = new Uint8Array(1 + keyBytes.length);
  valueData[0] = AS_PARTICLE_TYPE_STRING;
  valueData.set(keyBytes, 1);
  return encodeAsField(AS_FIELD_KEY, valueData);
}

/**
 * Encode the digest field (field type 4): 20-byte RIPEMD-160 hash used
 * for partition routing. This is how the server locates the record.
 */
function encodeDigestField(setName: string, key: string): Uint8Array {
  const digest = computeDigest(setName, key);
  return encodeAsField(AS_FIELD_DIGEST, digest);
}

/**
 * Encode a read op -- requests a specific bin by name.
 * When n_ops=0 with GET_ALL flag, all bins are returned; individual
 * read ops are used to request specific bins.
 */
function encodeReadOp(binName: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(binName.substring(0, 15));
  // op_size = op_type(1) + particle_type(1) + version(1) + name_len(1) + name
  const opSize = 4 + nameBytes.length;
  const buf = new Uint8Array(4 + opSize);
  writeUint32BE(buf, 0, opSize);
  buf[4] = AS_OP_READ;
  buf[5] = 0; // particle_type (unused for reads)
  buf[6] = 0; // version
  buf[7] = nameBytes.length;
  buf.set(nameBytes, 8);
  return buf;
}

/**
 * Encode an AS_MSG write op -- writes a named bin with a value.
 *
 * Op wire format:
 *   [op_size(4 BE)][op_type(1)][particle_type(1)][version(1)][name_len(1)][name][value]
 * where op_size counts everything after the 4-byte size field.
 */
function encodeWriteOp(binName: string, value: unknown): Uint8Array {
  const nameBytes = new TextEncoder().encode(binName.substring(0, 15));
  let particleType: number;
  let valueBytes: Uint8Array;

  if (typeof value === 'number' && Number.isInteger(value)) {
    particleType = AS_PARTICLE_TYPE_INTEGER;
    // 8-byte big-endian integer
    valueBytes = new Uint8Array(8);
    const hi = Math.floor(value / 0x100000000);
    const lo = value >>> 0;
    writeUint32BE(valueBytes, 0, hi);
    writeUint32BE(valueBytes, 4, lo);
  } else if (typeof value === 'string') {
    particleType = AS_PARTICLE_TYPE_STRING;
    valueBytes = new TextEncoder().encode(value);
  } else {
    // Serialize as JSON blob
    particleType = AS_PARTICLE_TYPE_BLOB;
    valueBytes = new TextEncoder().encode(JSON.stringify(value));
  }

  // op_size = op_type(1) + particle_type(1) + version(1) + name_len(1) + name + value
  const opSize = 4 + nameBytes.length + valueBytes.length;
  const buf = new Uint8Array(4 + opSize);
  writeUint32BE(buf, 0, opSize);
  buf[4] = AS_OP_WRITE;
  buf[5] = particleType;
  buf[6] = 0; // version
  buf[7] = nameBytes.length;
  buf.set(nameBytes, 8);
  buf.set(valueBytes, 8 + nameBytes.length);
  return buf;
}

/**
 * Build a complete Aerospike AS_MSG request.
 *
 * Layout:
 *   [8-byte proto header: version=2, type=3, body_length]
 *   [22-byte AS_MSG header]
 *   [fields...]
 *   [ops...]
 *
 * @param info1       info1 flags (e.g. AS_MSG_INFO1_READ | AS_MSG_INFO1_GET_ALL)
 * @param info2       info2 flags (e.g. AS_MSG_INFO2_WRITE)
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
  const proto = buildProtoHeader(AS_PROTO_TYPE_AS_MSG, msgBodyLen);

  // AS_MSG header: 22 bytes
  const header = new Uint8Array(AS_HEADER_SIZE);
  header[0] = AS_HEADER_SIZE; // header_sz
  header[1] = info1;
  header[2] = info2;
  header[3] = 0;  // info3
  header[4] = 0;  // unused
  header[5] = 0;  // result_code
  writeUint32BE(header, 6,  0); // generation
  writeUint32BE(header, 10, 0); // expiration (0 = default/never)
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
 * Parse an Aerospike AS_MSG response.
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
    // op_type(1) + particle_type(1) + version(1) + name_len(1) = 4 bytes
    const particleType = data[offset + 5];
    const binNameLen   = data[offset + 7];
    const nameStart    = offset + 8;
    const nameEnd      = nameStart + binNameLen;

    if (nameEnd > data.length) break;

    const binName = new TextDecoder().decode(data.slice(nameStart, nameEnd));
    const valueStart = nameEnd;
    const valueEnd   = offset + 4 + opLen;

    if (valueEnd > data.length) break;

    const valueBytes = data.slice(valueStart, valueEnd);

    let binValue: unknown;
    switch (particleType) {
      case AS_PARTICLE_TYPE_INTEGER: {
        // 8-byte big-endian integer
        if (valueBytes.length >= 8) {
          const hi = readUint32BE(valueBytes, 0);
          const lo = readUint32BE(valueBytes, 4);
          binValue = hi * 0x100000000 + lo;
        } else {
          binValue = 0;
        }
        break;
      }
      case AS_PARTICLE_TYPE_STRING:
        binValue = new TextDecoder().decode(valueBytes);
        break;
      case AS_PARTICLE_TYPE_BLOB: {
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
 * Handle Aerospike KV GET operation
 * POST /api/aerospike/kv-get
 *
 * Sends an AS_MSG READ request for a record and returns its bins.
 * The record is located using the RIPEMD-160 digest of (set + key).
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
      bins?: string[];
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

    // Build fields: namespace, set (if provided), digest (required), and user key
    const setName = set || '';
    const fields: Uint8Array[] = [
      encodeAsField(AS_FIELD_NAMESPACE, new TextEncoder().encode(namespace)),
    ];
    if (set) {
      fields.push(encodeAsField(AS_FIELD_SET, new TextEncoder().encode(set)));
    }
    // Digest field is required for partition routing
    fields.push(encodeDigestField(setName, key));
    // Also send the user key so the server stores/returns it
    fields.push(encodeKeyField(key));

    // Build ops and info1 flags
    let info1 = AS_MSG_INFO1_READ;
    const ops: Uint8Array[] = [];

    if (body.bins && body.bins.length > 0) {
      // Request specific bins
      for (const binName of body.bins) {
        ops.push(encodeReadOp(binName));
      }
    } else {
      // Request all bins: set GET_ALL flag with n_ops=0
      info1 |= AS_MSG_INFO1_GET_ALL;
    }

    const message = buildAsMessage(info1, 0, fields, ops);

    const rawResponse = await sendFramedRequest(host, port, message, timeout);
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
 * POST /api/aerospike/kv-put
 *
 * Sends an AS_MSG WRITE request to store a record with the given bins.
 * The record is located using the RIPEMD-160 digest of (set + key).
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
    const setName = set || '';
    const fields: Uint8Array[] = [
      encodeAsField(AS_FIELD_NAMESPACE, new TextEncoder().encode(namespace)),
    ];
    if (set) {
      fields.push(encodeAsField(AS_FIELD_SET, new TextEncoder().encode(set)));
    }
    // Digest field is required for partition routing
    fields.push(encodeDigestField(setName, key));
    // Also send the user key so the server stores it
    fields.push(encodeKeyField(key));

    // Build write ops for each bin
    const ops: Uint8Array[] = Object.entries(bins).map(([name, value]) => encodeWriteOp(name, value));

    const message = buildAsMessage(0, AS_MSG_INFO2_WRITE, fields, ops);

    const rawResponse = await sendFramedRequest(host, port, message, timeout);
    const rtt = Date.now() - startTime;

    const parsed = parseAsResponse(rawResponse);

    if (parsed.resultCode !== 0) {
      const errorMessages: Record<number, string> = {
        3: 'Record too large',
        12: 'Access denied',
        22: 'Bin name too long (max 15 chars)',
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
