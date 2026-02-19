/**
 * NetBIOS Session Service Protocol Support for Cloudflare Workers
 *
 * NetBIOS Session Service (RFC 1002) is a transport-layer protocol
 * used primarily for SMB/CIFS file sharing over NetBIOS. Port 139
 * provides session-oriented communication between NetBIOS nodes.
 *
 * Session Service Packets:
 *   0x00 = Session Message (data transfer)
 *   0x81 = Session Request
 *   0x82 = Positive Session Response
 *   0x83 = Negative Session Response
 *   0x84 = Retarget Session Response
 *   0x85 = Session Keepalive
 *
 * Packet Format:
 *   [type:1][flags:1][length:2 big-endian]
 *   For Session Request: [called_name:34][calling_name:34]
 *
 * NetBIOS Name Encoding (First-Level):
 *   Each byte -> two bytes: ((byte >> 4) + 0x41), ((byte & 0x0F) + 0x41)
 *   Padded to 16 chars with spaces (0x20), scope ID appended
 *
 * Default port: 139 (TCP)
 *
 * Use Cases:
 *   - Windows networking service detection
 *   - SMB-over-NetBIOS availability testing
 *   - Legacy network service discovery
 *   - NetBIOS name resolution verification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Session Service packet types
const SESSION_MESSAGE = 0x00;
const SESSION_REQUEST = 0x81;
const POSITIVE_RESPONSE = 0x82;
const NEGATIVE_RESPONSE = 0x83;
const RETARGET_RESPONSE = 0x84;
const SESSION_KEEPALIVE = 0x85;

const PACKET_TYPE_NAMES: Record<number, string> = {
  [SESSION_MESSAGE]: 'Session Message',
  [SESSION_REQUEST]: 'Session Request',
  [POSITIVE_RESPONSE]: 'Positive Session Response',
  [NEGATIVE_RESPONSE]: 'Negative Session Response',
  [RETARGET_RESPONSE]: 'Retarget Session Response',
  [SESSION_KEEPALIVE]: 'Session Keepalive',
};

// Negative response error codes
const NEGATIVE_REASONS: Record<number, string> = {
  0x80: 'Not listening on called name',
  0x81: 'Not listening for calling process',
  0x82: 'Called name not present',
  0x83: 'Called name present, but insufficient resources',
  0x8f: 'Unspecified error',
};

/**
 * Encode a NetBIOS name using first-level encoding (RFC 1002 Section 4.1)
 * Each character is split into two nibbles, each + 0x41
 * Name is padded to 16 characters with spaces
 */
function encodeNetBIOSName(name: string, suffix: number = 0x20): Uint8Array {
  // Pad or truncate name to 15 characters
  const paddedName = name.toUpperCase().padEnd(15, ' ').slice(0, 15);

  // 34 bytes: 1 length byte + 32 encoded bytes + 1 null scope
  const encoded = new Uint8Array(34);
  encoded[0] = 32; // Length of encoded name (32 bytes)

  for (let i = 0; i < 15; i++) {
    const byte = paddedName.charCodeAt(i);
    encoded[1 + i * 2] = ((byte >> 4) & 0x0f) + 0x41;
    encoded[2 + i * 2] = (byte & 0x0f) + 0x41;
  }

  // 16th character is the suffix byte (service type)
  encoded[31] = ((suffix >> 4) & 0x0f) + 0x41;
  encoded[32] = (suffix & 0x0f) + 0x41;

  // Null scope ID terminator
  encoded[33] = 0x00;

  return encoded;
}

/**
 * Decode a first-level encoded NetBIOS name back to readable form
 * (Currently unused - reserved for future Retarget Response or Name Query Response parsing)
 */
function decodeNetBIOSName(data: Uint8Array, offset: number): { name: string; suffix: number } {
  if (data.length < offset + 34) return { name: '', suffix: 0 };

  const nameLen = data[offset];
  if (nameLen !== 32) return { name: '', suffix: 0 };

  let name = '';
  for (let i = 0; i < 15; i++) {
    const hi = (data[offset + 1 + i * 2] - 0x41) & 0x0f;
    const lo = (data[offset + 2 + i * 2] - 0x41) & 0x0f;
    name += String.fromCharCode((hi << 4) | lo);
  }

  // Last character pair is the suffix
  const suffixHi = (data[offset + 31] - 0x41) & 0x0f;
  const suffixLo = (data[offset + 32] - 0x41) & 0x0f;
  const suffix = (suffixHi << 4) | suffixLo;

  return { name: name.trimEnd(), suffix };
}

