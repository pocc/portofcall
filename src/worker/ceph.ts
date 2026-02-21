/**
 * Ceph Monitor MSGR Protocol Implementation
 *
 * Implements Ceph Monitor connectivity testing via the MSGR (Messenger) protocol.
 * Default ports: 6789 (v1 legacy / combined) or 3300 (v2 msgr2-only).
 * Ceph monitors are the central coordination daemons for Ceph distributed storage
 * clusters, responsible for maintaining cluster maps and consensus via Paxos.
 *
 * Protocol Flow (MSGR v1 - legacy, pre-Nautilus):
 * 1. Server sends banner: "ceph v027\n" (9 bytes ASCII)
 * 2. Server sends entity_addr_t: type(4 LE) + nonce(4 LE) + sockaddr_storage(128) = 136 bytes
 * 3. Client sends its banner + entity_addr_t (same format)
 * 4. Client sends ceph_msg_connect (features, host_type, etc.)
 * 5. Server replies with ceph_msg_connect_reply: tag(1) + features(8 LE) + global_seq(4 LE) +
 *    connect_seq(4 LE) + protocol_version(4 LE) + authorizer_len(4 LE) + flags(1) = 26 bytes
 *
 * Protocol Flow (MSGR v2 - modern, Ceph Nautilus 14.2+):
 * 1. Server sends banner: "ceph v2\n" (8 bytes ASCII)
 * 2. Server sends 2x uint16 LE payload lengths (both identical, 4 bytes total)
 * 3. Banner payload contains supported(8 LE) + required(8 LE) feature flags = 16 bytes
 * 4. Client echoes its own banner + payload in the same format
 * 5. Frame-based communication with optional TLS follows
 *
 * sockaddr_storage note: Ceph encodes sockaddr in Linux-native byte order.
 * sa_family is little-endian, sin_port is network byte order (big-endian).
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

// Entity types in Ceph (from CEPH_ENTITY_TYPE_* in msg_types.h)
const ENTITY_TYPES: Record<number, string> = {
  0x01: 'mon',      // Monitor
  0x02: 'mds',      // Metadata Server
  0x04: 'osd',      // Object Storage Daemon
  0x08: 'client',   // Client
  0x10: 'mgr',      // Manager
  0x20: 'auth',     // Authentication
  0xFF: 'any',      // Any (CEPH_ENTITY_TYPE_ANY)
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

  // After entity type + nonce, there's a sockaddr_storage structure (128 bytes).
  // Ceph encodes sockaddr_storage in host byte order (Linux = little-endian).
  // sockaddr_in layout:  sa_family(2 LE) + sin_port(2 BE) + sin_addr(4) + zero(8)
  // sockaddr_in6 layout: sa_family(2 LE) + sin6_port(2 BE) + sin6_flowinfo(4) + sin6_addr(16)
  let port: number | null = null;
  let ipAddress: string | null = null;

  if (data.length >= 16) {
    // sa_family is little-endian on the wire (Linux native byte order)
    const family = view.getUint16(8, true);
    if (family === 2) {
      // AF_INET: port is network byte order (big-endian)
      port = view.getUint16(10, false);
      const a = data[12], b = data[13], c = data[14], d = data[15];
      ipAddress = `${a}.${b}.${c}.${d}`;
    } else if (family === 10 && data.length >= 32) {
      // AF_INET6: port is network byte order (big-endian), addr at offset 16 within sockaddr
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

// ─── MSGR v1 handshake completion ────────────────────────────────────────────

// Ceph feature flags (subset for client CONNECT)
const CEPH_FEATURES_CLIENT = 0x3ffffffffffffffn; // liberal set of feature bits

// Host types
const CEPH_ENTITY_TYPE_CLIENT = 0x08;

/**
 * Build MSGR v1 client banner + entity address.
 * The server sends its banner first, then we echo ours back, followed by our entity address.
 */
