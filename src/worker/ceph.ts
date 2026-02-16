/**
 * Ceph Monitor MSGR Protocol Implementation
 *
 * Implements Ceph Monitor connectivity testing via the MSGR (Messenger) protocol
 * on port 6789. Ceph monitors are the central coordination daemons for Ceph
 * distributed storage clusters, responsible for maintaining cluster maps and
 * consensus via Paxos.
 *
 * Protocol Flow (MSGR v1 - legacy):
 * 1. Server sends banner: "ceph v027\n" (9 bytes, ASCII)
 * 2. Server sends its entity address (sockaddr_storage, 136 bytes)
 * 3. Client sends its banner + entity address
 * 4. Feature negotiation follows
 *
 * Protocol Flow (MSGR v2 - modern, Ceph Nautilus+):
 * 1. Server sends banner: "ceph v2\n" (8 bytes, ASCII)
 * 2. Followed by 2x uint16 LE for banner payload length
 * 3. Banner payload contains supported/required features as 8-byte LE values
 * 4. Frame-based communication follows
 *
 * Use Cases:
 * - Ceph cluster monitor detection and reachability testing
 * - MSGR protocol version detection (v1 vs v2)
 * - Distributed storage infrastructure probing
 * - Ceph cluster health monitoring
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// MSGR v1 banner prefix
const BANNER_V1_PREFIX = 'ceph v0';

// MSGR v2 banner prefix
const BANNER_V2_PREFIX = 'ceph v2';

// Entity types in Ceph
const ENTITY_TYPES: Record<number, string> = {
  0x01: 'mon',      // Monitor
  0x02: 'mds',      // Metadata Server
  0x04: 'osd',      // Object Storage Daemon
  0x08: 'client',   // Client
  0x10: 'mgr',      // Manager
  0x20: 'auth',     // Authentication
  0x100: 'any',     // Any
};

/**
 * Read exactly N bytes from the socket.
 */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needed: number,
  timeoutPromise: Promise<never>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < needed) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) {
      throw new Error(`Connection closed after ${total} bytes (expected ${needed})`);
    }
    chunks.push(result.value);
    total += result.value.length;
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

/**
 * Detect MSGR protocol version from banner data.
 */
function detectBanner(data: Uint8Array): {
  isCeph: boolean;
  version: string;
  banner: string;
  remaining: Uint8Array;
} {
  const text = new TextDecoder().decode(data);

  // Check for MSGR v2
  if (text.startsWith(BANNER_V2_PREFIX)) {
    const bannerEnd = text.indexOf('\n');
    const banner = bannerEnd >= 0 ? text.substring(0, bannerEnd + 1) : text;
    const remaining = data.slice(banner.length);
    return {
      isCeph: true,
      version: 'v2 (msgr2)',
      banner: banner.trim(),
      remaining,
    };
  }

  // Check for MSGR v1
  if (text.startsWith(BANNER_V1_PREFIX) || text.startsWith('ceph ')) {
    const bannerEnd = text.indexOf('\n');
    const banner = bannerEnd >= 0 ? text.substring(0, bannerEnd + 1) : text;
    const remaining = data.slice(banner.length);
    return {
      isCeph: true,
      version: 'v1 (msgr1)',
      banner: banner.trim(),
      remaining,
    };
  }

  return {
    isCeph: false,
    version: 'unknown',
    banner: text.substring(0, 64).trim(),
    remaining: new Uint8Array(0),
  };
}

/**
 * Parse MSGR v2 banner payload to extract feature flags.
 * After "ceph v2\n", the server sends:
 * - uint16 LE: banner payload length
 * - uint16 LE: banner payload length (repeated)
 * Then the payload with:
 * - uint64 LE: supported features
 * - uint64 LE: required features
 */
