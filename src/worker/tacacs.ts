/**
 * TACACS+ Protocol Implementation (RFC 8907)
 * Terminal Access Controller Access-Control System Plus
 * Port: 49 (TCP)
 *
 * TACACS+ provides AAA (Authentication, Authorization, Accounting)
 * for network device administration. Used primarily by Cisco devices.
 *
 * Supports both unencrypted probe mode and encrypted mode with shared secret.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// TACACS+ version
const TAC_PLUS_MAJOR = 0x0c;
const TAC_PLUS_MINOR_DEFAULT = 0x00;

// Packet types
const TAC_PLUS_AUTHEN = 0x01;
const TAC_PLUS_AUTHOR = 0x02;
const TAC_PLUS_ACCT = 0x03;

// Flags
const TAC_PLUS_UNENCRYPTED_FLAG = 0x01;
const TAC_PLUS_SINGLE_CONNECT_FLAG = 0x04;

// Protocol limits
const MAX_BODY_LENGTH = 65535; // Maximum body size per RFC 8907

// Authentication actions
const TAC_PLUS_AUTHEN_LOGIN = 0x01;

// Authentication types
const TAC_PLUS_AUTHEN_TYPE_ASCII = 0x01;

// Authentication services
const TAC_PLUS_AUTHEN_SVC_LOGIN = 0x01;

// Authentication status codes
const AUTHEN_STATUS: Record<number, string> = {
  0x01: 'PASS',
  0x02: 'FAIL',
  0x03: 'GETDATA',
  0x04: 'GETUSER',
  0x05: 'GETPASS',
  0x06: 'RESTART',
  0x07: 'ERROR',
  0x21: 'FOLLOW',
};

// Packet type names
const PACKET_TYPE_NAMES: Record<number, string> = {
  [TAC_PLUS_AUTHEN]: 'Authentication',
  [TAC_PLUS_AUTHOR]: 'Authorization',
  [TAC_PLUS_ACCT]: 'Accounting',
};

/**
 * Read exactly N bytes from a socket reader, buffering partial reads
 */
async function readExactBytes(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  n: number,
  existingBuffer?: Uint8Array
): Promise<{ data: Uint8Array; leftover: Uint8Array }> {
  const chunks: Uint8Array[] = [];
  let totalRead = 0;

  if (existingBuffer && existingBuffer.length > 0) {
    if (existingBuffer.length >= n) {
      return {
        data: existingBuffer.slice(0, n),
        leftover: existingBuffer.slice(n),
      };
    }
    chunks.push(existingBuffer);
    totalRead = existingBuffer.length;
  }

  while (totalRead < n) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed while reading');
    chunks.push(value);
    totalRead += value.length;
  }

  // Concatenate all chunks
  const combined = new Uint8Array(totalRead);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return {
    data: combined.slice(0, n),
    leftover: combined.slice(n),
  };
}

/**
 * Minimal MD5 implementation for TACACS+ body encryption.
 * TACACS+ uses MD5 to generate a pseudo-random pad for XOR encryption.
 */
