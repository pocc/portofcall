/**
 * YMSG Protocol Implementation (Yahoo Messenger)
 *
 * Yahoo Messenger Protocol (YMSG) was the protocol used by Yahoo! Messenger
 * for instant messaging. The service was shut down in 2018, but the protocol
 * remains of historical interest for IM protocol research.
 *
 * Protocol Overview:
 * - Ports: 5050 (primary), 5101 (alternate)
 * - Format: Binary protocol with 20-byte header + key-value pairs
 * - Versions: YMSG9 through YMSG16 (16 was final)
 * - Authentication: Yahoo! ID password or OAuth
 *
 * Packet Structure:
 * - Header (20 bytes):
 *   - Magic: "YMSG" (4 bytes)
 *   - Version: Protocol version (2 bytes)
 *   - Vendor ID: Usually 0 (2 bytes)
 *   - Length: Payload length (2 bytes)
 *   - Service: Command code (2 bytes)
 *   - Status: Status code (4 bytes)
 *   - Session ID: Unique session (4 bytes)
 *
 * - Payload: Key-value pairs separated by 0xC080
 *   - Format: key<0xC080>value<0xC080>key<0xC080>value...
 *
 * Service Codes:
 * - 0x01: Login
 * - 0x02: Logout
 * - 0x06: Message
 * - 0x12: Ping/Keepalive
 * - 0x4B: Auth request
 * - 0x54: Login v2
 * - 0x84: List
 *
 * Common Keys:
 * - 0: Username
 * - 1: Online status
 * - 5: Message sender
 * - 14: Message text
 * - 97: UTF-8 flag
 * - 244: Captcha
 *
 * Use Cases:
 * - Legacy Yahoo Messenger detection
 * - IM protocol archaeology
 * - Historical protocol research
 */

import { connect } from 'cloudflare:sockets';

/**
 * Pure-JS MD5 implementation (RFC 1321).
 * Used for YMSG v16 challenge-response authentication.
 * node:crypto is not available in Cloudflare Workers.
 */
function md5(input: Uint8Array): Uint8Array {
  function F(x: number, y: number, z: number) { return (x & y) | (~x & z); }
  function G(x: number, y: number, z: number) { return (x & z) | (y & ~z); }
  function H(x: number, y: number, z: number) { return x ^ y ^ z; }
  function I(x: number, y: number, z: number) { return y ^ (x | ~z); }
  function rotl(x: number, n: number) { return (x << n) | (x >>> (32 - n)); }
  function add32(a: number, b: number) { return (a + b) & 0xffffffff; }

  const msgLen = input.length;
  const bitLen = msgLen * 8;
  const padLen = ((56 - (msgLen + 1) % 64) + 64) % 64;
  const totalLen = msgLen + 1 + padLen + 8;
  const msg = new Uint8Array(totalLen);
  msg.set(input);
  msg[msgLen] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(totalLen - 8, bitLen & 0xffffffff, true);
  view.setUint32(totalLen - 4, Math.floor(bitLen / 0x100000000) & 0xffffffff, true);

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const T = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let blockStart = 0; blockStart < totalLen; blockStart += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) M[j] = view.getUint32(blockStart + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16)      { f = F(B, C, D); g = i; }
      else if (i < 32) { f = G(B, C, D); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = H(B, C, D); g = (3 * i + 5) % 16; }
      else             { f = I(B, C, D); g = (7 * i) % 16; }
      const temp = D; D = C; C = B;
      B = add32(B, rotl(add32(add32(A, f), add32(T[i], M[g])), s[i]));
      A = temp;
    }
    a0 = add32(a0, A); b0 = add32(b0, B); c0 = add32(c0, C); d0 = add32(d0, D);
  }

  const result = new Uint8Array(16);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, a0, true); rv.setUint32(4, b0, true);
  rv.setUint32(8, c0, true); rv.setUint32(12, d0, true);
  return result;
}

/**
 * Compute MD5 of a binary string and return as lowercase hex.
 */
function md5Hex(input: Uint8Array): string {
  const bytes = md5(input);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Concatenate multiple Uint8Arrays into a single Uint8Array.
 */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const arr of arrays) totalLen += arr.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

interface YMSGRequest {
  host: string;
  port?: number;
  timeout?: number;
  version?: number;
}

interface YMSGResponse {
  success: boolean;
  host: string;
  port: number;
  version?: number;
  service?: number;
  serviceName?: string;
  status?: number;
  sessionId?: number;
  payloadLength?: number;
  rtt?: number;
  error?: string;
}

