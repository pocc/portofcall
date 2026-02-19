/**
 * Battle.net BNCS (Battle.net Chat Server) Protocol Implementation
 *
 * Battle.net is the online gaming service developed by Blizzard Entertainment.
 * The BNCS protocol is used by classic Blizzard games including:
 * - Diablo (1996)
 * - StarCraft (1998)
 * - Warcraft II: Battle.net Edition (1999)
 * - Diablo II (2000)
 * - Warcraft III (2002)
 *
 * Default Port: 6112 / TCP / binary little-endian
 * Message format: [0xFF][msgId 1B][length uint16 LE][payload]
 *
 * Connection flow:
 *   1. Send protocol selector byte (0x01 = Game)
 *   2. Send SID_AUTH_INFO (0x50) with platform/product info
 *   3. Handle optional SID_PING (0x25) challenge from server
 *   4. Parse SID_AUTH_INFO server response (logon type, server token, MPQ info)
 *
 * SID_AUTH_INFO Response Fields:
 *   Logon Type  DWORD  0=Broken SHA-1, 1=NLS v1, 2=NLS v2
 *   Server Token DWORD random value used in CD key hashing
 *   UDP Value   DWORD
 *   MPQ Filetime FILETIME (8 bytes) - Windows FILETIME for version check file
 *   MPQ Filename SZSTRING - version check archive name
 *   Server Info  SZSTRING - formula for version check
 *
 * Battle.net Gateways:
 *   useast.battle.net:6112 / uswest.battle.net:6112
 *   asia.battle.net:6112   / europe.battle.net:6112
 *
 * References:
 *   BNETDocs: https://bnetdocs.org/
 *   SID_AUTH_INFO: https://bnetdocs.org/packet/164/sid-auth-info
 *   SID_PING: https://bnetdocs.org/packet/268/sid-ping
 */

import { connect } from 'cloudflare:sockets';

interface BattlenetRequest {
  host: string;
  port?: number;
  timeout?: number;
  protocolId?: number;
  productId?: string;
}

interface BattlenetAuthInfoResponse {
  success: boolean;
  host: string;
  port: number;
  isBattlenet?: boolean;
  productId?: string;
  productLabel?: string;
  logonType?: number;
  logonTypeLabel?: string;
  serverToken?: string;
  udpValue?: number;
  mpqFiletime?: string;
  mpqFilename?: string;
  serverInfo?: string;
  pingCookie?: number;
  error?: string;
  rawData?: string;
}

interface RealmStatus {
  name: string;
  host: string;
  port: number;
  reachable: boolean;
  rtt?: number;
  isBattlenet?: boolean;
  error?: string;
}

interface BattlenetStatusResponse {
  success: boolean;
  realms: RealmStatus[];
  reachableCount: number;
  totalCount: number;
}

// BNCS Protocol Constants
const BNCS_HEADER_BYTE = 0xFF;
const PROTOCOL_GAME = 0x01;
const SID_NULL = 0x00;
const SID_PING = 0x25;
const SID_AUTH_INFO = 0x50;

const PRODUCTS: Record<string, string> = {
  DRTL: 'Diablo',
  DSHR: 'Diablo (Shareware)',
  STAR: 'StarCraft',
  SEXP: 'StarCraft: Brood War',
  SSHR: 'StarCraft (Shareware)',
  W2BN: 'Warcraft II: Battle.net Edition',
  D2DV: 'Diablo II',
  D2XP: 'Diablo II: Lord of Destruction',
  WAR3: 'Warcraft III: Reign of Chaos',
  W3XP: 'Warcraft III: The Frozen Throne',
  W3DM: 'Warcraft III (Demo)',
};

const BATTLENET_REALMS = [
  { name: 'US East', host: 'useast.battle.net', port: 6112 },
  { name: 'US West', host: 'uswest.battle.net', port: 6112 },
  { name: 'Asia',    host: 'asia.battle.net',   port: 6112 },
  { name: 'Europe',  host: 'europe.battle.net', port: 6112 },
];

/** Encode 4-char ASCII string as little-endian DWORD bytes */
function encodeFourCC(str: string): Uint8Array {
  const s = str.padEnd(4, '\0').substring(0, 4);
  return new Uint8Array([s.charCodeAt(3), s.charCodeAt(2), s.charCodeAt(1), s.charCodeAt(0)]);
}