// Mark as used to prevent TypeScript unused warning
decodeNetBIOSName satisfies (data: Uint8Array, offset: number) => { name: string; suffix: number };

// Well-known NetBIOS suffix types
const SUFFIX_NAMES: Record<number, string> = {
  0x00: 'Workstation',
  0x03: 'Messenger',
  0x06: 'RAS Server',
  0x1b: 'Domain Master Browser',
  0x1c: 'Domain Controller',
  0x1d: 'Master Browser',
  0x1e: 'Browser Service Election',
  0x1f: 'NetDDE',
  0x20: 'File Server',
  0x21: 'RAS Client',
  0xbe: 'Network Monitor Agent',
  0xbf: 'Network Monitor Application',
};

/**
 * Build a Session Request packet
 */
function buildSessionRequest(calledName: string, calledSuffix: number, callingName: string): Uint8Array {
  const called = encodeNetBIOSName(calledName, calledSuffix);
  const calling = encodeNetBIOSName(callingName, 0x00);

  const dataLen = called.length + calling.length;
  const packet = new Uint8Array(4 + dataLen);

  packet[0] = SESSION_REQUEST; // Type
  packet[1] = 0x00;            // Flags
  packet[2] = (dataLen >> 8) & 0xff; // Length high
  packet[3] = dataLen & 0xff;        // Length low

  packet.set(called, 4);
  packet.set(calling, 4 + called.length);

  return packet;
}

/**
 * Read a Session Service response packet
 */