function parseMsgrV2Payload(data: Uint8Array): {
  supportedFeatures: bigint | null;
  requiredFeatures: bigint | null;
  payloadLength: number;
} {
  if (data.length < 4) {
    return { supportedFeatures: null, requiredFeatures: null, payloadLength: 0 };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len1 = view.getUint16(0, true);
  const len2 = view.getUint16(2, true);

  if (len1 !== len2 || len1 < 16 || data.length < 4 + len1) {
    return { supportedFeatures: null, requiredFeatures: null, payloadLength: len1 };
  }

  const supported = view.getBigUint64(4, true);
  const required = view.getBigUint64(12, true);

  return {
    supportedFeatures: supported,
    requiredFeatures: required,
    payloadLength: len1,
  };
}

/**
 * Parse MSGR v1 entity address from data after the banner.
 * The entity address contains:
 * - 4 bytes: entity type (LE)
 * - 4 bytes: nonce (LE)
 * - sockaddr data
 */
function parseMsgrV1EntityAddr(data: Uint8Array): {
  entityType: string;
  nonce: number;
  port: number | null;
  ipAddress: string | null;
} {
  if (data.length < 8) {
    return { entityType: 'unknown', nonce: 0, port: null, ipAddress: null };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Entity type is at offset 0
  const entityTypeNum = view.getUint32(0, true);
  const entityType = ENTITY_TYPES[entityTypeNum] || `unknown(${entityTypeNum})`;

  // Nonce at offset 4
  const nonce = view.getUint32(4, true);

  // After entity type + nonce, there's a sockaddr_storage structure
  // sockaddr_in: family(2) + port(2BE) + addr(4) + zero(8)
  let port: number | null = null;
  let ipAddress: string | null = null;

  if (data.length >= 16) {
    const family = view.getUint16(8, true);
    if (family === 2) {
      // AF_INET
      port = view.getUint16(10, false); // port is big-endian in sockaddr
      const a = data[12], b = data[13], c = data[14], d = data[15];
      ipAddress = `${a}.${b}.${c}.${d}`;
    } else if (family === 10 && data.length >= 32) {
      // AF_INET6
      port = view.getUint16(10, false);
      const parts: string[] = [];
      for (let i = 0; i < 8; i++) {
        parts.push(view.getUint16(16 + i * 2, false).toString(16));
      }
      ipAddress = parts.join(':');
    }
  }

  return { entityType, nonce, port, ipAddress };
}

/**
 * Handle Ceph Monitor connection test — reads banner and entity address info.
 */
export async function handleCephConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 6789, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
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

    const reader = socket.readable.getReader();

    // Read initial data — the server should send a banner immediately
    const initialData = await readExact(reader, 8, timeoutPromise);

    // We might need more data; try to read up to 256 bytes total
    let allData = initialData;
    try {
      const moreResult = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), 500),
        ),
      ]);
      if (!moreResult.done && moreResult.value) {
        const combined = new Uint8Array(allData.length + moreResult.value.length);
        combined.set(allData, 0);
        combined.set(moreResult.value, allData.length);
        allData = combined;
      }
    } catch {
      // Timeout reading more data is fine
    }

    const rtt = Date.now() - startTime;
    const detection = detectBanner(allData);

    let entityInfo = null;
    let v2Features = null;

    if (detection.isCeph) {
      if (detection.version.includes('v1') && detection.remaining.length >= 8) {
        entityInfo = parseMsgrV1EntityAddr(detection.remaining);
      } else if (detection.version.includes('v2') && detection.remaining.length >= 4) {
        v2Features = parseMsgrV2Payload(detection.remaining);
      }
    }

    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      isCeph: detection.isCeph,
      msgrVersion: detection.version,
      banner: detection.banner,
      entityInfo,
      v2Features: v2Features ? {
        supportedFeatures: v2Features.supportedFeatures?.toString() ?? null,
        requiredFeatures: v2Features.requiredFeatures?.toString() ?? null,
        payloadLength: v2Features.payloadLength,
      } : null,
      rawBytesReceived: allData.length,
      message: detection.isCeph
        ? `Ceph monitor detected (${detection.version}). Banner: "${detection.banner}"`
        : `Server responded but does not appear to be a Ceph monitor. Response: "${detection.banner}"`,
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
 * Handle Ceph Monitor probe — lightweight detection that just reads the banner.
 */
export async function handleCephProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 6789, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
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

    const reader = socket.readable.getReader();

    // Read at least 9 bytes (v1 banner length) for detection
    const data = await readExact(reader, 9, timeoutPromise);
    const rtt = Date.now() - startTime;

    const detection = detectBanner(data);

    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      isCeph: detection.isCeph,
      msgrVersion: detection.version,
      banner: detection.banner,
      message: detection.isCeph
        ? `Ceph monitor detected (${detection.version}).`
        : `Not a Ceph monitor. Response: "${detection.banner}"`,
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