// YMSG Service Codes
enum YMSGService {
  Login = 0x01,
  Logout = 0x02,
  IsAway = 0x03,
  IsBack = 0x04,
  Idle = 0x05,
  Message = 0x06,
  IdAct = 0x07,
  IdDeact = 0x08,
  MailStat = 0x09,
  UserStat = 0x0A,
  NewMail = 0x0B,
  ChatOnline = 0x0D,
  ChatGoto = 0x0E,
  ChatJoin = 0x0F,
  Ping = 0x12,
  GameLogon = 0x28,
  GameLogoff = 0x29,
  GameMsg = 0x2A,
  AuthReq = 0x4B,
  AuthResp = 0x54,
  List = 0x84,
  AddBuddy = 0x83,
  RemBuddy = 0x84,
}

/**
 * Build YMSG packet header
 */
function buildYMSGHeader(
  version: number,
  vendorId: number,
  payloadLength: number,
  service: number,
  status: number,
  sessionId: number
): Uint8Array {
  const header = new Uint8Array(20);
  const view = new DataView(header.buffer);

  // Magic "YMSG"
  header[0] = 0x59; // Y
  header[1] = 0x4D; // M
  header[2] = 0x53; // S
  header[3] = 0x47; // G

  // Version (big-endian uint16)
  view.setUint16(4, version, false);

  // Vendor ID (big-endian uint16)
  view.setUint16(6, vendorId, false);

  // Payload Length (big-endian uint16)
  view.setUint16(8, payloadLength, false);

  // Service Code (big-endian uint16)
  view.setUint16(10, service, false);

  // Status (big-endian uint32)
  view.setUint32(12, status, false);

  // Session ID (big-endian uint32)
  view.setUint32(16, sessionId, false);

  return header;
}

/**
 * Build YMSG ping packet
 */
function buildYMSGPing(version: number = 16): Uint8Array {
  // Ping has no payload, just header
  return buildYMSGHeader(
    version,    // Version
    0,          // Vendor ID
    0,          // Payload length
    YMSGService.Ping,  // Service code (ping)
    0,          // Status
    0           // Session ID
  );
}

/**
 * Parse YMSG packet header
 */
function parseYMSGHeader(data: Uint8Array): {
  magic: string;
  version: number;
  vendorId: number;
  payloadLength: number;
  service: number;
  status: number;
  sessionId: number;
} | null {
  if (data.length < 20) {
    return null;
  }

  // Check YMSG magic
  if (data[0] !== 0x59 || data[1] !== 0x4D || data[2] !== 0x53 || data[3] !== 0x47) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  return {
    magic: 'YMSG',
    version: view.getUint16(4, false),
    vendorId: view.getUint16(6, false),
    payloadLength: view.getUint16(8, false),
    service: view.getUint16(10, false),
    status: view.getUint32(12, false),
    sessionId: view.getUint32(16, false),
  };
}

/**
 * Probe Yahoo Messenger server by sending ping.
 * Detects YMSG server and version.
 */
export async function handleYMSGProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as YMSGRequest;
    const { host, port = 5050, timeout = 15000, version = 16 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies YMSGResponse), {
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
      } satisfies YMSGResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Build and send YMSG ping
      const ping = buildYMSGPing(version);

      const writer = socket.writable.getWriter();
      await writer.write(ping);
      writer.releaseLock();

      // Read response
      const reader = socket.readable.getReader();

      const { value, done } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (done || !value) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response from YMSG server',
        } satisfies YMSGResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parseYMSGHeader(value);

      if (!parsed) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid YMSG packet format',
        } satisfies YMSGResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      // Map service code to name
      const serviceNames: { [key: number]: string } = {
        [YMSGService.Login]: 'Login',
        [YMSGService.Logout]: 'Logout',
        [YMSGService.Message]: 'Message',
        [YMSGService.Ping]: 'Ping',
        [YMSGService.AuthReq]: 'Auth Request',
        [YMSGService.AuthResp]: 'Auth Response',
        [YMSGService.List]: 'List',
      };

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        version: parsed.version,
        service: parsed.service,
        serviceName: serviceNames[parsed.service] || `Unknown (0x${parsed.service.toString(16)})`,
        status: parsed.status,
        sessionId: parsed.sessionId,
        payloadLength: parsed.payloadLength,
        rtt,
      } satisfies YMSGResponse), {
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
      port: 5050,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies YMSGResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Detect Yahoo Messenger server version.
 * Tests multiple YMSG versions to find supported one.
 */
export async function handleYMSGVersionDetect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as YMSGRequest;
    const { host, port = 5050, timeout = 10000 } = body;

    // Try common versions: 16, 15, 13, 11, 10, 9
    const versions = [16, 15, 13, 11, 10, 9];

    for (const version of versions) {
      const probeRequest = new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify({ host, port, timeout, version }),
      });

      const response = await handleYMSGProbe(probeRequest);
      const data = await response.json() as YMSGResponse;

      if (data.success) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { success: _success, host: _host, port: _port, ...rest } = data;
        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          detectedVersion: version,
          ...rest,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      error: 'No supported YMSG version detected',
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

