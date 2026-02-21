/**
 * BGP (Border Gateway Protocol) Implementation
 *
 * Implements BGP connectivity testing via the BGP-4 protocol (port 179).
 * BGP is the routing protocol that makes the Internet work, exchanging
 * routing information between autonomous systems.
 *
 * Protocol Flow:
 * 1. Client connects to port 179
 * 2. Client sends OPEN message (version, AS number, hold time, router ID)
 * 3. Server responds with OPEN or NOTIFICATION
 * 4. If OPEN received, exchange KEEPALIVEs to confirm session
 *
 * Message Format:
 * - 16-byte marker (all 0xFF)
 * - 2-byte length
 * - 1-byte type (1=OPEN, 2=UPDATE, 3=NOTIFICATION, 4=KEEPALIVE)
 *
 * Use Cases:
 * - BGP speaker connectivity testing
 * - Router/peer version detection
 * - AS number verification
 * - Hold time negotiation check
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// BGP message types
const MSG_OPEN = 1;
const MSG_UPDATE = 2;
const MSG_NOTIFICATION = 3;
const MSG_KEEPALIVE = 4;

// BGP NOTIFICATION error codes
const ERROR_NAMES: Record<number, string> = {
  1: 'Message Header Error',
  2: 'OPEN Message Error',
  3: 'UPDATE Message Error',
  4: 'Hold Timer Expired',
  5: 'Finite State Machine Error',
  6: 'Cease',
};

// OPEN Message Error subcodes
const OPEN_ERROR_SUBCODES: Record<number, string> = {
  1: 'Unsupported Version Number',
  2: 'Bad Peer AS',
  3: 'Bad BGP Identifier',
  4: 'Unsupported Optional Parameter',
  5: 'Deprecated (Auth Failure)',
  6: 'Unacceptable Hold Time',
  7: 'Unsupported Capability',
};

/**
 * Build a BGP OPEN message
 */
function buildOpenMessage(localAS: number, holdTime: number, routerId: string): Uint8Array {
  // Parse router ID as IPv4
  const routerIdParts = routerId.split('.').map(Number);
  if (routerIdParts.length !== 4 || routerIdParts.some(p => isNaN(p) || p < 0 || p > 255)) {
    throw new Error('Invalid router ID format (must be IPv4 address)');
  }

  // OPEN message: version(1) + AS(2) + holdTime(2) + routerID(4) + optParamLen(1) = 10 bytes
  // Total: 19 (header) + 10 (open) = 29 bytes
  const length = 29;
  const msg = new Uint8Array(length);
  const view = new DataView(msg.buffer);

  // Marker: 16 bytes of 0xFF
  for (let i = 0; i < 16; i++) {
    msg[i] = 0xFF;
  }

  // Length
  view.setUint16(16, length);

  // Type: OPEN
  msg[18] = MSG_OPEN;

  // Version: BGP-4
  msg[19] = 4;

  // My Autonomous System (2 bytes)
  view.setUint16(20, localAS & 0xFFFF);

  // Hold Time (2 bytes)
  view.setUint16(22, holdTime);

  // BGP Identifier (Router ID as 4 IPv4 octets)
  msg[24] = routerIdParts[0];
  msg[25] = routerIdParts[1];
  msg[26] = routerIdParts[2];
  msg[27] = routerIdParts[3];

  // Optional Parameters Length: 0
  msg[28] = 0;

  return msg;
}

/**
 * Build a BGP KEEPALIVE message
 */
function buildKeepaliveMessage(): Uint8Array {
  const msg = new Uint8Array(19);
  for (let i = 0; i < 16; i++) {
    msg[i] = 0xFF;
  }
  const view = new DataView(msg.buffer);
  view.setUint16(16, 19);
  msg[18] = MSG_KEEPALIVE;
  return msg;
}

/**
 * Parse a BGP message from raw bytes
 */
