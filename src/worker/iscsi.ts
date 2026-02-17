/**
 * iSCSI Protocol Implementation (RFC 7143)
 *
 * Internet Small Computer System Interface — block-level storage over IP.
 * Port 3260 (TCP).
 *
 * Endpoints implemented:
 * - Login + SendTargets Discovery — Discover available iSCSI targets
 *
 * The iSCSI Login phase uses binary PDUs with a 48-byte Basic Header Segment (BHS):
 *   Byte 0:    Opcode (0x03 = Login Request, 0x23 = Login Response)
 *   Byte 1:    Flags (T=Transit, C=Continue, CSG/NSG stage indicators)
 *   Bytes 4-7: TotalAHSLength (1 byte) + DataSegmentLength (3 bytes)
 *   Bytes 8-15: ISID (6 bytes) + TSIH (2 bytes)
 *   Bytes 16-19: Initiator Task Tag
 *   Bytes 20-23: CID (2 bytes) + reserved
 *   Bytes 24-27: CmdSN
 *   Bytes 28-31: ExpStatSN
 *   Bytes 32-47: Reserved
 *   Data Segment: Key=Value text pairs (null-terminated)
 *
 * Use Cases:
 * - iSCSI target discovery and enumeration
 * - Storage infrastructure health checking
 * - SAN connectivity verification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface ISCSIRequest {
  host: string;
  port?: number;
  timeout?: number;
  initiatorName?: string;
}

/**
 * Build an iSCSI Login Request PDU for SendTargets discovery
 */
function buildLoginRequest(initiatorName: string, cmdSN: number): Uint8Array {
  // Key-value pairs for discovery session
  const kvPairs = [
    `InitiatorName=${initiatorName}`,
    'SessionType=Discovery',
    'AuthMethod=None',
    'HeaderDigest=None',
    'DataDigest=None',
    'MaxRecvDataSegmentLength=65536',
    'DefaultTime2Wait=2',
    'DefaultTime2Retain=0',
  ];

  // Null-terminate each key-value pair and join
  const dataText = kvPairs.map(kv => kv + '\0').join('');
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(dataText);

  // Pad data to 4-byte boundary
  const paddedLen = Math.ceil(dataBytes.length / 4) * 4;
  const paddedData = new Uint8Array(paddedLen);
  paddedData.set(dataBytes);

  // Build 48-byte BHS (Basic Header Segment)
  const bhs = new Uint8Array(48);

  // Byte 0: Opcode 0x03 (Login Request), Immediate bit set
  bhs[0] = 0x43; // 0x40 (Immediate) | 0x03 (Login Request)

  // Byte 1: Flags — T=1 (Transit), CSG=00 (SecurityNegotiation), NSG=01 (LoginOperationalNegotiation)
  // Actually for discovery with AuthMethod=None, go straight: T=1, CSG=01 (LoginOp), NSG=11 (FullFeature)
  bhs[1] = 0x87; // T=1 (0x80) | CSG=01 (0x04) | NSG=11 (0x03) = 0x87

  // Byte 2-3: Version max/min
  bhs[2] = 0x00; // Version-max: 0
  bhs[3] = 0x00; // Version-min: 0

  // Byte 4: TotalAHSLength = 0
  bhs[4] = 0x00;

  // Bytes 5-7: DataSegmentLength (3 bytes, big-endian)
  bhs[5] = (dataBytes.length >> 16) & 0xff;
  bhs[6] = (dataBytes.length >> 8) & 0xff;
  bhs[7] = dataBytes.length & 0xff;

  // Bytes 8-13: ISID (Initiator Session ID) - 6 bytes
  // Use type 0x00 (OUI), qualifier 0x023d (IANA enterprise number for "example")
  bhs[8] = 0x00;  // Type + A
  bhs[9] = 0x02;  // B
  bhs[10] = 0x3d; // C
  bhs[11] = 0x00; // D (2 bytes)
  bhs[12] = 0x00;
  bhs[13] = 0x01; // Qualifier

  // Bytes 14-15: TSIH = 0x0000 (new session)
  bhs[14] = 0x00;
  bhs[15] = 0x00;

  // Bytes 16-19: Initiator Task Tag
  bhs[16] = 0x00;
  bhs[17] = 0x00;
  bhs[18] = 0x00;
  bhs[19] = 0x01;

  // Bytes 20-21: CID = 0
  bhs[20] = 0x00;
  bhs[21] = 0x00;

  // Bytes 24-27: CmdSN
  bhs[24] = (cmdSN >> 24) & 0xff;
  bhs[25] = (cmdSN >> 16) & 0xff;
  bhs[26] = (cmdSN >> 8) & 0xff;
  bhs[27] = cmdSN & 0xff;

  // Bytes 28-31: ExpStatSN = 0
  bhs[28] = 0x00;
  bhs[29] = 0x00;
  bhs[30] = 0x00;
  bhs[31] = 0x00;

  // Combine BHS + padded data
  const pdu = new Uint8Array(48 + paddedLen);
  pdu.set(bhs);
  pdu.set(paddedData, 48);

  return pdu;
}