// YMSG key-value separator bytes (0xC0, 0x80)
const KV_SEP_BYTES = new Uint8Array([0xC0, 0x80]);

/**
 * Build a YMSG key-value payload.
 */
function buildYMSGKV(pairs: [number, string][]): Uint8Array {
  const encoder = new TextEncoder();
  const segments: Uint8Array[] = [];
  for (const [k, v] of pairs) {
    segments.push(encoder.encode(k.toString()));
    segments.push(KV_SEP_BYTES);
    segments.push(encoder.encode(v));
    segments.push(KV_SEP_BYTES);
  }
  return concatBytes(...segments);
}

/**
 * Parse YMSG key-value payload into a Map.
 */
function parseYMSGKV(payload: Uint8Array): Map<number, string> {
  const result = new Map<number, string>();
  // Split on 0xC0 0x80 separator
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < payload.length - 1; i++) {
    if (payload[i] === 0xC0 && payload[i + 1] === 0x80) {
      parts.push(new TextDecoder().decode(payload.subarray(start, i)));
      start = i + 2;
      i++; // skip second byte of separator
    }
  }
  if (start < payload.length) {
    parts.push(new TextDecoder().decode(payload.subarray(start)));
  }
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const key = parseInt(parts[i], 10);
    if (!isNaN(key)) result.set(key, parts[i + 1]);
  }
  return result;
}

/**
 * Send a YMSG AuthReq (service 0x4B) with username and read challenge response.
 *
 * POST /api/ymsg/auth
 * Body: { host, port?, username, version?, timeout? }
 */
export async function handleYMSGAuth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username?: string;
      version?: number;
      timeout?: number;
    };
    const { host, port = 5050, username = 'testuser', version = 16, timeout = 8000 } = body;

    if (!host) return Response.json({ success: false, error: 'Host is required' }, { status: 400 });

    const socket = connect(`${host}:${port}`, { secureTransport: 'off' as const, allowHalfOpen: false });
    const tp = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout));

    try {
      await Promise.race([socket.opened, tp]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Build AuthReq: service 0x4B, key 0 = Yahoo! ID, key 1 = "1"
      const payload = buildYMSGKV([[0, username], [1, '1']]);
      const header = buildYMSGHeader(version, 0, payload.length, YMSGService.AuthReq, 0, 0);
      await writer.write(concatBytes(header, payload));
      writer.releaseLock();

      // Read response
      const chunks: Uint8Array[] = [];
      let total = 0;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && total < 1024) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((_, rej) =>
            setTimeout(() => rej(new Error('timeout')), deadline - Date.now())),
        ]).catch(() => ({ value: undefined as undefined, done: true as const }));
        if (done || !value) break;
        chunks.push(value);
        total += value.length;
        if (total >= 20) break; // enough for header + some payload
      }
      reader.releaseLock();
      socket.close();

      const respBuf = concatBytes(...chunks);
      const respHdr = respBuf.length >= 20 ? parseYMSGHeader(respBuf) : null;
      let challenge: string | undefined;
      let authFields: Record<number, string> | undefined;

      if (respHdr) {
        const payloadEnd = Math.min(20 + respHdr.payloadLength, respBuf.length);
        const respPayload = respBuf.subarray(20, payloadEnd);
        const kvMap = parseYMSGKV(respPayload);
        if (kvMap.size > 0) {
          authFields = Object.fromEntries(kvMap) as Record<number, string>;
          // Key 94 or 96 is typically the challenge token
          challenge = kvMap.get(94) ?? kvMap.get(96);
        }
      }

      return Response.json({
        success: !!respHdr,
        host,
        port,
        username,
        ymsgVersion: respHdr?.version,
        responseService: respHdr?.service,
        sessionId: respHdr?.sessionId,
        challenge,
        authFields,
      });
    } catch (err) {
      socket.close();
      throw err;
    }
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/**
 * Complete YMSG v16 login with MD5 challenge-response authentication.
 *
 * Full auth flow:
 *   1. Send AuthReq (service 0x4B) with Yahoo ID -> get challenge seed (key 94)
 *   2. Compute: p = MD5(password) hexdigest
 *              y_hash = MD5(seed + p) hexdigest   (key 94 in response)
 *              c_hash = MD5(y_hash + seed) hexdigest (key 96 in response)
 *   3. Send AuthResp (service 0x54) with Y hash + C hash
 *   4. Read login result (service 0x01 = Login, or error)
 *
 * POST /api/ymsg/login
 * Body: { host, port?, username, password, version?, timeout? }
 */