function parseBGPMessage(data: Uint8Array): {
  type: number;
  typeName: string;
  length: number;
  // OPEN fields
  version?: number;
  peerAS?: number;
  holdTime?: number;
  routerId?: string;
  optParamLen?: number;
  capabilities?: string[];
  fourByteAS?: boolean;
  // NOTIFICATION fields
  errorCode?: number;
  errorSubcode?: number;
  errorName?: string;
  errorDetail?: string;
} | null {
  if (data.length < 19) return null;

  // Verify marker (16 bytes of 0xFF)
  for (let i = 0; i < 16; i++) {
    if (data[i] !== 0xFF) return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const length = view.getUint16(16);
  const type = data[18];

  const typeNames: Record<number, string> = {
    [MSG_OPEN]: 'OPEN',
    [MSG_UPDATE]: 'UPDATE',
    [MSG_NOTIFICATION]: 'NOTIFICATION',
    [MSG_KEEPALIVE]: 'KEEPALIVE',
  };

  const result: ReturnType<typeof parseBGPMessage> = {
    type,
    typeName: typeNames[type] || `UNKNOWN(${type})`,
    length,
  };

  if (type === MSG_OPEN && data.length >= 29) {
    result.version = data[19];
    result.peerAS = view.getUint16(20);
    result.holdTime = view.getUint16(22);
    result.routerId = `${data[24]}.${data[25]}.${data[26]}.${data[27]}`;
    result.optParamLen = data[28];

    // Parse optional parameters for capabilities
    if (result.optParamLen && result.optParamLen > 0 && data.length >= 29 + result.optParamLen) {
      const parsed = parseCapabilities(data.slice(29, 29 + result.optParamLen));
      result.capabilities = parsed.names;
      result.fourByteAS = parsed.codes.has(65);
    }
  }

  if (type === MSG_NOTIFICATION && data.length >= 21) {
    result.errorCode = data[19];
    result.errorSubcode = data[20];
    result.errorName = ERROR_NAMES[result.errorCode] || `Unknown(${result.errorCode})`;

    if (result.errorCode === 2) {
      result.errorDetail = OPEN_ERROR_SUBCODES[result.errorSubcode] || `Subcode ${result.errorSubcode}`;
    } else {
      result.errorDetail = `Subcode ${result.errorSubcode}`;
    }
  }

  return result;
}

/**
 * Parse BGP optional parameters / capabilities.
 * Returns both human-readable capability names and the set of capability codes.
 */
function parseCapabilities(data: Uint8Array): { names: string[]; codes: Set<number> } {
  const names: string[] = [];
  const codes = new Set<number>();
  let offset = 0;

  const capNames: Record<number, string> = {
    1: 'Multiprotocol Extensions',
    2: 'Route Refresh',
    64: 'Graceful Restart',
    65: '4-Octet AS Number',
    69: 'ADD-PATH',
    70: 'Enhanced Route Refresh',
    71: 'Long-Lived Graceful Restart',
    73: 'FQDN Capability',
    128: 'Route Refresh (old)',
  };

  while (offset < data.length) {
    if (offset + 2 > data.length) break;
    const paramType = data[offset];
    const paramLen = data[offset + 1];
    offset += 2;

    if (paramType === 2) { // Capability
      let capOffset = 0;
      while (capOffset < paramLen && offset + capOffset + 2 <= data.length) {
        const capCode = data[offset + capOffset];
        const capLen = data[offset + capOffset + 1];
        const name = capNames[capCode] || `Capability(${capCode})`;
        names.push(name);
        codes.add(capCode);
        capOffset += 2 + capLen;
      }
    }

    offset += paramLen;
  }

  return { names, codes };
}

/**
 * Format a Uint8Array as a space-separated hex string
 */
function toHexString(data: Uint8Array): string {
  return Array.from(data)
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
}

// ─── Route types ──────────────────────────────────────────────────────────────

interface BGPRoute {
  prefix: string;
  withdrawn: boolean;
  origin?: string;
  asPath?: string;
  asList?: number[];
  nextHop?: string;
  med?: number;
  localPref?: number;
}

// ─── OPEN with capabilities ───────────────────────────────────────────────────

/**
 * Build a BGP OPEN with Capability optional parameters:
 *   - Code 1 (Multiprotocol Extensions): AFI=1 IPv4, SAFI=1 Unicast
 *   - Code 2 (Route Refresh)
 *   - Code 65 (4-Octet AS Number): full 32-bit ASN
 */
function buildOpenMessageWithCaps(localAS: number, holdTime: number, routerId: string): Uint8Array {
  const routerIdParts = routerId.split('.').map(Number);
  if (routerIdParts.length !== 4 || routerIdParts.some(p => isNaN(p) || p < 0 || p > 255)) {
    throw new Error('Invalid router ID format (must be IPv4 address)');
  }

  // Cap 1: Multiprotocol Extensions (AFI=1, reserved=0, SAFI=1) → value 4 bytes
  const cap1 = new Uint8Array([1, 4, 0, 1, 0, 1]);
  // Cap 2: Route Refresh → no value
  const cap2 = new Uint8Array([2, 0]);
  // Cap 65: 4-Octet AS Number → 4-byte ASN
  const cap65 = new Uint8Array(6);
  cap65[0] = 65; cap65[1] = 4;
  new DataView(cap65.buffer).setUint32(2, localAS, false);

  const capData = new Uint8Array(cap1.length + cap2.length + cap65.length);
  let coff = 0;
  capData.set(cap1, coff); coff += cap1.length;
  capData.set(cap2, coff); coff += cap2.length;
  capData.set(cap65, coff);

  const optParam = new Uint8Array(2 + capData.length);
  optParam[0] = 2; // Capabilities optional parameter
  optParam[1] = capData.length;
  optParam.set(capData, 2);

  const bodyLen = 10 + optParam.length;
  const totalLen = 19 + bodyLen;
  const msg = new Uint8Array(totalLen);
  const view = new DataView(msg.buffer);

  for (let i = 0; i < 16; i++) msg[i] = 0xFF;
  view.setUint16(16, totalLen, false);
  msg[18] = MSG_OPEN;
  msg[19] = 4; // BGP-4
  view.setUint16(20, localAS > 65535 ? 23456 : localAS, false); // AS_TRANS for 4-byte ASNs
  view.setUint16(22, holdTime, false);
  msg[24] = routerIdParts[0]; msg[25] = routerIdParts[1];
  msg[26] = routerIdParts[2]; msg[27] = routerIdParts[3];
  msg[28] = optParam.length;
  msg.set(optParam, 29);

  return msg;
}

// ─── UPDATE parser ────────────────────────────────────────────────────────────

/**
 * Parse a BGP UPDATE message and return withdrawn and reachable routes.
 *
 * UPDATE format (after the 19-byte BGP header):
 *   2 bytes  — Withdrawn Routes Length
 *   variable — Withdrawn routes as NLRI (length/prefix pairs)
 *   2 bytes  — Path Attributes Length
 *   variable — Path attributes (type, flags, length, value)
 *   variable — NLRI (reachable routes, rest of message)
 */
function parseUpdateMessage(data: Uint8Array, fourByteAS = false): {
  withdrawn: BGPRoute[];
  reachable: BGPRoute[];
  attributes: Record<string, unknown>;
} {
  const empty = { withdrawn: [], reachable: [], attributes: {} };
  if (data.length < 23) return empty; // header(19) + min 4 bytes

  const view = new DataView(data.buffer, data.byteOffset);
  const totalLength = view.getUint16(16, false);
  const header = 19;

  // Withdrawn routes
  if (header + 2 > data.length) return empty;
  const withdrawnLen = view.getUint16(header, false);
  const withdrawn: BGPRoute[] = [];
  let offset = header + 2;
  const withdrawnEnd = offset + withdrawnLen;

  while (offset < withdrawnEnd && offset < data.length) {
    const prefixLen = data[offset++];
    const byteCount = Math.ceil(prefixLen / 8);
    if (offset + byteCount > data.length) break;
    const pb = [0, 0, 0, 0];
    for (let i = 0; i < byteCount && i < 4; i++) pb[i] = data[offset + i];
    withdrawn.push({ prefix: `${pb.join('.')}/${prefixLen}`, withdrawn: true });
    offset += byteCount;
  }

  offset = withdrawnEnd;
  if (offset + 2 > data.length) return { withdrawn, reachable: [], attributes: {} };

  // Path attributes
  const attrLen = view.getUint16(offset, false); offset += 2;
  const attrEnd = offset + attrLen;
  const attributes: Record<string, unknown> = {};
  const routeAttrs: {
    origin?: string; asPath?: string; asList?: number[];
    nextHop?: string; med?: number; localPref?: number;
  } = {};

  while (offset + 2 < attrEnd && offset + 2 <= data.length) {
    const flags    = data[offset++];
    const typeCode = data[offset++];
    const extended = (flags & 0x10) !== 0;
    let attrLength: number;
    if (extended) {
      if (offset + 2 > data.length) break;
      attrLength = view.getUint16(offset, false); offset += 2;
    } else {
      if (offset >= data.length) break;
      attrLength = data[offset++];
    }
    if (offset + attrLength > data.length) break;
    const av = data.slice(offset, offset + attrLength);
    const avView = new DataView(av.buffer, av.byteOffset);
    offset += attrLength;

    switch (typeCode) {
      case 1: // ORIGIN
        attributes.origin = routeAttrs.origin = (['IGP', 'EGP', 'INCOMPLETE'])[av[0]] ?? `UNKNOWN(${av[0]})`;
        break;
      case 2: { // AS_PATH — segments: type(1) + count(1) + count×asSize bytes
        // Per RFC 6793: when 4-octet AS capability is negotiated, each ASN
        // in the AS_PATH is encoded as 4 bytes; otherwise 2 bytes.
        const asSize = fourByteAS ? 4 : 2;
        const segments: string[] = [];
        const asList: number[] = [];
        let sp = 0;
        while (sp + 2 <= av.length) {
          const segType  = av[sp++];
          const segCount = av[sp++];
          const asns: number[] = [];
          for (let i = 0; i < segCount && sp + asSize <= av.length; i++) {
            if (fourByteAS) {
              asns.push(avView.getUint32(sp, false));
            } else {
              asns.push(avView.getUint16(sp, false));
            }
            sp += asSize;
          }
          asList.push(...asns);
          segments.push(segType === 1 ? `{${asns.join(',')}}` : asns.join(' '));
        }
        routeAttrs.asPath = segments.join(' ');
        routeAttrs.asList = asList;
        attributes.asPath = routeAttrs.asPath;
        break;
      }
      case 3: // NEXT_HOP
        if (av.length >= 4) {
          routeAttrs.nextHop = `${av[0]}.${av[1]}.${av[2]}.${av[3]}`;
          attributes.nextHop = routeAttrs.nextHop;
        }
        break;
      case 4: // MULTI_EXIT_DISC
        if (av.length >= 4) { routeAttrs.med = avView.getUint32(0, false); attributes.med = routeAttrs.med; }
        break;
      case 5: // LOCAL_PREF
        if (av.length >= 4) { routeAttrs.localPref = avView.getUint32(0, false); attributes.localPref = routeAttrs.localPref; }
        break;
      case 6: // ATOMIC_AGGREGATE
        attributes.atomicAggregate = true;
        break;
      case 7: // AGGREGATOR
        // Per RFC 6793: AGGREGATOR uses 4-byte AS (8 bytes total) when
        // 4-octet AS is negotiated, otherwise 2-byte AS (6 bytes total).
        if (fourByteAS && av.length >= 8) {
          attributes.aggregator = { as: avView.getUint32(0, false), ip: `${av[4]}.${av[5]}.${av[6]}.${av[7]}` };
        } else if (av.length >= 6) {
          attributes.aggregator = { as: avView.getUint16(0, false), ip: `${av[2]}.${av[3]}.${av[4]}.${av[5]}` };
        }
        break;
    }
  }

  // NLRI: reachable prefixes after attributes, up to totalLength
  const reachable: BGPRoute[] = [];
  offset = attrEnd;
  while (offset < totalLength && offset < data.length) {
    const prefixLen = data[offset++];
    const byteCount = Math.ceil(prefixLen / 8);
    if (offset + byteCount > data.length) break;
    const pb = [0, 0, 0, 0];
    for (let i = 0; i < byteCount && i < 4; i++) pb[i] = data[offset + i];
    reachable.push({
      prefix: `${pb.join('.')}/${prefixLen}`, withdrawn: false,
      origin:    routeAttrs.origin,
      asPath:    routeAttrs.asPath,
      asList:    routeAttrs.asList,
      nextHop:   routeAttrs.nextHop,
      med:       routeAttrs.med,
      localPref: routeAttrs.localPref,
    });
    offset += byteCount;
  }

  return { withdrawn, reachable, attributes };
}

// ─── POST /api/bgp/route-table ────────────────────────────────────────────────

/**
 * Establish a full BGP session with the peer, then collect and decode UPDATE
 * messages for a configurable duration to build a snapshot of the route table.
 *
 * Flow:
 *   1. Connect → send OPEN (with capabilities: multiprotocol, route-refresh, 4-octet AS)
 *   2. Read peer OPEN → send KEEPALIVE
 *   3. Read peer KEEPALIVE (session confirmed)
 *   4. Collect UPDATE messages for `collectMs` milliseconds
 *   5. Return decoded routes (NLRI + path attributes) and withdrawn prefixes
 *
 * Request body:
 *   host       — BGP peer hostname/IP (required)
 *   port       — TCP port (default: 179)
 *   localAS    — Our AS number (default: 65000)
 *   routerId   — Our BGP router ID (default: '10.0.0.1')
 *   holdTime   — Proposed hold time in seconds (default: 90)
 *   collectMs  — How long to collect routes after session open (default: 5000)
 *   maxRoutes  — Maximum routes to collect before stopping (default: 1000)
 *   timeout    — Total connection timeout in ms (default: 30000)
 *
 * Response: { success, peerOpen, session, routes, withdrawnRoutes, routeCount, withdrawnCount }
 */
export async function handleBGPRouteTable(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let host = '';
  let port = 179;

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      localAS?: number;
      routerId?: string;
      holdTime?: number;
      collectMs?: number;
      maxRoutes?: number;
      timeout?: number;
    };

    host = body.host ?? '';
    port = body.port ?? 179;
    const localAS   = body.localAS   ?? 65000;
    const routerId  = body.routerId  ?? '10.0.0.1';
    const holdTime  = body.holdTime  ?? 90;
    const collectMs = Math.min(body.collectMs ?? 5000, 30000);
    const maxRoutes = Math.min(body.maxRoutes ?? 1000, 10000);
    const timeout   = body.timeout   ?? 30000;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be 1–65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();

    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // 1. Send OPEN with capabilities
        const openMsg = buildOpenMessageWithCaps(localAS, holdTime, routerId);
        await writer.write(openMsg);

        // 2. Wait for peer OPEN (read with buffering for split packets)
        let peerOpen: ReturnType<typeof parseBGPMessage> = null;
        let buffer = new Uint8Array(0);
        const sessionDeadline = Date.now() + 10000;

        while (!peerOpen && Date.now() < sessionDeadline) {
          const timer = new Promise<{ value: undefined; done: true }>(res =>
            setTimeout(() => res({ value: undefined, done: true }),
              Math.max(sessionDeadline - Date.now(), 0)));
          const { value, done } = await Promise.race([reader.read(), timer]);
          if (done || !value) break;

          const nb = new Uint8Array(buffer.length + value.length);
          nb.set(buffer); nb.set(value, buffer.length);
          buffer = nb;

          let off = 0;
          while (off + 19 <= buffer.length) {
            if (off + 16 > buffer.length) break;
            const msgLen = new DataView(buffer.buffer, buffer.byteOffset + off + 16).getUint16(0, false);
            if (off + msgLen > buffer.length) break;
            const parsed = parseBGPMessage(buffer.slice(off, off + msgLen));
            off += msgLen;
            if (!parsed) continue;
            if (parsed.type === MSG_OPEN) { peerOpen = parsed; break; }
            if (parsed.type === MSG_NOTIFICATION) {
              reader.releaseLock(); writer.releaseLock(); socket.close();
              return {
                success: false,
                latencyMs: Date.now() - startTime,
                error: `Peer sent NOTIFICATION: ${parsed.errorName} — ${parsed.errorDetail}`,
              };
            }
          }
          buffer = buffer.slice(off);
        }

        if (!peerOpen) {
          reader.releaseLock(); writer.releaseLock(); socket.close();
          return { success: false, latencyMs: Date.now() - startTime, error: 'No BGP OPEN received from peer' };
        }

        // 3. Send KEEPALIVE to confirm session
        await writer.write(buildKeepaliveMessage());

        // Detect if both sides negotiated 4-octet AS capability (RFC 6793).
        // True negotiation requires both peers to have advertised capability 65.
        // peerFourByteAS: peer advertised cap 65 in their OPEN.
        // localFourByteAS: we included cap 65 in our OPEN (buildOpenMessageWithCaps always does).
        // agreedFourByteAS: mutual agreement — both sides advertised cap 65.
        const peerFourByteAS = peerOpen.fourByteAS === true;
        const localFourByteAS = true; // buildOpenMessageWithCaps always includes capability 65
        const agreedFourByteAS = peerFourByteAS && localFourByteAS;

        // 4. Collect UPDATE messages
        const routes: BGPRoute[] = [];
        const withdrawnRoutes: BGPRoute[] = [];
        let keepaliveCount = 0;
        let updateCount = 0;
        const collectDeadline = Date.now() + collectMs;
        let peerNotification: { errorCode?: number; errorSubCode?: number; errorMessage?: string } | null = null;

        outer: while (Date.now() < collectDeadline &&
               (routes.length + withdrawnRoutes.length) < maxRoutes) {
          const timeLeft = Math.max(collectDeadline - Date.now(), 0);
          const timer = new Promise<{ value: undefined; done: true }>(res =>
            setTimeout(() => res({ value: undefined, done: true }), timeLeft));
          const { value, done } = await Promise.race([reader.read(), timer]);
          if (done || !value) break;

          const nb = new Uint8Array(buffer.length + value.length);
          nb.set(buffer); nb.set(value, buffer.length);
          buffer = nb;

          let off = 0;
          while (off + 19 <= buffer.length) {
            const msgLen = new DataView(buffer.buffer, buffer.byteOffset + off + 16).getUint16(0, false);
            if (msgLen < 19 || off + msgLen > buffer.length) break;
            const msgData = buffer.slice(off, off + msgLen);
            const parsed = parseBGPMessage(msgData);
            off += msgLen;
            if (!parsed) continue;

            if (parsed.type === MSG_KEEPALIVE) {
              keepaliveCount++;
              await writer.write(buildKeepaliveMessage());
            } else if (parsed.type === MSG_UPDATE) {
              updateCount++;
              const update = parseUpdateMessage(msgData, agreedFourByteAS);
              for (const r of update.reachable) {
                if (routes.length < maxRoutes) routes.push(r);
              }
              for (const w of update.withdrawn) {
                if (withdrawnRoutes.length < maxRoutes) withdrawnRoutes.push(w);
              }
            } else if (parsed.type === MSG_NOTIFICATION) {
              peerNotification = {
                errorCode: parsed.errorCode,
                errorSubCode: parsed.errorSubcode,
                errorMessage: parsed.errorName ?? 'BGP NOTIFICATION received',
              };
              break outer;
            }
          }
          buffer = buffer.slice(off);
        }

        reader.releaseLock(); writer.releaseLock(); socket.close();

        return {
          success: peerNotification === null,
          latencyMs: Date.now() - startTime,
          peerOpen: {
            peerAS:       peerOpen.peerAS,
            holdTime:     peerOpen.holdTime,
            routerId:     peerOpen.routerId,
            capabilities: peerOpen.capabilities ?? [],
          },
          session: { keepaliveCount, updateCount, collectDurationMs: collectMs },
          routes,
          withdrawnRoutes,
          routeCount:     routes.length,
          withdrawnCount: withdrawnRoutes.length,
          notification: peerNotification ?? undefined,
        };
      } catch (err) {
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { writer.releaseLock(); } catch { /* ignore */ }
        socket.close(); throw err;
      }
    })();

    const result = await Promise.race([
      work,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
    ]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      host, port,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle BGP connection test
 */
export async function handleBGPConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      localAS?: number;
      routerId?: string;
      holdTime?: number;
      timeout?: number;
    };

    const {
      host,
      port = 179,
      localAS = 65000,
      routerId = '10.0.0.1',
      holdTime = 90,
      timeout = 10000,
    } = body;

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

    if (localAS < 1 || localAS > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'AS number must be between 1 and 65535',
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

    // Send BGP OPEN message
    const openMsg = buildOpenMessage(localAS, holdTime, routerId);
    await writer.write(openMsg);

    // Read response (OPEN or NOTIFICATION)
    let peerOpen: ReturnType<typeof parseBGPMessage> = null;
    let notification: ReturnType<typeof parseBGPMessage> = null;
    let keepaliveReceived = false;

    try {
      // Read first response
      const readResult = await Promise.race([reader.read(), timeoutPromise]);
      if (readResult.value && readResult.value.length >= 19) {
        const parsed = parseBGPMessage(readResult.value);
        if (parsed) {
          if (parsed.type === MSG_OPEN) {
            peerOpen = parsed;

            // Send KEEPALIVE to confirm
            await writer.write(buildKeepaliveMessage());

            // Try to read KEEPALIVE confirmation
            try {
              const readTimeout = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Keepalive timeout')), 3000);
              });
              const kaResult = await Promise.race([reader.read(), readTimeout]);
              if (kaResult.value && kaResult.value.length >= 19) {
                const kaParsed = parseBGPMessage(kaResult.value);
                if (kaParsed && kaParsed.type === MSG_KEEPALIVE) {
                  keepaliveReceived = true;
                } else if (kaParsed && kaParsed.type === MSG_NOTIFICATION) {
                  notification = kaParsed;
                }
              }
            } catch {
              // Keepalive timeout is OK — we still got the OPEN
            }
          } else if (parsed.type === MSG_NOTIFICATION) {
            notification = parsed;
          } else if (parsed.type === MSG_KEEPALIVE) {
            keepaliveReceived = true;
          }
        }
      }
    } catch {
      // Read timeout
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    if (peerOpen) {
      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        connectTime,
        peerOpen: {
          version: peerOpen.version,
          peerAS: peerOpen.peerAS,
          holdTime: peerOpen.holdTime,
          routerId: peerOpen.routerId,
          capabilities: peerOpen.capabilities || [],
        },
        sessionEstablished: keepaliveReceived,
        notification: notification ? {
          errorCode: notification.errorCode,
          errorSubcode: notification.errorSubcode,
          errorName: notification.errorName,
          errorDetail: notification.errorDetail,
        } : undefined,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (notification) {
      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        connectTime,
        peerOpen: null,
        sessionEstablished: false,
        notification: {
          errorCode: notification.errorCode,
          errorSubcode: notification.errorSubcode,
          errorName: notification.errorName,
          errorDetail: notification.errorDetail,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Connected but no BGP response
    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      peerOpen: null,
      sessionEstablished: false,
      notification: null,
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
 * Handle BGP OPEN announce — sends a BGP OPEN message and parses the peer's response.
 *
 * Connects to the target BGP speaker on the given port, transmits a BGP OPEN
 * using the specified AS number and hold time with BGP Identifier 10.0.0.1
 * (0x0A000001, the RFC 4271 test default), then reads and decodes the response.
 *
 * The peer may respond with:
 *   - OPEN (type 1): session negotiation accepted; returns peerAS, holdTime, bgpId
 *   - NOTIFICATION (type 3): peer rejected the session; returns errorCode + errorSubCode
 *   - KEEPALIVE (type 4): peer acknowledged without full negotiation
 *
 * Request body:
 *   host      — BGP speaker hostname or IP (required)
 *   port      — TCP port (default: 179)
 *   localAS   — Our AS number to announce (default: 64512)
 *   holdTime  — Proposed hold time in seconds (default: 180)
 *   timeout   — Connection + read timeout in ms (default: 10000)
 *
 * Response fields:
 *   success      — true if a valid BGP message was received and parsed
 *   type         — 'OPEN' | 'NOTIFICATION' | 'KEEPALIVE' | 'UNKNOWN(n)' | 'NONE'
 *   peerAS       — (OPEN) peer's announced AS number
 *   holdTime     — (OPEN) negotiated hold time in seconds
 *   bgpId        — (OPEN) peer's BGP Identifier as dotted-decimal IPv4
 *   capabilities — (OPEN) list of capability names announced by the peer
 *   errorCode    — (NOTIFICATION) BGP error code
 *   errorSubCode — (NOTIFICATION) BGP error subcode
 *   errorName    — (NOTIFICATION) human-readable error name
 *   errorDetail  — (NOTIFICATION) human-readable subcode detail
 *   raw          — space-separated hex dump of the received (or sent) packet
 *   latencyMs    — elapsed milliseconds from TCP connect to first response byte
 */
export async function handleBGPAnnounce(request: Request): Promise<Response> {
  let host = '';
  let port = 179;

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      localAS?: number;
      holdTime?: number;
      timeout?: number;
    };

    host = body.host ?? '';
    port = body.port ?? 179;
    const localAS = body.localAS ?? 64512;
    const holdTime = body.holdTime ?? 180;
    const timeout = body.timeout ?? 10000;

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

    if (localAS < 1 || localAS > 4294967295) {
      return new Response(JSON.stringify({
        success: false,
        error: 'AS number must be between 1 and 4294967295',
      }), {
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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Use the low 16 bits of localAS in the My AS field.
    // 4-byte ASNs (> 65535) require Capability Code 65 (RFC 6793) which we
    // intentionally omit here to keep the announce minimal and broadly compatible.
    const openMsg = buildOpenMessage(localAS & 0xFFFF, holdTime, '10.0.0.1');
    await writer.write(openMsg);

    // Read the peer's response
    let responseBytes: Uint8Array | null = null;
    let parsed: ReturnType<typeof parseBGPMessage> = null;

    try {
      const result = await Promise.race([reader.read(), timeoutPromise]);
      if (!result.done && result.value && result.value.length >= 19) {
        responseBytes = result.value;
        parsed = parseBGPMessage(new Uint8Array(result.value));
      }
    } catch {
      // Connection timeout or stream ended before response
    }

    const latencyMs = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    // Return the received packet as hex, or fall back to what we sent
    const raw = responseBytes ? toHexString(responseBytes) : toHexString(openMsg);

    if (!parsed) {
      return new Response(JSON.stringify({
        success: false,
        type: 'NONE',
        raw,
        latencyMs,
        error: responseBytes
          ? 'Response received but not a valid BGP message (marker bytes invalid)'
          : 'No response received from peer within timeout',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const typeNames: Record<number, string> = {
      [MSG_OPEN]: 'OPEN',
      [MSG_UPDATE]: 'UPDATE',
      [MSG_NOTIFICATION]: 'NOTIFICATION',
      [MSG_KEEPALIVE]: 'KEEPALIVE',
    };
    const typeName = typeNames[parsed.type] ?? `UNKNOWN(${parsed.type})`;

    if (parsed.type === MSG_OPEN) {
      return new Response(JSON.stringify({
        success: true,
        type: typeName,
        peerAS: parsed.peerAS,
        holdTime: parsed.holdTime,
        bgpId: parsed.routerId ?? '0.0.0.0',
        capabilities: parsed.capabilities ?? [],
        raw,
        latencyMs,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (parsed.type === MSG_NOTIFICATION) {
      return new Response(JSON.stringify({
        success: false,
        type: typeName,
        errorCode: parsed.errorCode,
        errorSubCode: parsed.errorSubcode,
        errorName: parsed.errorName,
        errorDetail: parsed.errorDetail,
        raw,
        latencyMs,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // KEEPALIVE or other type
    return new Response(JSON.stringify({
      success: true,
      type: typeName,
      raw,
      latencyMs,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      host,
      port,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