function md5(input: Uint8Array): Uint8Array {
  // MD5 helper functions
  function F(x: number, y: number, z: number) { return (x & y) | (~x & z); }
  function G(x: number, y: number, z: number) { return (x & z) | (y & ~z); }
  function H(x: number, y: number, z: number) { return x ^ y ^ z; }
  function I(x: number, y: number, z: number) { return y ^ (x | ~z); }

  function rotl(x: number, n: number) { return (x << n) | (x >>> (32 - n)); }

  function add32(a: number, b: number) { return (a + b) & 0xffffffff; }

  // Pre-processing: padding
  const msgLen = input.length;
  const bitLen = msgLen * 8;
  const padLen = ((56 - (msgLen + 1) % 64) + 64) % 64;
  const totalLen = msgLen + 1 + padLen + 8;
  const msg = new Uint8Array(totalLen);
  msg.set(input);
  msg[msgLen] = 0x80;
  // Length in bits as 64-bit LE
  const view = new DataView(msg.buffer);
  view.setUint32(totalLen - 8, bitLen & 0xffffffff, true);
  view.setUint32(totalLen - 4, Math.floor(bitLen / 0x100000000) & 0xffffffff, true);

  // Per-round shift amounts
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  // Pre-computed T table (floor(2^32 * abs(sin(i+1))))
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

  // Initialize hash values
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  // Process each 512-bit block
  for (let blockStart = 0; blockStart < totalLen; blockStart += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(blockStart + j * 4, true);
    }

    let A = a0, B = b0, C = c0, D = d0;

    for (let i = 0; i < 64; i++) {
      let f: number, g: number;

      if (i < 16) {
        f = F(B, C, D);
        g = i;
      } else if (i < 32) {
        f = G(B, C, D);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = H(B, C, D);
        g = (3 * i + 5) % 16;
      } else {
        f = I(B, C, D);
        g = (7 * i) % 16;
      }

      const temp = D;
      D = C;
      C = B;
      B = add32(B, rotl(add32(add32(A, f), add32(T[i], M[g])), s[i]));
      A = temp;
    }

    a0 = add32(a0, A);
    b0 = add32(b0, B);
    c0 = add32(c0, C);
    d0 = add32(d0, D);
  }

  // Output as little-endian bytes
  const result = new Uint8Array(16);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, a0, true);
  rv.setUint32(4, b0, true);
  rv.setUint32(8, c0, true);
  rv.setUint32(12, d0, true);

  return result;
}

/**
 * Encrypt/decrypt TACACS+ body using MD5 pseudo-random pad.
 * Encryption and decryption are the same operation (XOR).
 *
 * pad = MD5(session_id + secret + version + seq_no)
 * subsequent pads chain: MD5(session_id + secret + version + seq_no + prev_pad)
 */
function tacacsEncrypt(
  body: Uint8Array,
  sessionId: number,
  secret: string,
  version: number,
  seqNo: number
): Uint8Array {
  const secretBytes = new TextEncoder().encode(secret);
  const result = new Uint8Array(body.length);
  let offset = 0;
  let prevPad: Uint8Array | null = null;

  while (offset < body.length) {
    // Build hash input: session_id(4) + secret + version(1) + seq_no(1) [+ prev_pad(16)]
    const inputLen = 4 + secretBytes.length + 1 + 1 + (prevPad ? 16 : 0);
    const hashInput = new Uint8Array(inputLen);
    const hv = new DataView(hashInput.buffer);
    let hOffset = 0;

    // Session ID (big-endian)
    hv.setUint32(hOffset, sessionId, false);
    hOffset += 4;

    // Secret
    hashInput.set(secretBytes, hOffset);
    hOffset += secretBytes.length;

    // Version
    hashInput[hOffset++] = version;

    // Sequence number
    hashInput[hOffset++] = seqNo;

    // Previous pad
    if (prevPad) {
      hashInput.set(prevPad, hOffset);
    }

    // Compute MD5 pad
    const pad = md5(hashInput);
    prevPad = pad;

    // XOR body with pad
    const chunk = Math.min(16, body.length - offset);
    for (let i = 0; i < chunk; i++) {
      result[offset + i] = body[offset + i] ^ pad[i];
    }

    offset += chunk;
  }

  return result;
}

/**
 * Build a TACACS+ packet header
 */
function buildHeader(
  type: number,
  seqNo: number,
  flags: number,
  sessionId: number,
  bodyLength: number,
  minorVersion: number = TAC_PLUS_MINOR_DEFAULT
): Uint8Array {
  const header = new Uint8Array(12);
  const view = new DataView(header.buffer);

  // Version: major (4 bits) | minor (4 bits)
  header[0] = (TAC_PLUS_MAJOR << 4) | (minorVersion & 0x0f);

  // Type
  header[1] = type;

  // Sequence number
  header[2] = seqNo;

  // Flags
  header[3] = flags;

  // Session ID
  view.setUint32(4, sessionId, false);

  // Body length
  view.setUint32(8, bodyLength, false);

  return header;
}