function buildClientBannerAndAddr(): Uint8Array {
  // Client banner: "ceph v027\n" (9 bytes)
  const banner = new TextEncoder().encode('ceph v027\n');

  // entity_addr_t: type(4) + nonce(4) + sockaddr_storage(128) = 136 bytes
  // We send all zeros (anonymous client address)
  const entityAddr = new Uint8Array(136);
  const eav = new DataView(entityAddr.buffer);
  eav.setUint32(0, CEPH_ENTITY_TYPE_CLIENT, true); // entity type = client
  // nonce = 0, everything else = 0

  const combined = new Uint8Array(banner.length + entityAddr.length);
  combined.set(banner, 0);
  combined.set(entityAddr, banner.length);
  return combined;
}

/**
 * Build a MSGR v1 CONNECT message for a client connecting to a monitor.
 */
function buildConnectMessage(): Uint8Array {
  // CONNECT message body:
  // - features: uint64 LE (8)
  // - host_type: uint32 LE (4)
  // - global_seq: uint32 LE (4)
  // - connect_seq: uint32 LE (4)
  // - protocol_version: uint32 LE (4)
  // - authorizer_protocol: uint32 LE (4)
  // - authorizer_len: uint32 LE (4)
  // - flags: uint8 (1)
  // Total: 33 bytes body

  const body = new Uint8Array(33);
  const bv = new DataView(body.buffer);

  // Write feature flags (uint64 LE)
  bv.setBigUint64(0, CEPH_FEATURES_CLIENT, true);
  // host_type: MON_CLIENT → write CEPH_ENTITY_TYPE_CLIENT
  bv.setUint32(8, CEPH_ENTITY_TYPE_CLIENT, true);
  // global_seq = 0
  bv.setUint32(12, 0, true);
  // connect_seq = 0
  bv.setUint32(16, 0, true);
  // protocol_version = 1 (mon client protocol)
  bv.setUint32(20, 1, true);
  // authorizer_protocol = 0 (CEPH_AUTH_UNKNOWN)
  bv.setUint32(24, 0, true);
  // authorizer_len = 0
  bv.setUint32(28, 0, true);
  // flags = 0
  body[32] = 0;

  // MSGR v1 message header: type(2 LE) + priority(2 LE) + version(2 LE) + body_len(4 LE) + ...
  // For connection setup messages, the header differs — the server just reads the CONNECT body directly
  // after the address exchange. We send the body as-is.
  return body;
}

/**
 * POST /api/ceph/cluster-info
 *
 * Completes the MSGR v1 handshake:
 * 1. Read server banner + entity address
 * 2. Send client banner + entity address
 * 3. Send CONNECT message
 * 4. Read CONNECT_REPLY (reveals auth requirement, features, etc.)
 */