/**
 * Build a SendTargets Text Request PDU
 */
function buildTextRequest(cmdSN: number, expStatSN: number): Uint8Array {
  const dataText = 'SendTargets=All\0';
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(dataText);

  const paddedLen = Math.ceil(dataBytes.length / 4) * 4;
  const paddedData = new Uint8Array(paddedLen);
  paddedData.set(dataBytes);

  const bhs = new Uint8Array(48);

  // Byte 0: Opcode 0x04 (Text Request), Immediate
  bhs[0] = 0x44; // 0x40 | 0x04

  // Byte 1: F=1 (Final)
  bhs[1] = 0x80;

  // Bytes 5-7: DataSegmentLength
  bhs[5] = (dataBytes.length >> 16) & 0xff;
  bhs[6] = (dataBytes.length >> 8) & 0xff;
  bhs[7] = dataBytes.length & 0xff;

  // Bytes 16-19: Initiator Task Tag
  bhs[16] = 0x00;
  bhs[17] = 0x00;
  bhs[18] = 0x00;
  bhs[19] = 0x02;

  // Bytes 20-23: Target Transfer Tag = 0xFFFFFFFF
  bhs[20] = 0xff;
  bhs[21] = 0xff;
  bhs[22] = 0xff;
  bhs[23] = 0xff;

  // Bytes 24-27: CmdSN
  bhs[24] = (cmdSN >> 24) & 0xff;
  bhs[25] = (cmdSN >> 16) & 0xff;
  bhs[26] = (cmdSN >> 8) & 0xff;
  bhs[27] = cmdSN & 0xff;

  // Bytes 28-31: ExpStatSN
  bhs[28] = (expStatSN >> 24) & 0xff;
  bhs[29] = (expStatSN >> 16) & 0xff;
  bhs[30] = (expStatSN >> 8) & 0xff;
  bhs[31] = expStatSN & 0xff;

  const pdu = new Uint8Array(48 + paddedLen);
  pdu.set(bhs);
  pdu.set(paddedData, 48);

  return pdu;
}

/**
 * Parse an iSCSI Login Response PDU
 */
function parseLoginResponse(data: Uint8Array): {
  opcode: number;
  statusClass: number;
  statusDetail: number;
  isTransit: boolean;
  csg: number;
  nsg: number;
  versionMax: number;
  versionActive: number;
  tsih: number;
  statSN: number;
  dataLength: number;
  kvPairs: Record<string, string>;
} {
  const opcode = data[0] & 0x3f;
  const flags = data[1];
  const isTransit = !!(flags & 0x80);
  const csg = (flags >> 2) & 0x03;
  const nsg = flags & 0x03;

  const versionMax = data[2];
  const versionActive = data[3];

  const dataLength = ((data[5] << 16) | (data[6] << 8) | data[7]);

  const tsih = (data[14] << 8) | data[15];
  const statSN = (data[24] << 24) | (data[25] << 16) | (data[26] << 8) | data[27];

  const statusClass = data[36];
  const statusDetail = data[37];

  // Parse key-value data
  const kvPairs: Record<string, string> = {};
  if (dataLength > 0 && data.length >= 48 + dataLength) {
    const decoder = new TextDecoder();
    const dataText = decoder.decode(data.slice(48, 48 + dataLength));
    const pairs = dataText.split('\0').filter(s => s.length > 0);
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        kvPairs[pair.substring(0, eqIdx)] = pair.substring(eqIdx + 1);
      }
    }
  }

  return { opcode, statusClass, statusDetail, isTransit, csg, nsg, versionMax, versionActive, tsih, statSN, dataLength, kvPairs };
}