/** Build BNCS framed message: [0xFF][msgId][length LE uint16][payload] */
function buildBNCSMessage(messageId: number, data?: Uint8Array): Uint8Array {
  const dataLen = data ? data.length : 0;
  const total = 4 + dataLen;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  buf[0] = BNCS_HEADER_BYTE;
  buf[1] = messageId;
  view.setUint16(2, total, true);
  if (data) buf.set(data, 4);
  return buf;
}

/**
 * Build SID_AUTH_INFO (0x50) request payload.
 * Fields (all LE):
 *   Protocol ID, Platform ID (IX86), Product ID, Version Byte,
 *   Product Language (USen), Local IP, Timezone Bias, Locale ID,
 *   Language ID, Country Abbrev (SZSTRING), Country (SZSTRING)
 */
function buildAuthInfoPayload(productId: string): Uint8Array {
  const enc = new TextEncoder();
  const cAbbrev = enc.encode('USA\0');
  const cName   = enc.encode('United States\0');
  const buf  = new Uint8Array(36 + cAbbrev.length + cName.length);
  const view = new DataView(buf.buffer);
  let off = 0;

  view.setUint32(off, 0, true);              off += 4; // Protocol ID (classic)
  buf.set(encodeFourCC('IX86'), off);         off += 4; // Platform
  buf.set(encodeFourCC(productId), off);      off += 4; // Product
  view.setUint32(off, 0xC7, true);           off += 4; // Version byte (199)
  buf.set(encodeFourCC('USen'), off);         off += 4; // Product language
  view.setUint32(off, 0, true);              off += 4; // Local IP (hidden)
  view.setUint32(off, 480, true);            off += 4; // Timezone bias (UTC-8)
  view.setUint32(off, 0x0409, true);         off += 4; // Locale ID en-US
  view.setUint32(off, 0x0409, true);         off += 4; // Language ID en-US
  buf.set(cAbbrev, off);                      off += cAbbrev.length;
  buf.set(cName, off);
  return buf;
}

/** Build SID_PING (0x25) response echoing the server cookie */
function buildPingResponse(cookie: number): Uint8Array {
  const data = new Uint8Array(4);
  new DataView(data.buffer).setUint32(0, cookie, true);
  return buildBNCSMessage(SID_PING, data);
}

function mergeChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Read from a BNCS stream until a single complete packet is buffered or timeout fires.
 * Returns exactly one packet's worth of bytes plus any leftover bytes that belong
 * to the next packet (which can happen when multiple packets arrive in a single
 * TCP segment). The caller must feed `leftover` back into subsequent reads.
 */
async function readBNCSPacket(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  prefill?: Uint8Array,
): Promise<{ data: Uint8Array; leftover: Uint8Array }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;

  // Seed with leftover bytes from a previous read
  if (prefill && prefill.length > 0) {
    chunks.push(prefill);
    total = prefill.length;
  }

  // Check if prefill already contains a complete packet
  if (total >= 4) {
    const combined = mergeChunks(chunks, total);
    if (combined[0] === BNCS_HEADER_BYTE) {
      const declaredLen = new DataView(combined.buffer, combined.byteOffset).getUint16(2, true);
      if (declaredLen >= 4 && total >= declaredLen) {
        return {
          data: combined.slice(0, declaredLen),
          leftover: combined.slice(declaredLen),
        };
      }
    } else {
      // Non-BNCS data — return everything
      return { data: combined, leftover: new Uint8Array(0) };
    }
  }

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Read timeout')), remaining)
        ),
      ]) as ReadableStreamReadResult<Uint8Array>;
    } catch {
      break;
    }

    if (result.done || !result.value) break;
    chunks.push(result.value);
    total += result.value.length;

    if (total >= 4) {
      const combined = mergeChunks(chunks, total);
      if (combined[0] === BNCS_HEADER_BYTE) {
        const declaredLen = new DataView(combined.buffer, combined.byteOffset).getUint16(2, true);
        if (declaredLen >= 4 && total >= declaredLen) {
          return {
            data: combined.slice(0, declaredLen),
            leftover: combined.slice(declaredLen),
          };
        }
      } else {
        return { data: combined, leftover: new Uint8Array(0) };
      }
    }
  }
  return { data: mergeChunks(chunks, total), leftover: new Uint8Array(0) };
}

function parseBNCSPacket(data: Uint8Array): {
  valid: boolean;
  messageId: number;
  length: number;
  payload: Uint8Array;
} {
  if (data.length < 4 || data[0] !== BNCS_HEADER_BYTE) {
    return { valid: false, messageId: 0, length: 0, payload: new Uint8Array(0) };
  }
  const length = new DataView(data.buffer, data.byteOffset).getUint16(2, true);
  return {
    valid: true,
    messageId: data[1],
    length,
    payload: data.slice(4, Math.min(length, data.length)),
  };
}