/**
 * Build an Authentication START packet body
 */
function buildAuthenStart(
  username: string,
  authenType: number = TAC_PLUS_AUTHEN_TYPE_ASCII
): Uint8Array {
  const userBytes = new TextEncoder().encode(username);
  const portBytes = new TextEncoder().encode('tty0');
  const remAddrBytes = new TextEncoder().encode('web-client');

  const bodyLen = 8 + userBytes.length + portBytes.length + remAddrBytes.length;
  const body = new Uint8Array(bodyLen);

  // Fixed header (8 bytes)
  body[0] = TAC_PLUS_AUTHEN_LOGIN; // action
  body[1] = 0x01; // priv_lvl (user = 1)
  body[2] = authenType; // authen_type
  body[3] = TAC_PLUS_AUTHEN_SVC_LOGIN; // service
  body[4] = userBytes.length; // user_len
  body[5] = portBytes.length; // port_len
  body[6] = remAddrBytes.length; // rem_addr_len
  body[7] = 0; // data_len

  // Variable fields
  let offset = 8;
  body.set(userBytes, offset);
  offset += userBytes.length;
  body.set(portBytes, offset);
  offset += portBytes.length;
  body.set(remAddrBytes, offset);

  return body;
}

/**
 * Build an Authentication CONTINUE packet body (for sending password)
 */
function buildAuthenContinue(userMsg: string): Uint8Array {
  const msgBytes = new TextEncoder().encode(userMsg);
  const body = new Uint8Array(5 + msgBytes.length);
  const view = new DataView(body.buffer);

  // user_msg_len (2 bytes)
  view.setUint16(0, msgBytes.length, false);

  // data_len (2 bytes)
  view.setUint16(2, 0, false);

  // flags
  body[4] = 0x00;

  // user_msg
  body.set(msgBytes, 5);

  return body;
}

/**
 * Parse a TACACS+ response header
 */
function parseHeader(data: Uint8Array): {
  majorVersion: number;
  minorVersion: number;
  type: number;
  seqNo: number;
  flags: number;
  sessionId: number;
  bodyLength: number;
} {
  const view = new DataView(data.buffer, data.byteOffset);

  const bodyLength = view.getUint32(8, false);

  // Validate body length to prevent OOM attacks
  if (bodyLength > MAX_BODY_LENGTH) {
    throw new Error(`TACACS+ body length ${bodyLength} exceeds maximum ${MAX_BODY_LENGTH}`);
  }

  return {
    majorVersion: (data[0] >> 4) & 0x0f,
    minorVersion: data[0] & 0x0f,
    type: data[1],
    seqNo: data[2],
    flags: data[3],
    sessionId: view.getUint32(4, false),
    bodyLength,
  };
}

/**
 * Check if a TACACS+ packet is encrypted
 */
function isEncrypted(flags: number): boolean {
  return (flags & TAC_PLUS_UNENCRYPTED_FLAG) === 0;
}

/**
 * Parse an Authentication REPLY body
 */
function parseAuthenReply(body: Uint8Array): {
  status: number;
  statusName: string;
  flags: number;
  serverMsg: string;
  data: string;
} {
  const view = new DataView(body.buffer, body.byteOffset);

  const status = body[0];
  const flags = body[1];
  const serverMsgLen = view.getUint16(2, false);
  const dataLen = view.getUint16(4, false);

  let offset = 6;
  let serverMsg = '';
  if (serverMsgLen > 0 && offset + serverMsgLen <= body.length) {
    serverMsg = new TextDecoder().decode(body.slice(offset, offset + serverMsgLen));
    offset += serverMsgLen;
  }

  let data = '';
  if (dataLen > 0 && offset + dataLen <= body.length) {
    data = new TextDecoder().decode(body.slice(offset, offset + dataLen));
  }

  return {
    status,
    statusName: AUTHEN_STATUS[status] || `UNKNOWN(0x${status.toString(16)})`,
    flags,
    serverMsg,
    data,
  };
}