export async function handleYMSGLogin(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username?: string;
      password?: string;
      version?: number;
      timeout?: number;
    };
    const { host, port = 5050, username = 'testuser', password = '', version = 16, timeout = 12000 } = body;

    if (!host) return Response.json({ success: false, error: 'Host is required' }, { status: 400 });

    const socket = connect(`${host}:${port}`, { secureTransport: 'off' as const, allowHalfOpen: false });
    const tp = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout));

    try {
      await Promise.race([socket.opened, tp]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: Send AuthReq (service 0x4B)
      const authReqPayload = buildYMSGKV([[0, username], [1, '1']]);
      const authReqHeader = buildYMSGHeader(version, 0, authReqPayload.length, YMSGService.AuthReq, 0, 0);
      await writer.write(concatBytes(authReqHeader, authReqPayload));

      // Read challenge response
      const chunks: Uint8Array[] = [];
      let totalRead = 0;
      const challengeDeadline = Date.now() + 5000;
      while (Date.now() < challengeDeadline && totalRead < 2048) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((_, rej) =>
            setTimeout(() => rej(new Error('timeout')), challengeDeadline - Date.now())),
        ]).catch(() => ({ value: undefined as undefined, done: true as const }));
        if (done || !value) break;
        chunks.push(value);
        totalRead += value.length;
        if (totalRead >= 20) break;
      }

      const challengeBuf = concatBytes(...chunks);
      const challengeHdr = challengeBuf.length >= 20 ? parseYMSGHeader(challengeBuf) : null;
      if (!challengeHdr) throw new Error('No valid YMSG auth challenge received');

      const challengePayloadEnd = Math.min(20 + challengeHdr.payloadLength, challengeBuf.length);
      const challengePayload = challengeBuf.subarray(20, challengePayloadEnd);
      const challengeKV = parseYMSGKV(challengePayload);

      // Extract challenge seed (key 94, fallback key 96)
      const seed = challengeKV.get(94) ?? challengeKV.get(96);
      if (!seed) throw new Error('No challenge seed in auth response (key 94/96 missing)');

      const sessionId = challengeHdr.sessionId;

      // Step 2: Compute MD5 auth hashes (YMSG v16 algorithm)
      const enc = new TextEncoder();
      const p = md5Hex(enc.encode(password));
      const yHash = md5Hex(enc.encode(seed + p));
      const cHash = md5Hex(enc.encode(yHash + seed));

      // Step 3: Send AuthResp (service 0x54)
      const authRespPayload = buildYMSGKV([
        [0, username],          // Yahoo ID
        [6, username],          // client context
        [94, yHash],            // Y response hash
        [96, cHash],            // C response hash
        [1, '0'],               // status (idle)
        [135, version.toString()], // client version
      ]);
      const authRespHeader = buildYMSGHeader(version, 0, authRespPayload.length, YMSGService.AuthResp, 0, sessionId);
      await writer.write(concatBytes(authRespHeader, authRespPayload));

      // Step 4: Read login result
      const resultChunks: Uint8Array[] = [];
      let resultTotal = 0;
      const resultDeadline = Date.now() + 6000;
      while (Date.now() < resultDeadline && resultTotal < 4096) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((_, rej) =>
            setTimeout(() => rej(new Error('timeout')), resultDeadline - Date.now())),
        ]).catch(() => ({ value: undefined as undefined, done: true as const }));
        if (done || !value) break;
        resultChunks.push(value);
        resultTotal += value.length;
        if (resultTotal >= 20) break;
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const resultBuf = concatBytes(...resultChunks);
      const resultHdr = resultBuf.length >= 20 ? parseYMSGHeader(resultBuf) : null;
      let loginSuccess = false;
      let errorCode: number | undefined;
      let loginFields: Record<number, string> | undefined;

      if (resultHdr) {
        // service 0x01 = Login success, status 0 = OK
        loginSuccess = resultHdr.service === 0x01 && resultHdr.status === 0;
        errorCode = resultHdr.status !== 0 ? resultHdr.status : undefined;
        const resultPayloadEnd = Math.min(20 + resultHdr.payloadLength, resultBuf.length);
        const resultPayload = resultBuf.subarray(20, resultPayloadEnd);
        const resultKV = parseYMSGKV(resultPayload);
        if (resultKV.size > 0) {
          loginFields = Object.fromEntries(resultKV) as Record<number, string>;
        }
      }

      return Response.json({
        success: loginSuccess,
        host,
        port,
        username,
        challengeSeed: seed,
        sessionId,
        yHash,
        cHash,
        loginService: resultHdr?.service,
        loginStatus: resultHdr?.status,
        errorCode,
        loginFields,
        note: !resultHdr
          ? 'No login result received — server may be offline or use a different auth version'
          : undefined,
      });
    } catch (err) {
      socket.close();
      throw err;
    }
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