/**
 * Parse a Text Response PDU for SendTargets
 */
function parseTextResponse(data: Uint8Array): {
  opcode: number;
  isFinal: boolean;
  dataLength: number;
  targets: Array<{ name: string; addresses: string[] }>;
  kvPairs: Record<string, string>;
} {
  const opcode = data[0] & 0x3f;
  const isFinal = !!(data[1] & 0x80);
  const dataLength = ((data[5] << 16) | (data[6] << 8) | data[7]);

  const kvPairs: Record<string, string> = {};
  const targets: Array<{ name: string; addresses: string[] }> = [];

  if (dataLength > 0 && data.length >= 48 + dataLength) {
    const decoder = new TextDecoder();
    const dataText = decoder.decode(data.slice(48, 48 + dataLength));
    const pairs = dataText.split('\0').filter(s => s.length > 0);

    let currentTarget: { name: string; addresses: string[] } | null = null;
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const key = pair.substring(0, eqIdx);
        const value = pair.substring(eqIdx + 1);
        kvPairs[key] = value;

        if (key === 'TargetName') {
          currentTarget = { name: value, addresses: [] };
          targets.push(currentTarget);
        } else if (key === 'TargetAddress' && currentTarget) {
          currentTarget.addresses.push(value);
        }
      }
    }
  }

  return { opcode, isFinal, dataLength, targets, kvPairs };
}

/**
 * Get iSCSI status class description
 */
function getStatusDescription(statusClass: number, statusDetail: number): string {
  const classes: Record<number, string> = {
    0x00: 'Success',
    0x01: 'Redirection',
    0x02: 'Initiator Error',
    0x03: 'Target Error',
  };

  const details: Record<string, string> = {
    '0:0': 'Login successful',
    '1:1': 'Target moved temporarily',
    '1:2': 'Target moved permanently',
    '2:0': 'Initiator error (miscellaneous)',
    '2:1': 'Authentication failure',
    '2:2': 'Authorization failure',
    '2:3': 'Target not found',
    '2:4': 'Target removed',
    '2:5': 'Unsupported version',
    '2:6': 'Too many connections',
    '2:7': 'Missing parameter',
    '2:8': 'Cannot include in session',
    '2:9': 'Session type not supported',
    '2:10': 'Session does not exist',
    '2:11': 'Invalid during login',
    '3:0': 'Target error (miscellaneous)',
    '3:1': 'Service unavailable',
    '3:2': 'Out of resources',
  };

  const classDesc = classes[statusClass] || `Unknown (0x${statusClass.toString(16)})`;
  const detailDesc = details[`${statusClass}:${statusDetail}`] || '';

  return detailDesc ? `${classDesc} — ${detailDesc}` : classDesc;
}

interface ISCSILoginRequest {
  host: string;
  port?: number;
  timeout?: number;
  initiatorName: string;
  targetName?: string;
  username?: string;
  password?: string;
}

/**
 * Build an iSCSI Login Request PDU with configurable auth method.
 * If username/password provided, advertises CHAP,None; otherwise None.
 * chapResponse: if provided, this is the CHAP_R response round (authentication phase).
 */