/**
 * Handle TACACS+ server probe - checks if a host runs a TACACS+ daemon
 */
export async function handleTacacsProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { host, port = 49, secret, timeout = 10000 } = (await request.json()) as {
      host: string;
      port?: number;
      secret?: string;
      timeout?: number;
    };

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate timeout
    const validTimeout = Math.max(1000, Math.min(timeout, 300000)); // 1s to 5min

    // Check if host is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), validTimeout);
    });

    const probePromise = (async () => {
      const startTime = Date.now();

      // Connect to TACACS+ server
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      try {
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        // Generate cryptographically secure random session ID
        const sessionIdArray = new Uint32Array(1);
        crypto.getRandomValues(sessionIdArray);
        const sessionId = sessionIdArray[0];

        // Build authentication START body
        const body = buildAuthenStart('probe-user');

        // Determine encryption mode
        const useEncryption = !!secret;
        const flags = useEncryption ? TAC_PLUS_SINGLE_CONNECT_FLAG : (TAC_PLUS_UNENCRYPTED_FLAG | TAC_PLUS_SINGLE_CONNECT_FLAG);

        // Encrypt body if secret provided
        const finalBody = useEncryption
          ? tacacsEncrypt(body, sessionId, secret, (TAC_PLUS_MAJOR << 4) | TAC_PLUS_MINOR_DEFAULT, 1)
          : body;

        // Build header
        const header = buildHeader(TAC_PLUS_AUTHEN, 1, flags, sessionId, finalBody.length);

        // Send packet
        const packet = new Uint8Array(12 + finalBody.length);
        packet.set(header, 0);
        packet.set(finalBody, 12);
        await writer.write(packet);

        // Read response header (12 bytes)
        const { data: respHeader, leftover } = await readExactBytes(reader, 12);
        const parsedHeader = parseHeader(respHeader);

        // Validate response
        if (parsedHeader.majorVersion !== TAC_PLUS_MAJOR) {
          throw new Error(`Invalid TACACS+ response: major version ${parsedHeader.majorVersion}, expected ${TAC_PLUS_MAJOR}`);
        }

        // Validate minor version per RFC 8907 §3.1
        if (parsedHeader.minorVersion !== TAC_PLUS_MINOR_DEFAULT) {
          throw new Error(`TACACS+ minor version mismatch: ${parsedHeader.minorVersion}, expected ${TAC_PLUS_MINOR_DEFAULT}`);
        }

        // Validate sequence number (server reply should be seq_no=2)
        if (parsedHeader.seqNo !== 2) {
          throw new Error(`TACACS+ sequence number mismatch: got ${parsedHeader.seqNo}, expected 2`);
        }

        // Read response body
        let respBody: Uint8Array;
        if (parsedHeader.bodyLength > 0) {
          const { data: bodyData } = await readExactBytes(reader, parsedHeader.bodyLength, leftover);

          // Decrypt if encrypted
          if (isEncrypted(parsedHeader.flags) && secret) {
            respBody = tacacsEncrypt(bodyData, sessionId, secret, (TAC_PLUS_MAJOR << 4) | TAC_PLUS_MINOR_DEFAULT, parsedHeader.seqNo);
          } else {
            respBody = bodyData;
          }
        } else {
          respBody = new Uint8Array(0);
        }

        // Parse authentication reply
        let reply = null;
        if (parsedHeader.type === TAC_PLUS_AUTHEN && respBody.length >= 6) {
          reply = parseAuthenReply(respBody);
        }

        const totalTime = Date.now() - startTime;

        // Cleanup
        try { writer.releaseLock(); } catch { /* ignore lock release errors */ }
        try { reader.releaseLock(); } catch { /* ignore lock release errors */ }
        try { await socket.close(); } catch { /* ignore close errors */ }

        return {
          success: true,
          host,
          port,
          serverVersion: {
            major: parsedHeader.majorVersion,
            minor: parsedHeader.minorVersion,
          },
          responseType: PACKET_TYPE_NAMES[parsedHeader.type] || `Unknown(${parsedHeader.type})`,
          seqNo: parsedHeader.seqNo,
          flags: {
            encrypted: isEncrypted(parsedHeader.flags),
            singleConnect: (parsedHeader.flags & TAC_PLUS_SINGLE_CONNECT_FLAG) !== 0,
          },
          sessionId: `0x${sessionId.toString(16).padStart(8, '0')}`,
          encrypted: useEncryption,
          reply: reply
            ? {
                status: reply.statusName,
                statusCode: reply.status,
                serverMsg: reply.serverMsg || null,
                data: reply.data || null,
              }
            : null,
          connectTimeMs: connectTime,
          totalTimeMs: totalTime,
        };
      } catch (error) {
        try { await socket.close(); } catch { /* ignore close errors */ }
        throw error;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    })();

    const result = await Promise.race([probePromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Probe failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle TACACS+ authentication test - full LOGIN flow
 */
export async function handleTacacsAuthenticate(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const {
      host,
      port = 49,
      secret,
      username,
      password,
      timeout = 15000,
    } = (await request.json()) as {
      host: string;
      port?: number;
      secret?: string;
      username: string;
      password: string;
      timeout?: number;
    };

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!username) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate timeout
    const validTimeout = Math.max(1000, Math.min(timeout, 300000)); // 1s to 5min

    // Check Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), validTimeout);
    });

    const authPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      try {
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        // Generate cryptographically secure random session ID
        const sessionIdArray = new Uint32Array(1);
        crypto.getRandomValues(sessionIdArray);
        const sessionId = sessionIdArray[0];
        const useEncryption = !!secret;
        const flags = useEncryption
          ? TAC_PLUS_SINGLE_CONNECT_FLAG
          : (TAC_PLUS_UNENCRYPTED_FLAG | TAC_PLUS_SINGLE_CONNECT_FLAG);
        const version = (TAC_PLUS_MAJOR << 4) | TAC_PLUS_MINOR_DEFAULT;

        const steps: Array<{ step: string; status: string; message?: string }> = [];
        let seqNo = 1;

        // Step 1: Send Authentication START
        const startBody = buildAuthenStart(username);
        const encStartBody = useEncryption
          ? tacacsEncrypt(startBody, sessionId, secret, version, seqNo)
          : startBody;
        const startHeader = buildHeader(TAC_PLUS_AUTHEN, seqNo, flags, sessionId, encStartBody.length);
        const startPacket = new Uint8Array(12 + encStartBody.length);
        startPacket.set(startHeader, 0);
        startPacket.set(encStartBody, 12);
        await writer.write(startPacket);
        seqNo++;

        steps.push({ step: 'Authentication START', status: 'sent' });

        // Step 2: Read first reply
        const { data: replyHeader, leftover: replyLeftover } = await readExactBytes(reader, 12);
        const replyH = parseHeader(replyHeader);

        // Validate response
        if (replyH.majorVersion !== TAC_PLUS_MAJOR) {
          throw new Error(`Invalid TACACS+ response: major version ${replyH.majorVersion}, expected ${TAC_PLUS_MAJOR}`);
        }

        // Validate minor version per RFC 8907 §3.1
        if (replyH.minorVersion !== TAC_PLUS_MINOR_DEFAULT) {
          throw new Error(`TACACS+ minor version mismatch: ${replyH.minorVersion}, expected ${TAC_PLUS_MINOR_DEFAULT}`);
        }

        // Validate sequence number (server reply should be seq_no=2)
        if (replyH.seqNo !== 2) {
          throw new Error(`TACACS+ sequence number mismatch: got ${replyH.seqNo}, expected 2`);
        }

        let replyBody: Uint8Array;
        if (replyH.bodyLength > 0) {
          const { data: bd } = await readExactBytes(reader, replyH.bodyLength, replyLeftover);
          replyBody = (isEncrypted(replyH.flags) && secret) ? tacacsEncrypt(bd, sessionId, secret, version, replyH.seqNo) : bd;
        } else {
          replyBody = new Uint8Array(0);
        }

        const firstReply = replyBody.length >= 6 ? parseAuthenReply(replyBody) : null;

        if (firstReply) {
          steps.push({
            step: 'First REPLY',
            status: firstReply.statusName,
            message: firstReply.serverMsg || undefined,
          });
        }

        let finalStatus = firstReply?.statusName || 'UNKNOWN';
        let finalMessage = firstReply?.serverMsg || '';

        // Step 3: If server asks for password (GETPASS), send CONTINUE
        if (firstReply && (firstReply.status === 0x05 || firstReply.status === 0x03)) {
          // Client CONTINUE uses seq_no=3 (previous was START=1, server reply=2)
          const continueSeqNo = 3;
          const continueBody = buildAuthenContinue(password || '');
          const encContinueBody = useEncryption
            ? tacacsEncrypt(continueBody, sessionId, secret, version, continueSeqNo)
            : continueBody;
          const continueHeader = buildHeader(TAC_PLUS_AUTHEN, continueSeqNo, flags, sessionId, encContinueBody.length);
          const continuePacket = new Uint8Array(12 + encContinueBody.length);
          continuePacket.set(continueHeader, 0);
          continuePacket.set(encContinueBody, 12);
          await writer.write(continuePacket);

          steps.push({ step: 'Authentication CONTINUE', status: 'sent' });

          // Step 4: Read final reply
          const { data: finalHeader, leftover: finalLeftover } = await readExactBytes(reader, 12);
          const finalH = parseHeader(finalHeader);

          // Validate final response sequence number (should be 4)
          if (finalH.seqNo !== 4) {
            throw new Error(`TACACS+ sequence number mismatch in final reply: got ${finalH.seqNo}, expected 4`);
          }

          let finalBody: Uint8Array;
          if (finalH.bodyLength > 0) {
            const { data: fb } = await readExactBytes(reader, finalH.bodyLength, finalLeftover);
            finalBody = (isEncrypted(finalH.flags) && secret) ? tacacsEncrypt(fb, sessionId, secret, version, finalH.seqNo) : fb;
          } else {
            finalBody = new Uint8Array(0);
          }

          const secondReply = finalBody.length >= 6 ? parseAuthenReply(finalBody) : null;

          if (secondReply) {
            finalStatus = secondReply.statusName;
            finalMessage = secondReply.serverMsg || '';
            steps.push({
              step: 'Final REPLY',
              status: secondReply.statusName,
              message: secondReply.serverMsg || undefined,
            });
          }
        }

        const totalTime = Date.now() - startTime;

        try { writer.releaseLock(); } catch { /* ignore lock release errors */ }
        try { reader.releaseLock(); } catch { /* ignore lock release errors */ }
        try { await socket.close(); } catch { /* ignore close errors */ }

        return {
          success: true,
          authenticated: finalStatus === 'PASS',
          host,
          port,
          username,
          encrypted: useEncryption,
          finalStatus,
          finalMessage: finalMessage || null,
          steps,
          connectTimeMs: connectTime,
          totalTimeMs: totalTime,
        };
      } catch (error) {
        try { await socket.close(); } catch { /* ignore close errors */ }
        throw error;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    })();

    const result = await Promise.race([authPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