function parseAuthInfoResponse(payload: Uint8Array): {
  logonType: number;
  logonTypeLabel: string;
  serverToken: string;
  udpValue: number;
  mpqFiletime: string;
  mpqFilename: string;
  serverInfo: string;
} {
  const view = new DataView(payload.buffer, payload.byteOffset);
  const dec  = new TextDecoder();
  let off = 0;

  const logonType   = view.getUint32(off, true); off += 4;
  const serverToken = view.getUint32(off, true); off += 4;
  const udpValue    = view.getUint32(off, true); off += 4;
  const ftLow       = view.getUint32(off, true); off += 4;
  const ftHigh      = view.getUint32(off, true); off += 4;
  const mpqFiletime = `0x${ftHigh.toString(16).padStart(8, '0')}${ftLow.toString(16).padStart(8, '0')}`;

  const n1 = payload.indexOf(0, off);
  const e1 = n1 === -1 ? payload.length : n1;
  const mpqFilename = dec.decode(payload.slice(off, e1));
  off = e1 + 1;

  const n2 = payload.indexOf(0, off);
  const e2 = n2 === -1 ? payload.length : n2;
  const serverInfo = dec.decode(payload.slice(off, e2));

  const logonLabels: Record<number, string> = {
    0: 'Broken SHA-1 (legacy)',
    1: 'NLS v1',
    2: 'NLS v2',
  };

  return {
    logonType,
    logonTypeLabel: logonLabels[logonType] ?? `Unknown (${logonType})`,
    serverToken: `0x${serverToken.toString(16).padStart(8, '0')}`,
    udpValue,
    mpqFiletime,
    mpqFilename,
    serverInfo,
  };
}

// ---------------------------------------------------------------------------
// Exported handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/battlenet/connect
 * Basic BNCS probe: sends protocol selector + SID_NULL and reports server response.
 */