function buildLoginRequestAuth(
  initiatorName: string,
  cmdSN: number,
  options: {
    chapResponse?: { chapN: string; chapR: string };
    offerChap?: boolean;
    // Stage: 0=SecurityNeg, 1=LoginOperational, 3=FullFeature
    csg?: number;
    nsg?: number;
    transit?: boolean;
  } = {}
): Uint8Array {
  const { chapResponse, offerChap = false, csg = 0, nsg = 1, transit = false } = options;

  let kvPairs: string[];

  if (chapResponse) {
    // CHAP authentication response round
    kvPairs = [
      `CHAP_N=${chapResponse.chapN}`,
      `CHAP_R=${chapResponse.chapR}`,
    ];
  } else if (offerChap) {
    // Initial security negotiation: offer CHAP,None
    kvPairs = [
      `InitiatorName=${initiatorName}`,
      'SessionType=Discovery',
      'AuthMethod=CHAP,None',
    ];
  } else {
    // No-auth login straight to LoginOperational
    kvPairs = [
      `InitiatorName=${initiatorName}`,
      'SessionType=Discovery',
      'AuthMethod=None',
      'HeaderDigest=None',
      'DataDigest=None',
      'MaxRecvDataSegmentLength=65536',
      'DefaultTime2Wait=2',
      'DefaultTime2Retain=0',
    ];
  }

  const dataText = kvPairs.map(kv => kv + '\0').join('');
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(dataText);
  const paddedLen = Math.ceil(dataBytes.length / 4) * 4;
  const paddedData = new Uint8Array(paddedLen);
  paddedData.set(dataBytes);

  const bhs = new Uint8Array(48);
  bhs[0] = 0x43; // Immediate | Login Request

  // Flags: T=transit, CSG, NSG
  let flags = (csg & 0x03) << 2 | (nsg & 0x03);
  if (transit) flags |= 0x80;
  bhs[1] = flags;

  bhs[2] = 0x00; // Version-max
  bhs[3] = 0x00; // Version-min
  bhs[4] = 0x00; // TotalAHSLength

  bhs[5] = (dataBytes.length >> 16) & 0xff;
  bhs[6] = (dataBytes.length >> 8) & 0xff;
  bhs[7] = dataBytes.length & 0xff;

  // ISID
  bhs[8] = 0x00; bhs[9] = 0x02; bhs[10] = 0x3d;
  bhs[11] = 0x00; bhs[12] = 0x00; bhs[13] = 0x01;

  // TSIH = 0 (new session)
  bhs[14] = 0x00; bhs[15] = 0x00;

  // Initiator Task Tag
  bhs[16] = 0x00; bhs[17] = 0x00; bhs[18] = 0x00; bhs[19] = 0x01;

  // CmdSN
  bhs[24] = (cmdSN >> 24) & 0xff;
  bhs[25] = (cmdSN >> 16) & 0xff;
  bhs[26] = (cmdSN >> 8) & 0xff;
  bhs[27] = cmdSN & 0xff;

  // ExpStatSN = 0
  bhs[28] = 0x00; bhs[29] = 0x00; bhs[30] = 0x00; bhs[31] = 0x00;

  const pdu = new Uint8Array(48 + paddedLen);
  pdu.set(bhs);
  pdu.set(paddedData, 48);
  return pdu;
}

/**
 * Read a complete iSCSI PDU (48-byte BHS + data segment).
 */
async function readISCSIPDU(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Uint8Array | null> {
  let buf = new Uint8Array(0);

  while (true) {
    const { value, done } = await reader.read();
    if (done || !value) return buf.length >= 48 ? buf : null;

    const newBuf = new Uint8Array(buf.length + value.length);
    newBuf.set(buf);
    newBuf.set(value, buf.length);
    buf = newBuf;

    if (buf.length >= 48) {
      const dataLen = ((buf[5] << 16) | (buf[6] << 8) | buf[7]);
      const paddedDataLen = Math.ceil(dataLen / 4) * 4;
      const totalLen = 48 + paddedDataLen;
      if (buf.length >= totalLen) return buf.slice(0, totalLen);
    }
  }
}

/**
 * Pure-JS MD5 (RFC 1321) — used for CHAP response computation.
 * Returns a 16-byte Uint8Array.
 */
function md5Bytes(input: Uint8Array): Uint8Array {
  const s = [
    7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,
    5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,
    4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,
    6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,
  ];
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];
  const msgLen = input.length;
  const bitLen = msgLen * 8;
  const padLen = ((msgLen % 64) < 56) ? (56 - msgLen % 64) : (120 - msgLen % 64);
  const padded = new Uint8Array(msgLen + padLen + 8);
  padded.set(input);
  padded[msgLen] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(msgLen + padLen, bitLen & 0xffffffff, true);
  dv.setUint32(msgLen + padLen + 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const M = new Uint32Array(16);
    const cv = new DataView(padded.buffer, chunk, 64);
    for (let j = 0; j < 16; j++) M[j] = cv.getUint32(j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16)       { F = (B & C) | (~B & D); g = i; }
      else if (i < 32)  { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48)  { F = B ^ C ^ D;           g = (3 * i + 5) % 16; }
      else              { F = C ^ (B | ~D);         g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }

  const result = new Uint8Array(16);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, a0, true); rv.setUint32(4, b0, true);
  rv.setUint32(8, c0, true); rv.setUint32(12, d0, true);
  return result;
}