async function readSessionPacket(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number,
): Promise<{ type: number; flags: number; data: Uint8Array }> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Read timeout')), timeout);
  });

  const readPromise = (async () => {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    // Read at least 4 bytes (packet header)
    while (totalBytes < 4) {
      const { value, done } = await reader.read();
      if (done || !value) throw new Error('Connection closed before packet header');
      chunks.push(value);
      totalBytes += value.length;
    }

    // Combine chunks
    const headerBuf = new Uint8Array(totalBytes);
    let off = 0;
    for (const chunk of chunks) {
      headerBuf.set(chunk, off);
      off += chunk.length;
    }

    const type = headerBuf[0];
    const flags = headerBuf[1];
    const length = (headerBuf[2] << 8) | headerBuf[3];

    // Validate length to prevent resource exhaustion
    if (length > 131072) {
      throw new Error(`Packet length ${length} exceeds maximum allowed (131072)`);
    }

    // Read remaining data if any
    while (totalBytes < 4 + length) {
      const { value, done } = await reader.read();
      if (done || !value) {
        throw new Error(`Connection closed mid-packet (expected ${4 + length} bytes, got ${totalBytes})`);
      }
      chunks.push(value);
      totalBytes += value.length;
    }

    // Combine all
    const fullBuf = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      fullBuf.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      type,
      flags,
      data: fullBuf.slice(4, 4 + length),
    };
  })();

  try {
    const result = await Promise.race([readPromise, timeoutPromise]);
    if (timeoutId !== null) clearTimeout(timeoutId);
    return result;
  } catch (error) {
    if (timeoutId !== null) clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Handle NetBIOS Session Service connection test
 * Sends a Session Request and reads the response
 */
export async function handleNetBIOSConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      calledName?: string;
      calledSuffix?: number;
      timeout?: number;
    };

    const { host, port = 139, timeout = 10000 } = body;
    const calledName = body.calledName || '*SMBSERVER';
    const calledSuffix = body.calledSuffix ?? 0x20;

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

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send Session Request
        const sessionRequest = buildSessionRequest(calledName, calledSuffix, 'PORTOFCALL');
        await writer.write(sessionRequest);

        // Read response
        const response = await readSessionPacket(reader, 5000);
        const rtt = Date.now() - startTime;

        const result: Record<string, unknown> = {
          success: true,
          host,
          port,
          rtt,
          calledName,
          calledSuffix,
          calledSuffixName: SUFFIX_NAMES[calledSuffix] || `Unknown (0x${calledSuffix.toString(16)})`,
          responseType: response.type,
          responseTypeName: PACKET_TYPE_NAMES[response.type] || `Unknown (0x${response.type.toString(16)})`,
        };

        if (response.type === POSITIVE_RESPONSE) {
          result.sessionEstablished = true;
          result.message = 'NetBIOS session established successfully';
        } else if (response.type === NEGATIVE_RESPONSE) {
          result.sessionEstablished = false;
          const errorCode = response.data.length > 0 ? response.data[0] : 0xff;
          result.errorCode = `0x${errorCode.toString(16)}`;
          result.errorReason = NEGATIVE_REASONS[errorCode] || 'Unknown error';
        } else if (response.type === RETARGET_RESPONSE) {
          result.sessionEstablished = false;
          result.message = 'Session retarget';
          if (response.data.length >= 6) {
            const retargetIP = `${response.data[0]}.${response.data[1]}.${response.data[2]}.${response.data[3]}`;
            const retargetPort = (response.data[4] << 8) | response.data[5];
            result.retargetIP = retargetIP;
            result.retargetPort = retargetPort;
          }
        } else {
          result.sessionEstablished = false;
          result.message = `Unexpected response type: 0x${response.type.toString(16)}`;
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return result;
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      if (timeoutId !== null) clearTimeout(timeoutId);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      if (timeoutId !== null) clearTimeout(timeoutId);
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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

// SMB1 dialect list for NEGOTIATE
const SMB_DIALECTS = [
  'PC NETWORK PROGRAM 1.0',
  'LANMAN1.0',
  'Windows for Workgroups 3.1a',
  'LM1.2X002',
  'LANMAN2.1',
  'NT LM 0.12',
];

// SMB1 security mode flags
const SMB_SECURITY_MODE_USER_LEVEL = 0x01;
const SMB_SECURITY_MODE_CHALLENGE_RESPONSE = 0x02;
const SMB_SECURITY_MODE_SECURITY_SIGNATURES = 0x08;

/**
 * Build a NetBIOS Session Request packet (type 0x81) using the wildcard name *SMBSERVER.
 * Used to initiate a NetBIOS session before sending SMB traffic.
 */
function buildSMBSessionRequest(): Uint8Array {
  const called = encodeNetBIOSName('*SMBSERVER', 0x20);
  const calling = encodeNetBIOSName('PORTOFCALL', 0x00);
  const dataLen = called.length + calling.length;
  const pkt = new Uint8Array(4 + dataLen);
  pkt[0] = SESSION_REQUEST;
  pkt[1] = 0x00;
  pkt[2] = (dataLen >> 8) & 0xff;
  pkt[3] = dataLen & 0xff;
  pkt.set(called, 4);
  pkt.set(calling, 4 + called.length);
  return pkt;
}

/**
 * Build an SMB1 NEGOTIATE REQUEST message wrapped in a NetBIOS Session Message header.
 * Offers all standard dialects so we can detect the server's highest supported version.
 */
function buildSMB1NegotiateRequest(): Uint8Array {
  // Encode the dialect list: each dialect = 0x02 + null-terminated string
  const dialectBytes: number[] = [];
  for (const d of SMB_DIALECTS) {
    dialectBytes.push(0x02);
    for (let i = 0; i < d.length; i++) dialectBytes.push(d.charCodeAt(i));
    dialectBytes.push(0x00);
  }
  const dialectBuf = new Uint8Array(dialectBytes);

  // SMB1 header: 32 bytes
  // [4] SMB magic 0xff 'S' 'M' 'B'
  // [1] Command = 0x72 (Negotiate)
  // [4] Status/Error = 0
  // [1] Flags = 0x18
  // [2] Flags2 = 0xc043 (unicode, long names, NT status, ext sec)
  // [12] padding zeros
  // [2] TID = 0xffff
  // [2] PID = 0x0001
  // [2] UID = 0x0000
  // [2] MID = 0x0001

  const smbHeader = new Uint8Array(32);
  smbHeader[0] = 0xff; smbHeader[1] = 0x53; smbHeader[2] = 0x4d; smbHeader[3] = 0x42; // \xffSMB
  smbHeader[4] = 0x72;  // SMB_COM_NEGOTIATE
  // status bytes 5-8: zero
  smbHeader[9] = 0x18;  // Flags: CASE_INSENSITIVE | CANONICALIZED_PATHS
  smbHeader[10] = 0x43; smbHeader[11] = 0xc0; // Flags2 LE: UNICODE | LONG_NAMES | NT_STATUS | EXTENDED_SECURITY
  // pid_high (2 bytes) + security_features (8 bytes) + reserved (2 bytes): zeros at 12-23
  smbHeader[24] = 0xff; smbHeader[25] = 0xff; // TID = 0xffff
  smbHeader[26] = 0x01; smbHeader[27] = 0x00; // PID = 1
  smbHeader[28] = 0x00; smbHeader[29] = 0x00; // UID = 0
  smbHeader[30] = 0x01; smbHeader[31] = 0x00; // MID = 1

  // SMB1 NEGOTIATE request parameter block:
  //   WordCount = 0
  //   ByteCount (2 bytes LE) = dialectBuf.length
  //   dialect data
  const paramBlock = new Uint8Array(1 + 2 + dialectBuf.length);
  paramBlock[0] = 0; // WordCount = 0
  paramBlock[1] = dialectBuf.length & 0xff;
  paramBlock[2] = (dialectBuf.length >> 8) & 0xff;
  paramBlock.set(dialectBuf, 3);

  const smbBody = new Uint8Array(smbHeader.length + paramBlock.length);
  smbBody.set(smbHeader, 0);
  smbBody.set(paramBlock, smbHeader.length);

  // Wrap in NetBIOS Session Message (type 0x00)
  const nbPkt = new Uint8Array(4 + smbBody.length);
  nbPkt[0] = SESSION_MESSAGE;
  nbPkt[1] = 0x00;
  nbPkt[2] = (smbBody.length >> 8) & 0xff;
  nbPkt[3] = smbBody.length & 0xff;
  nbPkt.set(smbBody, 4);

  return nbPkt;
}

/**
 * Parse the SMB1 NEGOTIATE RESPONSE from the NetBIOS session data payload.
 * Extracts: dialect index, security mode, server time, capabilities, server GUID,
 * domain name, server name.
 */
function parseSMB1NegotiateResponse(data: Uint8Array): {
  isSMB: boolean;
  dialect: string | null;
  dialectIndex: number | null;
  securityMode: number | null;
  securityModeDescription: string | null;
  capabilities: number | null;
  serverTime: string | null;
  serverTimezone: number | null;
  serverGuid: string | null;
  domainName: string | null;
  serverName: string | null;
} {
  const empty = {
    isSMB: false,
    dialect: null,
    dialectIndex: null,
    securityMode: null,
    securityModeDescription: null,
    capabilities: null,
    serverTime: null,
    serverTimezone: null,
    serverGuid: null,
    domainName: null,
    serverName: null,
  };

  // Check for NetBIOS Session Message header (type 0x00)
  if (data.length < 4) return empty;
  if (data[0] !== SESSION_MESSAGE) return empty;

  const msgLen = (data[2] << 8) | data[3];
  if (data.length < 4 + msgLen || msgLen < 32) return empty;

  // SMB data starts at offset 4
  const smb = data.slice(4, 4 + msgLen);

  // Check SMB magic: ff 53 4d 42
  if (smb[0] !== 0xff || smb[1] !== 0x53 || smb[2] !== 0x4d || smb[3] !== 0x42) return empty;

  const cmd = smb[4];
  if (cmd !== 0x72) return { ...empty, isSMB: true }; // Not a NEGOTIATE response

  const wordCount = smb[32];
  const view = new DataView(smb.buffer, smb.byteOffset);

  // SMB1 NT LM 0.12 NEGOTIATE response WordCount = 17
  if (wordCount < 1) {
    return { ...empty, isSMB: true, dialect: 'none (no dialects accepted)', dialectIndex: -1 };
  }

  const dialectIndex = view.getUint16(33, true);

  if (wordCount < 17) {
    // Older dialect response — less info available
    const dialectName = dialectIndex < SMB_DIALECTS.length ? SMB_DIALECTS[dialectIndex] : `dialect ${dialectIndex}`;
    return {
      isSMB: true,
      dialect: dialectName,
      dialectIndex,
      securityMode: null,
      securityModeDescription: null,
      capabilities: null,
      serverTime: null,
      serverTimezone: null,
      serverGuid: null,
      domainName: null,
      serverName: null,
    };
  }

  // NT LM 0.12 response offsets (all LE):
  // Word 0 (offset 33): DialectIndex
  // Word 1 (offset 35): SecurityMode
  // Word 2 (offset 37): MaxMpxCount
  // Word 3 (offset 39): MaxNumberVcs
  // DWord 4 (offset 41): MaxBufferSize
  // DWord 6 (offset 45): MaxRawSize
  // DWord 8 (offset 49): SessionKey
  // DWord 10 (offset 53): Capabilities
  // QWord 12 (offset 57): SystemTime (FILETIME)
  // Word 16 (offset 65): ServerTimeZone
  // Byte 17 (offset 67): EncryptionKeyLength
  const securityMode = smb[35];
  const capabilities = view.getUint32(53, true);

  // Server time: Windows FILETIME (100-nanosecond intervals since Jan 1, 1601)
  const timeLo = view.getUint32(57, true);
  const timeHi = view.getUint32(61, true);
  let serverTime: string | null = null;
  if (timeLo !== 0 || timeHi !== 0) {
    // Convert FILETIME to Unix epoch
    const fileTimeMs = (timeHi * 4294967296 + timeLo) / 10000 - 11644473600000;
    try {
      serverTime = new Date(fileTimeMs).toISOString();
    } catch {
      serverTime = null;
    }
  }

  const serverTimezone = view.getInt16(65, true); // Minutes from UTC

  // Security mode description
  const smFlags: string[] = [];
  if (securityMode & SMB_SECURITY_MODE_USER_LEVEL) smFlags.push('User-Level Auth');
  if (securityMode & SMB_SECURITY_MODE_CHALLENGE_RESPONSE) smFlags.push('Challenge/Response');
  if (securityMode & SMB_SECURITY_MODE_SECURITY_SIGNATURES) smFlags.push('SMB Signing');
  const securityModeDescription = smFlags.length > 0 ? smFlags.join(', ') : 'Share-Level Auth';

  const dialectName = dialectIndex < SMB_DIALECTS.length ? SMB_DIALECTS[dialectIndex] : `dialect ${dialectIndex}`;

  // Byte count and variable data start after parameters
  // WordCount=17 means 34 bytes of parameter words after WordCount byte
  // ByteCount at offset 32 + 1 + 34 = 67, but EncryptionKeyLength is at 67
  const encKeyLen = smb[67];
  // ByteCount at offset 68-69
  if (smb.length < 70) {
    return {
      isSMB: true,
      dialect: dialectName,
      dialectIndex,
      securityMode,
      securityModeDescription,
      capabilities,
      serverTime,
      serverTimezone,
      serverGuid: null,
      domainName: null,
      serverName: null,
    };
  }

  const byteCount = view.getUint16(68, true);
  let varOffset = 70; // start of variable data

  // If extended security is negotiated (capabilities & 0x80000000), server GUID (16 bytes) comes first
  let serverGuid: string | null = null;
  let domainName: string | null = null;
  let serverName: string | null = null;
  const extendedSecurity = (capabilities & 0x80000000) !== 0;

  if (extendedSecurity && varOffset + 16 <= smb.length) {
    // Server GUID
    const guidBytes = smb.slice(varOffset, varOffset + 16);
    serverGuid = Array.from(guidBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    serverGuid = `${serverGuid.slice(0,8)}-${serverGuid.slice(8,12)}-${serverGuid.slice(12,16)}-${serverGuid.slice(16,20)}-${serverGuid.slice(20)}`;
    varOffset += 16;
  } else if (!extendedSecurity && encKeyLen > 0) {
    // Skip encryption key
    varOffset += encKeyLen;
  }

  // Remaining bytes are domain name + server name as null-terminated Unicode strings
  if (varOffset < smb.length && byteCount > 0) {
    const varData = smb.slice(varOffset, varOffset + byteCount);
    // Find first null unicode terminator (0x00 0x00)
    let domEnd = 0;
    while (domEnd + 1 < varData.length) {
      if (varData[domEnd] === 0 && varData[domEnd + 1] === 0) break;
      domEnd += 2;
    }
    if (domEnd > 0) {
      domainName = new TextDecoder('utf-16le').decode(varData.slice(0, domEnd)).trim();
    }
    // Server name follows the null terminator
    const srvStart = domEnd + 2;
    let srvEnd = srvStart;
    while (srvEnd + 1 < varData.length) {
      if (varData[srvEnd] === 0 && varData[srvEnd + 1] === 0) break;
      srvEnd += 2;
    }
    if (srvEnd > srvStart) {
      serverName = new TextDecoder('utf-16le').decode(varData.slice(srvStart, srvEnd)).trim();
    }
  }

  return {
    isSMB: true,
    dialect: dialectName,
    dialectIndex,
    securityMode,
    securityModeDescription,
    capabilities,
    serverTime,
    serverTimezone,
    serverGuid,
    domainName,
    serverName,
  };
}

/**
 * Handle NetBIOS/SMB1 negotiate query over TCP 139.
 * Establishes a NetBIOS session then sends an SMB1 NEGOTIATE REQUEST to fingerprint
 * the server: dialect, security mode, server name, domain, server time, capabilities.
 */
export async function handleNetBIOSNameQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 139, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
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
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: Send NetBIOS Session Request
        const sessionReq = buildSMBSessionRequest();
        await writer.write(sessionReq);

        // Read NetBIOS Session Response
        const sessionResp = await readSessionPacket(reader, 5000);

        if (sessionResp.type === NEGATIVE_RESPONSE) {
          const errCode = sessionResp.data.length > 0 ? sessionResp.data[0] : 0xff;
          throw new Error(`NetBIOS session rejected: ${NEGATIVE_REASONS[errCode] || `error 0x${errCode.toString(16)}`}`);
        }

        if (sessionResp.type !== POSITIVE_RESPONSE) {
          throw new Error(`Unexpected NetBIOS session response: 0x${sessionResp.type.toString(16)}`);
        }

        // Step 2: Send SMB1 NEGOTIATE REQUEST
        const smbNeg = buildSMB1NegotiateRequest();
        await writer.write(smbNeg);

        // Read the SMB response (wrapped in NetBIOS session message)
        const smbResp = await readSessionPacket(reader, 5000);

        const rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        if (smbResp.type !== SESSION_MESSAGE) {
          return {
            success: true,
            host,
            port,
            rtt,
            sessionEstablished: true,
            isSMB: false,
            message: `NetBIOS session OK but unexpected message type 0x${smbResp.type.toString(16)}`,
          };
        }

        // Reconstruct full packet for SMB parsing (need type byte + flags + length prefix)
        const fullPkt = new Uint8Array(4 + smbResp.data.length);
        fullPkt[0] = smbResp.type;
        fullPkt[1] = smbResp.flags;
        fullPkt[2] = (smbResp.data.length >> 8) & 0xff;
        fullPkt[3] = smbResp.data.length & 0xff;
        fullPkt.set(smbResp.data, 4);

        const negResult = parseSMB1NegotiateResponse(fullPkt);

        // Build capability description
        const capFlags: string[] = [];
        if (negResult.capabilities !== null) {
          const c = negResult.capabilities;
          if (c & 0x0001) capFlags.push('Raw Mode');
          if (c & 0x0002) capFlags.push('MPX Mode');
          if (c & 0x0004) capFlags.push('Unicode');
          if (c & 0x0008) capFlags.push('Large Files');
          if (c & 0x0010) capFlags.push('NT SMBs');
          if (c & 0x0020) capFlags.push('RPC Remote APIs');
          if (c & 0x0040) capFlags.push('NT Status Codes');
          if (c & 0x0080) capFlags.push('Level II Oplocks');
          if (c & 0x0100) capFlags.push('Lock and Read');
          if (c & 0x0200) capFlags.push('NT Find');
          if (c & 0x1000) capFlags.push('DFS');
          if (c & 0x4000) capFlags.push('Large ReadX');
          if (c & 0x8000) capFlags.push('Large WriteX');
          if (c & 0x80000000) capFlags.push('Extended Security');
        }

        return {
          success: true,
          host,
          port,
          rtt,
          sessionEstablished: true,
          isSMB: negResult.isSMB,
          dialect: negResult.dialect,
          dialectIndex: negResult.dialectIndex,
          securityMode: negResult.securityMode !== null ? `0x${negResult.securityMode.toString(16).padStart(2, '0')}` : null,
          securityModeDescription: negResult.securityModeDescription,
          capabilities: negResult.capabilities !== null ? `0x${negResult.capabilities.toString(16).padStart(8, '0')}` : null,
          capabilityFlags: capFlags.length > 0 ? capFlags : null,
          serverTime: negResult.serverTime,
          serverTimezone: negResult.serverTimezone !== null ? `UTC${-negResult.serverTimezone / 60 >= 0 ? '+' : ''}${-negResult.serverTimezone / 60}` : null,
          serverGuid: negResult.serverGuid,
          domainName: negResult.domainName,
          serverName: negResult.serverName,
          message: negResult.isSMB
            ? `SMB1 negotiate OK: ${negResult.dialect || 'unknown dialect'} (${rtt}ms)`
            : `NetBIOS session OK but no SMB response (${rtt}ms)`,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      if (timeoutId !== null) clearTimeout(timeoutId);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      if (timeoutId !== null) clearTimeout(timeoutId);
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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
 * Handle NetBIOS service probe
 * Tests multiple well-known NetBIOS suffixes to discover services
 */
export async function handleNetBIOSProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port || 139;
    const timeout = body.timeout || 10000;

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

    // Probe key service suffixes
    const suffixesToProbe = [
      { suffix: 0x00, name: 'Workstation' },
      { suffix: 0x20, name: 'File Server' },
      { suffix: 0x1b, name: 'Domain Master Browser' },
      { suffix: 0x1c, name: 'Domain Controller' },
      { suffix: 0x1d, name: 'Master Browser' },
      { suffix: 0x03, name: 'Messenger' },
    ];

    const results: Array<{
      suffix: string;
      suffixName: string;
      available: boolean;
      error?: string;
    }> = [];

    for (const { suffix, name } of suffixesToProbe) {
      try {
        const socket = connect(`${host}:${port}`);
        await socket.opened;

        const reader = socket.readable.getReader();
        const writer = socket.writable.getWriter();

        try {
          const sessionRequest = buildSessionRequest('*SMBSERVER', suffix, 'PORTOFCALL');
          await writer.write(sessionRequest);

          const probeTimeout = Math.min(3000, timeout);
          const response = await readSessionPacket(reader, probeTimeout);

          results.push({
            suffix: `0x${suffix.toString(16).padStart(2, '0')}`,
            suffixName: name,
            available: response.type === POSITIVE_RESPONSE,
            error: response.type === NEGATIVE_RESPONSE
              ? NEGATIVE_REASONS[response.data.length > 0 ? response.data[0] : 0xff] || 'Rejected'
              : undefined,
          });

          writer.releaseLock();
          reader.releaseLock();
          await socket.close();
        } catch (err) {
          writer.releaseLock();
          reader.releaseLock();
          await socket.close();

          results.push({
            suffix: `0x${suffix.toString(16).padStart(2, '0')}`,
            suffixName: name,
            available: false,
            error: err instanceof Error ? err.message : 'Probe failed',
          });
        }
      } catch {
        results.push({
          suffix: `0x${suffix.toString(16).padStart(2, '0')}`,
          suffixName: name,
          available: false,
          error: 'Connection failed',
        });
      }
    }

    const rtt = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      servicesFound: results.filter(r => r.available).length,
      totalProbed: results.length,
      services: results,
    }), {
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