export async function handleBattlenetConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as BattlenetRequest;
    const { host, port = 6112, timeout = 15000, protocolId = PROTOCOL_GAME } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required parameter: host' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      await Promise.race([socket.opened, deadline]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        await writer.write(new Uint8Array([protocolId]));
        await writer.write(buildBNCSMessage(SID_NULL));

        const { data } = await Promise.race([readBNCSPacket(reader, 5000), deadline]) as { data: Uint8Array; leftover: Uint8Array };
        const packet = parseBNCSPacket(data);

        if (!packet.valid) {
          return new Response(JSON.stringify({
            success: false, host, port, protocolId, error: 'No valid BNCS response',
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          protocolId,
          serverResponse: true,
          messageId: packet.messageId,
          messageLength: packet.length,
          rawData: packet.payload.length > 0
            ? Array.from(packet.payload).map(b => b.toString(16).padStart(2, '0')).join(' ')
            : undefined,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });

      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }
    } finally {
      try { await socket.close(); } catch { /* ignore */ }
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Request processing failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * POST /api/battlenet/authinfo
 *
 * Sends SID_AUTH_INFO (0x50) and parses the server's challenge response.
 * Handles any SID_PING (0x25) challenge the server sends before auth info.
 *
 * Body: { host, port?, timeout?, productId? }
 *   productId: "STAR" | "SEXP" | "D2DV" | "D2XP" | "W3XP" (default "STAR")
 *
 * Response includes: logonType, serverToken, mpqFilename, serverInfo
 */
export async function handleBattlenetAuthInfo(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: BattlenetRequest;
  try {
    body = await request.json() as BattlenetRequest;
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 6112, timeout = 15000, productId = 'STAR' } = body;

  if (!host) {
    return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (port < 1 || port > 65535) {
    return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const prod = (productId.toUpperCase() || 'STAR').substring(0, 4).padEnd(4, ' ').trimEnd() || 'STAR';
  const result: BattlenetAuthInfoResponse = {
    success: false,
    host,
    port,
    productId: prod,
    productLabel: PRODUCTS[prod],
  };

  const socket = connect(`${host}:${port}`);
  const globalDeadline = Date.now() + timeout;

  try {
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      ),
    ]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Send protocol selector and SID_AUTH_INFO
      await writer.write(new Uint8Array([PROTOCOL_GAME]));
      await writer.write(buildBNCSMessage(SID_AUTH_INFO, buildAuthInfoPayload(prod)));

      // Read up to 4 packets; server often sends SID_PING before SID_AUTH_INFO.
      // Carry leftover bytes between reads (multiple packets can arrive in one TCP segment).
      let leftover: Uint8Array<ArrayBufferLike> | undefined;
      for (let i = 0; i < 4; i++) {
        const remaining = globalDeadline - Date.now();
        if (remaining <= 0) break;

        const read = await readBNCSPacket(reader, Math.min(remaining, 5000), leftover);
        leftover = read.leftover;
        const data = read.data;
        if (data.length < 4) break;

        const packet = parseBNCSPacket(data);
        if (!packet.valid) break;

        if (packet.messageId === SID_PING && packet.payload.length >= 4) {
          const cookie = new DataView(packet.payload.buffer, packet.payload.byteOffset).getUint32(0, true);
          result.pingCookie = cookie;
          await writer.write(buildPingResponse(cookie));

        } else if (packet.messageId === SID_AUTH_INFO) {
          result.isBattlenet = true;
          if (packet.payload.length >= 20) {
            const parsed = parseAuthInfoResponse(packet.payload);
            result.logonType      = parsed.logonType;
            result.logonTypeLabel = parsed.logonTypeLabel;
            result.serverToken    = parsed.serverToken;
            result.udpValue       = parsed.udpValue;
            result.mpqFiletime    = parsed.mpqFiletime;
            result.mpqFilename    = parsed.mpqFilename;
            result.serverInfo     = parsed.serverInfo;
          } else {
            result.rawData = Array.from(packet.payload)
              .map(b => b.toString(16).padStart(2, '0')).join(' ');
          }
          result.success = true;
          break;

        } else if (packet.messageId === SID_NULL) {
          continue; // keepalive

        } else {
          // Unexpected message ID — record raw bytes and stop
          result.rawData = Array.from(data.slice(0, 64))
            .map(b => b.toString(16).padStart(2, '0')).join(' ');
          break;
        }
      }

      if (!result.success && !result.error) {
        result.error = 'No SID_AUTH_INFO response received from server';
      }

    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }

  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Connection failed';
  } finally {
    try { await socket.close(); } catch { /* ignore */ }
  }

  return new Response(JSON.stringify(result), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/battlenet/status
 *
 * Checks all four Battle.net gateway realms in parallel.
 * Connects to each and sends SID_NULL to confirm BNCS reachability.
 *
 * Body: { timeout? }  — per-realm timeout in ms (default 8000)
 */
export async function handleBattlenetStatus(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let realmTimeout = 8000;
  try {
    const body = await request.json() as { timeout?: number };
    if (typeof body.timeout === 'number' && body.timeout > 0) {
      realmTimeout = Math.min(body.timeout, 30000);
    }
  } catch { /* use default */ }

  const checkRealm = async (realm: typeof BATTLENET_REALMS[0]): Promise<RealmStatus> => {
    const start = Date.now();
    const status: RealmStatus = {
      name: realm.name, host: realm.host, port: realm.port, reachable: false,
    };

    const socket = connect(`${realm.host}:${realm.port}`);
    try {
      await Promise.race([
        socket.opened,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), realmTimeout)
        ),
      ]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        await writer.write(new Uint8Array([PROTOCOL_GAME]));
        await writer.write(buildBNCSMessage(SID_NULL));

        const readMs = Math.min(realmTimeout, 5000);
        const { data } = await Promise.race([
          readBNCSPacket(reader, readMs),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Read timeout')), readMs)
          ),
        ]) as { data: Uint8Array; leftover: Uint8Array };

        status.rtt = Date.now() - start;

        if (data.length >= 4 && data[0] === BNCS_HEADER_BYTE) {
          status.reachable = true;
          status.isBattlenet = true;
        } else if (data.length > 0) {
          status.reachable = true;
          status.isBattlenet = false;
        }
      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }
    } catch (err) {
      status.rtt = Date.now() - start;
      status.error = err instanceof Error ? err.message : 'Connection failed';
    } finally {
      try { await socket.close(); } catch { /* ignore */ }
    }

    return status;
  };

  const realms = await Promise.all(BATTLENET_REALMS.map(checkRealm));
  const response: BattlenetStatusResponse = {
    success: true,
    realms,
    reachableCount: realms.filter(r => r.reachable).length,
    totalCount: realms.length,
  };
  return new Response(JSON.stringify(response), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