function hexString(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Handle iSCSI Login with optional CHAP authentication.
 *
 * Sends a Login Request PDU. If the server requires CHAP, parses the challenge,
 * computes MD5(CHAP_I_byte || password || CHAP_C_decoded), and responds.
 * Optionally follows up with a SendTargets text request if targetName is given.
 */
export async function handleISCSILogin(request: Request): Promise<Response> {
  try {
    const body = await request.json() as ISCSILoginRequest;
    const {
      host,
      port = 3260,
      timeout = 10000,
      username,
      password,
    } = body;
    const initiatorName = body.initiatorName || 'iqn.2024-01.gg.ross.portofcall:initiator';
    const targetName = body.targetName;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const loginPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        const useChap = !!(username && password);

        // ------------------------------------------------------------------
        // Step 1: Send initial Login Request
        // ------------------------------------------------------------------
        if (useChap) {
          // Security negotiation stage: offer CHAP,None
          // CSG=0 (SecurityNeg), NSG=1 (LoginOp), T=0 (not transitioning yet)
          const loginReq = buildLoginRequestAuth(initiatorName, 1, {
            offerChap: true,
            csg: 0,
            nsg: 1,
            transit: false,
          });
          await writer.write(loginReq);
        } else {
          // No-auth: go straight to LoginOperational
          // CSG=1 (LoginOp), NSG=3 (FullFeature), T=1
          const loginReq = buildLoginRequestAuth(initiatorName, 1, {
            csg: 1,
            nsg: 3,
            transit: true,
          });
          await writer.write(loginReq);
        }

        // ------------------------------------------------------------------
        // Read Login Response
        // ------------------------------------------------------------------
        let responseData = await readISCSIPDU(reader);
        if (!responseData || responseData.length < 48) {
          await socket.close();
          return { success: false, host, port, rtt: Date.now() - startTime, error: 'No login response' };
        }

        let loginResp = parseLoginResponse(responseData);

        // Check if server chose CHAP
        let chapUsed = false;
        let sessionId: string | undefined;
        let tsih: number | undefined;

        if (useChap && loginResp.kvPairs['AuthMethod'] === 'CHAP') {
          // ------------------------------------------------------------------
          // Step 2: CHAP challenge-response
          // Server sends CHAP_A (algorithm), CHAP_I (identifier), CHAP_C (challenge)
          // ------------------------------------------------------------------
          const chapA = loginResp.kvPairs['CHAP_A'];   // Should be "5" (MD5)
          const chapI = loginResp.kvPairs['CHAP_I'];   // Identifier byte as decimal string
          const chapC = loginResp.kvPairs['CHAP_C'];   // Challenge as hex string (0x...)

          if (!chapI || !chapC) {
            await socket.close();
            return {
              success: false, host, port, rtt: Date.now() - startTime,
              error: `CHAP required but missing challenge params (CHAP_A=${chapA}, CHAP_I=${chapI}, CHAP_C=${chapC})`,
            };
          }

          if (chapA && chapA !== '5') {
            await socket.close();
            return {
              success: false, host, port, rtt: Date.now() - startTime,
              error: `CHAP algorithm ${chapA} not supported — only MD5 (5) is supported`,
            };
          }

          // Decode CHAP_I (identifier byte)
          const chapIdByte = parseInt(chapI, 10) & 0xff;

          // Decode CHAP_C (challenge): may be "0x..." hex or plain base64
          let challengeBytes: Uint8Array;
          const chapCStr = chapC.startsWith('0x') ? chapC.slice(2) : chapC;
          challengeBytes = new Uint8Array(chapCStr.length / 2);
          for (let i = 0; i < challengeBytes.length; i++) {
            challengeBytes[i] = parseInt(chapCStr.slice(i * 2, i * 2 + 2), 16);
          }

          // Compute CHAP response: MD5(CHAP_I_byte || password || challenge)
          const encoder = new TextEncoder();
          const passwordBytes = encoder.encode(password);
          const md5Input = new Uint8Array(1 + passwordBytes.length + challengeBytes.length);
          md5Input[0] = chapIdByte;
          md5Input.set(passwordBytes, 1);
          md5Input.set(challengeBytes, 1 + passwordBytes.length);
          const chapResponseBytes = md5Bytes(md5Input);
          const chapR = '0x' + hexString(chapResponseBytes);

          // Send CHAP response: CSG=0, NSG=1, T=1 (transit to LoginOp)
          const chapRespPDU = buildLoginRequestAuth(initiatorName, 2, {
            chapResponse: { chapN: username!, chapR },
            csg: 0,
            nsg: 1,
            transit: true,
          });
          await writer.write(chapRespPDU);

          // Read CHAP auth result
          const chapRespData = await readISCSIPDU(reader);
          if (!chapRespData || chapRespData.length < 48) {
            await socket.close();
            return { success: false, host, port, rtt: Date.now() - startTime, error: 'No CHAP response' };
          }
          responseData = chapRespData;
          loginResp = parseLoginResponse(responseData);
          chapUsed = true;
        }

        if (loginResp.statusClass !== 0) {
          await socket.close();
          const loginStatus = getStatusDescription(loginResp.statusClass, loginResp.statusDetail);
          return {
            success: false, host, port, rtt: Date.now() - startTime,
            authenticated: false, chap: chapUsed,
            error: `Login failed: ${loginStatus}`,
          };
        }

        // Extract session info
        tsih = loginResp.tsih;
        // ISID is in BHS bytes 8-13 (6 bytes); format as hex
        const isid = Array.from(responseData.slice(8, 14)).map(b => b.toString(16).padStart(2, '0')).join('');
        sessionId = isid;

        // ------------------------------------------------------------------
        // Step 3: Send Text Request for SendTargets if targetName requested
        // ------------------------------------------------------------------
        let targets: Array<{ name: string; addresses: string[] }> = [];

        if (targetName || loginResp.isTransit) {
          // Proceed to FullFeature phase (if not already transitioned)
          // Send LoginOperational phase PDU to complete login
          if (!loginResp.isTransit || loginResp.nsg !== 3) {
            // Need to send another login PDU to transition to FullFeature
            const loginOp = buildLoginRequestAuth(initiatorName, 3, {
              csg: 1,
              nsg: 3,
              transit: true,
            });
            await writer.write(loginOp);

            const loginOpResp = await readISCSIPDU(reader);
            if (loginOpResp && loginOpResp.length >= 48) {
              const lResp = parseLoginResponse(loginOpResp);
              if (lResp.statusClass !== 0) {
                await socket.close();
                return {
                  success: false, host, port, rtt: Date.now() - startTime,
                  error: 'Failed to transition to FullFeature phase',
                };
              }
            }
          }

          // Now send SendTargets text request
          const textReq = buildTextRequest(4, loginResp.statSN + 1);
          await writer.write(textReq);

          const textData = await readISCSIPDU(reader);
          if (textData && textData.length >= 48) {
            const textOpcode = textData[0] & 0x3f;
            if (textOpcode === 0x24) {
              const textResp = parseTextResponse(textData);
              targets = textResp.targets;
            }
          }
        }

        const rtt = Date.now() - startTime;
        await socket.close();

        return {
          success: true,
          host,
          port,
          rtt,
          authenticated: true,
          sessionId,
          tsih,
          chap: chapUsed,
          targets: targets.map(t => ({ name: t.name, addresses: t.addresses })),
          negotiatedParams: loginResp.kvPairs,
        };

      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([loginPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      status: (result as { success: boolean }).success ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    if (error instanceof Error && error.message === 'Connection timeout') {
      return new Response(JSON.stringify({ success: false, error: 'Connection timeout' }), {
        status: 504, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle iSCSI Discovery — Login + SendTargets
 */
export async function handleISCSIDiscover(request: Request): Promise<Response> {
  try {
    const body = await request.json() as ISCSIRequest;
    const { host, port = 3260, timeout = 10000 } = body;
    const initiatorName = body.initiatorName || 'iqn.2024-01.gg.ross.portofcall:initiator';

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if behind Cloudflare
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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const discoveryPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Step 1: Send Login Request (discovery session)
        const loginReq = buildLoginRequest(initiatorName, 1);
        await writer.write(loginReq);

        // Read Login Response
        let responseData = new Uint8Array(0);
        while (responseData.length < 48) {
          const { value, done } = await reader.read();
          if (done) break;
          const newData = new Uint8Array(responseData.length + value.length);
          newData.set(responseData);
          newData.set(value, responseData.length);
          responseData = newData;
        }

        if (responseData.length < 48) {
          const rtt = Date.now() - startTime;
          await socket.close();
          return {
            success: false,
            host,
            port,
            rtt,
            error: `Incomplete login response: received ${responseData.length} of 48+ bytes`,
            isISCSI: false,
          };
        }

        // Check opcode
        const loginOpcode = responseData[0] & 0x3f;
        if (loginOpcode !== 0x23) {
          const rtt = Date.now() - startTime;
          await socket.close();
          return {
            success: false,
            host,
            port,
            rtt,
            error: `Not an iSCSI target: unexpected opcode 0x${loginOpcode.toString(16)}`,
            isISCSI: false,
          };
        }

        // Read full login response (BHS + data)
        const loginDataLen = ((responseData[5] << 16) | (responseData[6] << 8) | responseData[7]);
        const paddedLoginDataLen = Math.ceil(loginDataLen / 4) * 4;
        const totalLoginLen = 48 + paddedLoginDataLen;

        while (responseData.length < totalLoginLen) {
          const { value, done } = await reader.read();
          if (done) break;
          const newData = new Uint8Array(responseData.length + value.length);
          newData.set(responseData);
          newData.set(value, responseData.length);
          responseData = newData;
        }

        const loginResp = parseLoginResponse(responseData);
        const loginStatus = getStatusDescription(loginResp.statusClass, loginResp.statusDetail);

        if (loginResp.statusClass !== 0) {
          const rtt = Date.now() - startTime;
          await socket.close();
          return {
            success: false,
            host,
            port,
            rtt,
            isISCSI: true,
            loginStatus,
            loginStatusClass: loginResp.statusClass,
            loginStatusDetail: loginResp.statusDetail,
            negotiatedParams: loginResp.kvPairs,
            error: `Login failed: ${loginStatus}`,
          };
        }

        // Step 2: Send Text Request (SendTargets=All)
        const textReq = buildTextRequest(2, loginResp.statSN + 1);
        await writer.write(textReq);

        // Read Text Response
        let textData = new Uint8Array(0);
        while (textData.length < 48) {
          const { value, done } = await reader.read();
          if (done) break;
          const newData = new Uint8Array(textData.length + value.length);
          newData.set(textData);
          newData.set(value, textData.length);
          textData = newData;
        }

        const rtt = Date.now() - startTime;

        let targets: Array<{ name: string; addresses: string[] }> = [];
        let textKvPairs: Record<string, string> = {};

        if (textData.length >= 48) {
          const textOpcode = textData[0] & 0x3f;
          if (textOpcode === 0x24) {
            // Read full text response
            const textDataLen = ((textData[5] << 16) | (textData[6] << 8) | textData[7]);
            const paddedTextDataLen = Math.ceil(textDataLen / 4) * 4;
            const totalTextLen = 48 + paddedTextDataLen;

            while (textData.length < totalTextLen) {
              const { value, done } = await reader.read();
              if (done) break;
              const newData = new Uint8Array(textData.length + value.length);
              newData.set(textData);
              newData.set(value, textData.length);
              textData = newData;
            }

            const textResp = parseTextResponse(textData);
            targets = textResp.targets;
            textKvPairs = textResp.kvPairs;
          }
        }

        await socket.close();

        return {
          success: true,
          host,
          port,
          rtt,
          isISCSI: true,
          loginStatus,
          versionMax: loginResp.versionMax,
          versionActive: loginResp.versionActive,
          tsih: loginResp.tsih,
          negotiatedParams: loginResp.kvPairs,
          targets: targets.map(t => ({
            name: t.name,
            addresses: t.addresses,
          })),
          targetCount: targets.length,
          rawKvPairs: textKvPairs,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([discoveryPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Connection timeout') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Connection timeout',
      }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