export async function handleCephClusterInfo(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 6789, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required parameter: host' }), {
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
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);
    const deadline = startTime + timeout;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    await Promise.race([socket.opened, timeoutPromise]);
    const connectTime = Date.now() - startTime;

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    try {
      // Step 1: Read server banner (9 bytes "ceph v027\n")
      const bannerData = await readExact(reader, 9, timeoutPromise);
      const serverBanner = new TextDecoder().decode(bannerData).trim();

      const isCeph = serverBanner.startsWith('ceph v0') || serverBanner.startsWith('ceph v2');
      if (!isCeph) {
        return new Response(JSON.stringify({
          success: false,
          host, port,
          error: `Not a Ceph monitor. Banner: "${serverBanner}"`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const msgrVersion = serverBanner.startsWith('ceph v2') ? 'v2 (msgr2)' : 'v1 (msgr1)';

      // For MSGR v2, the handshake is different — just report what we know
      if (msgrVersion === 'v2 (msgr2)') {
        // Read the 4-byte payload length header
        const payloadHdr = await readExact(reader, 4, timeoutPromise);
        const phv = new DataView(payloadHdr.buffer);
        const payloadLen = phv.getUint16(0, true);
        let features: { supported?: string; required?: string } = {};

        if (payloadLen >= 16) {
          const payload = await readExact(reader, payloadLen, timeoutPromise);
          const pv = new DataView(payload.buffer);
          if (payload.length >= 16) {
            features = {
              supported: '0x' + pv.getBigUint64(0, true).toString(16),
              required: '0x' + pv.getBigUint64(8, true).toString(16),
            };
          }
        }

        return new Response(JSON.stringify({
          success: true,
          host, port,
          connectTimeMs: connectTime,
          msgrVersion,
          serverBanner,
          features,
          note: 'MSGR v2 handshake requires TLS/auth negotiation; feature flags extracted',
          message: `Ceph monitor detected (${msgrVersion}). Feature flags: ${JSON.stringify(features)}`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // MSGR v1: Step 2 — read server entity address (136 bytes)
      const serverEntityAddr = await readExact(reader, 136, timeoutPromise);
      const seav = new DataView(serverEntityAddr.buffer);
      const serverEntityType = seav.getUint32(0, true);
      const serverNonce = seav.getUint32(4, true);
      // sa_family is little-endian (Linux native byte order in sockaddr_storage)
      const serverAddrFamily = seav.getUint16(8, true);
      let serverIp: string | null = null;
      let serverAddrPort: number | null = null;

      if (serverAddrFamily === 2 && serverEntityAddr.length >= 16) {
        // sin_port is network byte order (big-endian)
        serverAddrPort = seav.getUint16(10, false);
        serverIp = `${serverEntityAddr[12]}.${serverEntityAddr[13]}.${serverEntityAddr[14]}.${serverEntityAddr[15]}`;
      }

      // Step 3: Send client banner + entity address
      const clientData = buildClientBannerAndAddr();
      await writer.write(clientData);

      // Step 4: Send CONNECT message
      const connectMsg = buildConnectMessage();
      await writer.write(connectMsg);

      // Step 5: Read CONNECT_REPLY
      // ceph_msg_connect_reply layout (packed struct, 26 bytes):
      //   tag(1) + features(8 LE) + global_seq(4 LE) + connect_seq(4 LE) +
      //   protocol_version(4 LE) + authorizer_len(4 LE) + flags(1)
      const replyTimeout = Math.min(5000, deadline - Date.now());
      let connectReply: {
        tag: number;
        tagName: string;
        features?: string;
        globalSeq?: number;
        connectSeq?: number;
        protocolVersion?: number;
        authLen?: number;
        flags?: number;
      } | null = null;

      try {
        const replyData = await readExact(reader, 26, new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), replyTimeout),
        ));

        if (replyData.length >= 26) {
          const rv = new DataView(replyData.buffer, replyData.byteOffset, replyData.byteLength);
          // Tag is the FIRST byte (CEPH_MSGR_TAG_*)
          const tag = replyData[0];
          const features = rv.getBigUint64(1, true);
          const globalSeq = rv.getUint32(9, true);
          const connectSeq = rv.getUint32(13, true);
          const protocolVersion = rv.getUint32(17, true);
          const authLen = rv.getUint32(21, true);
          const flags = replyData[25];

          // CEPH_MSGR_TAG_* values from include/msgr.h
          const TAG_NAMES: Record<number, string> = {
            1: 'READY',
            2: 'RESETSESSION',
            3: 'WAIT',
            4: 'RETRY_SESSION',
            5: 'RETRY_GLOBAL',
            6: 'CLOSE',
            7: 'MSG',
            8: 'ACK',
            9: 'KEEPALIVE',
            10: 'BADPROTOVER',
            11: 'BADAUTHORIZER',
            12: 'FEATURES',
            13: 'SEQ',
            14: 'KEEPALIVE2',
            15: 'KEEPALIVE2_ACK',
            16: 'CHALLENGE_AUTHORIZER',
          };

          connectReply = {
            tag,
            tagName: TAG_NAMES[tag] ?? `UNKNOWN_${tag}`,
            features: '0x' + features.toString(16),
            globalSeq,
            connectSeq,
            protocolVersion,
            authLen,
            flags,
          };
        }
      } catch {
        // Timeout reading CONNECT_REPLY — still useful partial info
      }

      const rtt = Date.now() - startTime;

      return new Response(JSON.stringify({
        success: true,
        host, port, rtt,
        connectTimeMs: connectTime,
        msgrVersion,
        serverBanner,
        serverEntity: {
          type: ENTITY_TYPES[serverEntityType] ?? `unknown(${serverEntityType})`,
          typeCode: serverEntityType,
          nonce: serverNonce,
          ip: serverIp,
          port: serverAddrPort,
          addressFamily: serverAddrFamily === 2 ? 'IPv4' : serverAddrFamily === 10 ? 'IPv6' : `unknown(${serverAddrFamily})`,
        },
        connectReply,
        handshakeComplete: connectReply?.tagName === 'READY',
        authRequired: connectReply?.tagName === 'BADAUTHORIZER' || connectReply?.tagName === 'CHALLENGE_AUTHORIZER',
        message: connectReply
          ? `MSGR v1 handshake completed. Server tag: ${connectReply.tagName}. Protocol v${connectReply.protocolVersion}`
          : `MSGR v1 handshake partial. Server entity: ${ENTITY_TYPES[serverEntityType] ?? serverEntityType} at ${serverIp}:${serverAddrPort}`,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { writer.releaseLock(); } catch { /* ignore */ }
      socket.close();
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * POST /api/ceph/rest-health
 *
 * Queries Ceph cluster health via the Ceph MGR RESTful API.
 * Requires the 'restful' MGR module enabled: `ceph mgr module enable restful`
 *
 * Body: { host, port=8003, apiKey?, apiSecret?, timeout=10000 }
 */
export async function handleCephRestHealth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      apiKey?: string;
      apiSecret?: string;
      timeout?: number;
      useDashboard?: boolean;
      username?: string;
      password?: string;
    };

    const {
      host,
      port = 8003,
      apiKey,
      apiSecret,
      timeout = 10000,
      useDashboard = false,
      username,
      password,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required parameter: host' }), {
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
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    // Auth: basic auth for MGR restful module, or Dashboard API
    if (apiKey && apiSecret) {
      const ab = new TextEncoder().encode(`${apiKey}:${apiSecret}`);
      let ab2 = '';
      for (const byte of ab) ab2 += String.fromCharCode(byte);
      headers['Authorization'] = `Basic ${btoa(ab2)}`;
    } else if (username && password) {
      const ub = new TextEncoder().encode(`${username}:${password}`);
      let ub2 = '';
      for (const byte of ub) ub2 += String.fromCharCode(byte);
      headers['Authorization'] = `Basic ${btoa(ub2)}`;
    }

    const scheme = port === 8003 ? 'https' : 'http';
    const baseUrl = `${scheme}://${host}:${port}`;

    // Try multiple endpoints depending on whether we're hitting RESTful module or Dashboard
    const endpoints = useDashboard
      ? [`${baseUrl}/api/health/full`, `${baseUrl}/api/summary`]
      : [`${baseUrl}/api/health/full`, `${baseUrl}/api/summary`, `${baseUrl}/request?wait=1`];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const results: Array<{ url: string; status?: number; data?: unknown; error?: string }> = [];

    for (const url of endpoints) {
      try {
        const resp = await fetch(url, {
          headers,
          signal: controller.signal,
        });

        let data: unknown;
        const ct = resp.headers.get('content-type') ?? '';
        if (ct.includes('application/json')) {
          data = await resp.json();
        } else {
          data = await resp.text();
        }

        results.push({ url, status: resp.status, data });
        if (resp.ok) break; // Stop on first success
      } catch (fetchErr) {
        results.push({ url, status: 0, error: fetchErr instanceof Error ? fetchErr.message : 'fetch failed' });
      }
    }

    clearTimeout(timer);

    const success = results.some(r => r.status !== undefined && r.status >= 200 && r.status < 300);
    const healthResult = results.find(r => r.status !== undefined && r.status >= 200 && r.status < 300);

    return new Response(JSON.stringify({
      success,
      host, port,
      baseUrl,
      endpoints: results,
      health: healthResult?.data ?? null,
      message: success
        ? 'Ceph REST API reachable. Health data retrieved.'
        : 'Ceph REST API not reachable. Check MGR restful module is enabled and credentials are correct.',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

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

// ─── MGR REST API helpers ─────────────────────────────────────────────────────

/**
 * Build auth headers and base URL for the Ceph MGR REST API.
 */
function mgrAuth(body: {
  host: string;
  port?: number;
  apiKey?: string;
  apiSecret?: string;
  username?: string;
  password?: string;
}): { baseUrl: string; headers: Record<string, string> } {
  const port = body.port ?? 8003;
  const scheme = port === 8003 ? 'https' : 'http';
  const baseUrl = `${scheme}://${body.host}:${port}`;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (body.apiKey && body.apiSecret) {
    const ab = new TextEncoder().encode(`${body.apiKey}:${body.apiSecret}`);
    let ab2 = '';
    for (const byte of ab) ab2 += String.fromCharCode(byte);
    headers['Authorization'] = `Basic ${btoa(ab2)}`;
  } else if (body.username && body.password) {
    const ub = new TextEncoder().encode(`${body.username}:${body.password}`);
    let ub2 = '';
    for (const byte of ub) ub2 += String.fromCharCode(byte);
    headers['Authorization'] = `Basic ${btoa(ub2)}`;
  }

  return { baseUrl, headers };
}

/**
 * POST /api/ceph/osd-list
 *
 * Queries the Ceph MGR RESTful API for OSD status.
 * Body: { host, port=8003, apiKey?, apiSecret?, username?, password?, timeout=10000 }
 */
export async function handleCephOSDList(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number;
      apiKey?: string; apiSecret?: string;
      username?: string; password?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required parameter: host' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(body.host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(body.host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeout = body.timeout ?? 10000;
    const { baseUrl, headers } = mgrAuth(body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const endpoints = [
      `${baseUrl}/api/osd`,
      `${baseUrl}/api/osd/tree`,
    ];

    const results: Array<{ url: string; status?: number; data?: unknown; error?: string }> = [];

    for (const url of endpoints) {
      try {
        const resp = await fetch(url, { headers, signal: controller.signal });
        const ct = resp.headers.get('content-type') ?? '';
        const data = ct.includes('application/json') ? await resp.json() : await resp.text();
        results.push({ url, status: resp.status, data });
        if (resp.ok) break;
      } catch (fetchErr) {
        results.push({ url, error: fetchErr instanceof Error ? fetchErr.message : 'fetch failed' });
      }
    }

    clearTimeout(timer);

    const success = results.some(r => r.status !== undefined && r.status >= 200 && r.status < 300);
    const successResult = results.find(r => r.status !== undefined && r.status >= 200 && r.status < 300);

    return new Response(JSON.stringify({
      success,
      host: body.host,
      port: body.port ?? 8003,
      baseUrl,
      endpoints: results,
      osds: successResult?.data ?? null,
      message: success
        ? 'OSD data retrieved from Ceph MGR REST API.'
        : 'Could not retrieve OSD data. Ensure MGR restful module is enabled.',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * POST /api/ceph/pool-list
 *
 * Queries the Ceph MGR RESTful API for pool information.
 * Body: { host, port=8003, apiKey?, apiSecret?, username?, password?, timeout=10000 }
 */
export async function handleCephPoolList(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number;
      apiKey?: string; apiSecret?: string;
      username?: string; password?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required parameter: host' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(body.host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(body.host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeout = body.timeout ?? 10000;
    const { baseUrl, headers } = mgrAuth(body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const endpoints = [`${baseUrl}/api/pool`, `${baseUrl}/api/pool?stats=true`];

    const results: Array<{ url: string; status?: number; data?: unknown; error?: string }> = [];

    for (const url of endpoints) {
      try {
        const resp = await fetch(url, { headers, signal: controller.signal });
        const ct = resp.headers.get('content-type') ?? '';
        const data = ct.includes('application/json') ? await resp.json() : await resp.text();
        results.push({ url, status: resp.status, data });
        if (resp.ok) break;
      } catch (fetchErr) {
        results.push({ url, error: fetchErr instanceof Error ? fetchErr.message : 'fetch failed' });
      }
    }

    clearTimeout(timer);

    const success = results.some(r => r.status !== undefined && r.status >= 200 && r.status < 300);
    const successResult = results.find(r => r.status !== undefined && r.status >= 200 && r.status < 300);

    return new Response(JSON.stringify({
      success,
      host: body.host,
      port: body.port ?? 8003,
      baseUrl,
      endpoints: results,
      pools: successResult?.data ?? null,
      message: success
        ? 'Pool data retrieved from Ceph MGR REST API.'
        : 'Could not retrieve pool data. Ensure MGR restful module is enabled.',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
