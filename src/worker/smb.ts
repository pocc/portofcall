/**
 * SMB2 Protocol Implementation
 *
 * Implements SMB2 Negotiate Protocol Request/Response for server probing.
 * The negotiate exchange reveals the server's supported dialects, GUID,
 * security mode, capabilities, and system time — all without authentication.
 *
 * Protocol reference: [MS-SMB2] https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-smb2/
 *
 * Wire format notes:
 *   - NetBIOS session header: 4 bytes (type=0x00, length=3 bytes big-endian)
 *   - SMB2 header:            64 bytes, little-endian integers
 *   - Negotiate body:         StructureSize(2) + DialectCount(2) + ...
 *
 * Supported dialects:
 *   0x0202 — SMB 2.0.2 (Windows Vista / Server 2008)
 *   0x0210 — SMB 2.1   (Windows 7 / Server 2008 R2)
 *   0x0300 — SMB 3.0   (Windows 8 / Server 2012)
 *   0x0302 — SMB 3.0.2 (Windows 8.1 / Server 2012 R2)
 *   0x0311 — SMB 3.1.1 (Windows 10 / Server 2016+)
 *
 * Endpoints:
 *   POST /api/smb/connect    — basic connect + negotiate (original)
 *   POST /api/smb/negotiate  — full negotiate with GUID, security mode,
 *                              capabilities and system time
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SMBConnectionOptions {
  host: string;
  port?: number;
  timeout?: number;
}

// ─── Dialect tables ───────────────────────────────────────────────────────────

const DIALECT_NAMES: Record<number, string> = {
  0x0202: 'SMB 2.0.2',
  0x0210: 'SMB 2.1',
  0x0300: 'SMB 3.0',
  0x0302: 'SMB 3.0.2',
  0x0311: 'SMB 3.1.1',
};

const SMB2_CAPABILITIES: Array<[number, string]> = [
  [0x0001, 'DFS'],
  [0x0002, 'Leasing'],
  [0x0004, 'LargeMTU'],
  [0x0008, 'MultiChannel'],
  [0x0010, 'PersistentHandles'],
  [0x0020, 'DirectoryLeasing'],
  [0x0040, 'Encryption'],
];

function decodeCapabilities(caps: number): string[] {
  return SMB2_CAPABILITIES.filter(([bit]) => (caps & bit) !== 0).map(([, name]) => name);
}

// ─── SMB2 frame builders ──────────────────────────────────────────────────────

/**
 * Build a complete SMB2 Negotiate Request wrapped in a NetBIOS session header.
 * Offers all five known SMB2/3 dialects.
 */
function buildSMB2NegotiateRequest(): Uint8Array {
  // ── SMB2 header (64 bytes, little-endian) ────────────────────────────────
  const smbHeader = new Uint8Array(64);
  const hv = new DataView(smbHeader.buffer);
  // Protocol ID: \xFESMB
  smbHeader[0] = 0xFE; smbHeader[1] = 0x53; smbHeader[2] = 0x4D; smbHeader[3] = 0x42;
  hv.setUint16(4,  64,    true); // StructureSize
  hv.setUint16(6,  0,     true); // CreditCharge
  hv.setUint32(8,  0,     true); // Status / ChannelSequence
  hv.setUint16(12, 0,     true); // Command: NEGOTIATE = 0
  hv.setUint16(14, 31,    true); // CreditRequest
  hv.setUint32(16, 0,     true); // Flags
  hv.setUint32(20, 0,     true); // NextCommand
  // MessageId (8 bytes at offset 24): 0
  // Reserved  (4 bytes at offset 32): 0
  // TreeId    (4 bytes at offset 36): 0
  // SessionId (8 bytes at offset 40): 0
  // Signature (16 bytes at offset 48): 0

  // ── Negotiate body ────────────────────────────────────────────────────────
  // Dialects: 2.0.2, 2.1, 3.0, 3.0.2, 3.1.1
  const dialects = [0x0202, 0x0210, 0x0300, 0x0302, 0x0311];
  const dialectCount = dialects.length;
  // StructureSize=36, DialectCount, SecurityMode=1(signing-enabled),
  // Reserved, Capabilities, ClientGuid(16), ClientStartTime/NegotiateContextOffset(8),
  // NegotiateContextCount(2), Reserved2(2), then dialects
  const bodySize = 36 + dialectCount * 2;
  const body = new Uint8Array(bodySize);
  const bv = new DataView(body.buffer);
  bv.setUint16(0,  36,          true); // StructureSize
  bv.setUint16(2,  dialectCount, true); // DialectCount
  bv.setUint16(4,  0x0001,      true); // SecurityMode: signing enabled
  bv.setUint16(6,  0,           true); // Reserved
  bv.setUint32(8,  0x7F,        true); // Capabilities (all bits)
  // ClientGuid (16 bytes at offset 12): random-ish
  for (let i = 0; i < 16; i++) body[12 + i] = (i * 17 + 0xAB) & 0xFF;
  // ClientStartTime/NegotiateContextOffset at offset 28 (8 bytes): 0
  // NegotiateContextCount at offset 36: not used for 3.0.2 and below

  for (let i = 0; i < dialectCount; i++) {
    bv.setUint16(36 + i * 2, dialects[i], true);
  }

  // ── Combine into full packet with NetBIOS session header ─────────────────
  const message = new Uint8Array(smbHeader.length + body.length);
  message.set(smbHeader, 0);
  message.set(body, smbHeader.length);

  const length = message.length;
  const netbios = new Uint8Array(4);
  netbios[0] = 0x00;
  netbios[1] = (length >> 16) & 0xFF;
  netbios[2] = (length >> 8)  & 0xFF;
  netbios[3] =  length        & 0xFF;

  const packet = new Uint8Array(4 + message.length);
  packet.set(netbios, 0);
  packet.set(message, 4);
  return packet;
}

// ─── SMB1 negotiate (for fallback banner grab) ────────────────────────────────

/**
 * Build a minimal SMB1 (CIFS) Negotiate Request.
 * Used only as a fallback banner grab when the server doesn't speak SMB2.
 */
function buildSMB1NegotiateRequest(): Uint8Array {
  const dialect = new TextEncoder().encode('\x02NT LM 0.12\x00');
  // Dialect block: word(count=1) + dialect string
  const dialectBlock = new Uint8Array(3 + dialect.length);
  dialectBlock[0] = 0x02; // BufferFormat: dialect
  // Copy dialect string
  dialectBlock.set(dialect, 1);

  const bodyLen = 3 + dialectBlock.length; // WordCount(1) + ByteCount(2) + dialects
  const body = new Uint8Array(bodyLen);
  body[0] = 0; // WordCount = 0
  body[1] = dialectBlock.length & 0xFF;
  body[2] = (dialectBlock.length >> 8) & 0xFF;
  body.set(dialectBlock, 3);

  // SMB1 header: 32 bytes
  const header = new Uint8Array(32);
  // Protocol: \xFF SMB
  header[0] = 0xFF; header[1] = 0x53; header[2] = 0x4D; header[3] = 0x42;
  header[4] = 0x72; // Command: NEGOTIATE
  // Status, Flags, Flags2, etc — all zero

  const message = new Uint8Array(header.length + body.length);
  message.set(header, 0);
  message.set(body, header.length);

  const length = message.length;
  const netbios = new Uint8Array(4);
  netbios[0] = 0x00;
  netbios[1] = (length >> 16) & 0xFF;
  netbios[2] = (length >> 8)  & 0xFF;
  netbios[3] =  length        & 0xFF;

  const packet = new Uint8Array(4 + message.length);
  packet.set(netbios, 0);
  packet.set(message, 4);
  return packet;
}

// ─── Response parsers ─────────────────────────────────────────────────────────

interface SMB2NegotiateResult {
  success: boolean;
  dialect?: string;
  dialectCode?: number;
  message: string;
}

function parseSMB2NegotiateBasic(data: Uint8Array): SMB2NegotiateResult {
  if (data.length < 68) {
    return { success: false, message: 'Response too short for SMB2 negotiate' };
  }

  const offset = 4; // skip NetBIOS header
  if (data[offset] !== 0xFE || data[offset + 1] !== 0x53 ||
      data[offset + 2] !== 0x4D || data[offset + 3] !== 0x42) {
    return { success: false, message: 'Invalid SMB2 protocol signature' };
  }

  const hv = new DataView(data.buffer, data.byteOffset + offset);
  const status = hv.getUint32(8, true);
  if (status !== 0) {
    return { success: false, message: `SMB error status: 0x${status.toString(16).padStart(8, '0')}` };
  }

  const command = hv.getUint16(12, true);
  if (command !== 0) {
    return { success: false, message: `Unexpected SMB2 command: ${command}` };
  }

  // Negotiate response body starts at offset 4+64 = 68
  const bodyOffset = 68;
  if (data.length < bodyOffset + 6) {
    return { success: false, message: 'SMB2 negotiate response body too short' };
  }

  const bv = new DataView(data.buffer, data.byteOffset + bodyOffset);
  const dialectCode = bv.getUint16(4, true); // DialectRevision at body+4
  const dialectName = DIALECT_NAMES[dialectCode] ?? `Unknown (0x${dialectCode.toString(16)})`;

  return {
    success: true,
    dialect: dialectName,
    dialectCode,
    message: `SMB2 negotiate successful — dialect: ${dialectName}`,
  };
}

// ─── Shared socket read helper ────────────────────────────────────────────────

async function readResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  minBytes: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;

  while (total < minBytes && Date.now() < deadline) {
    const remaining = Math.max(deadline - Date.now(), 0);
    const timer = new Promise<{ value: undefined; done: true }>((resolve) =>
      setTimeout(() => resolve({ value: undefined, done: true }), remaining),
    );
    const { value, done } = await Promise.race([reader.read(), timer]);
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
    if (total >= 65536) break;
  }

  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ─── POST /api/smb/connect (original, preserved) ─────────────────────────────

/**
 * Basic SMB2 negotiate — confirms the server speaks SMB2 and returns the
 * negotiated dialect.
 */
export async function handleSMBConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<SMBConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<SMBConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '445'),
        timeout: parseInt(url.searchParams.get('timeout') || '30000'),
      };
    }

    if (!options.host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port ?? 445;
    const timeoutMs = options.timeout ?? 30000;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        await writer.write(buildSMB2NegotiateRequest());
        const data = await readResponse(reader, 68, 5000);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        if (!data || data.length < 68) throw new Error('Invalid SMB response');

        const result = parseSMB2NegotiateBasic(data);
        return {
          success: result.success,
          message: result.success ? 'SMB connection successful' : 'SMB connection failed',
          host,
          port,
          dialect: result.dialect,
          serverResponse: result.message,
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── POST /api/smb/negotiate ──────────────────────────────────────────────────

/**
 * Full SMB2 Negotiate exchange returning rich server metadata:
 *   - Negotiated dialect + dialect name
 *   - Server GUID (128-bit, formatted as hex string)
 *   - Security mode flags (signing required/enabled)
 *   - Server capabilities decoded to named strings
 *   - Server system time (Windows FILETIME → ISO-8601)
 *
 * Also attempts an SMB1 fallback if the server does not respond to SMB2.
 *
 * Request body: { host, port=445, timeout=10000 }
 * Return: { success, dialect, dialectName, serverGuid, securityMode,
 *            capabilities, systemTime, latencyMs }
 */
export async function handleSMBNegotiate(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = 445, timeout = 10000 } = body;

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
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();

    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        await writer.write(buildSMB2NegotiateRequest());
        const data = await readResponse(reader, 68, 6000);

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const latencyMs = Date.now() - startTime;

        if (data.length < 4) {
          return { success: false, latencyMs, error: 'No response from server' };
        }

        // ── Check for SMB2 signature ──────────────────────────────────────
        const smb2Start = 4; // skip NetBIOS
        if (data.length >= smb2Start + 4 &&
            data[smb2Start] === 0xFE && data[smb2Start + 1] === 0x53 &&
            data[smb2Start + 2] === 0x4D && data[smb2Start + 3] === 0x42) {

          if (data.length < smb2Start + 64) {
            return { success: false, latencyMs, error: 'SMB2 header truncated' };
          }

          const hv = new DataView(data.buffer, data.byteOffset + smb2Start);
          const status = hv.getUint32(8, true);
          if (status !== 0) {
            return {
              success: false,
              latencyMs,
              error: `SMB2 error: 0x${status.toString(16).padStart(8, '0')}`,
            };
          }

          // Negotiate response body at offset smb2Start + 64
          const bodyOff = smb2Start + 64;
          if (data.length < bodyOff + 66) {
            // Body too short to read all fields — return what we have
            const basic = parseSMB2NegotiateBasic(data);
            return {
              success: basic.success,
              latencyMs,
              dialect: basic.dialect ?? '',
              dialectCode: basic.dialectCode ?? 0,
              dialectName: basic.dialect ?? '',
              serverGuid: '',
              securityMode: 0,
              securityModeFlags: [] as string[],
              capabilities: [] as string[],
              systemTime: null,
              error: basic.success ? undefined : basic.message,
            };
          }

          const bv = new DataView(data.buffer, data.byteOffset + bodyOff);
          // body offsets per [MS-SMB2] 2.2.4 (Negotiate Response):
          //   +0  StructureSize (2)
          //   +2  SecurityMode (2)
          //   +4  DialectRevision (2)
          //   +6  NegotiateContextCount/Reserved (2)
          //   +8  ServerGuid (16)
          //   +24 Capabilities (4)
          //   +28 MaxTransactSize (4)
          //   +32 MaxReadSize (4)
          //   +36 MaxWriteSize (4)
          //   +40 SystemTime (8) — Windows FILETIME
          //   +48 ServerStartTime (8)
          //   +56 SecurityBufferOffset (2)
          //   +58 SecurityBufferLength (2)
          //   +60 NegotiateContextOffset/Reserved2 (4)
          //   +64 SecurityBuffer (variable)

          const securityMode = bv.getUint16(2, true);
          const dialectCode  = bv.getUint16(4, true);

          // Server GUID: 16 bytes at body+8
          const guidBytes = new Uint8Array(data.buffer, data.byteOffset + bodyOff + 8, 16);
          const guidHex = Array.from(guidBytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
          // Format as standard GUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
          const serverGuid = [
            guidHex.slice(0, 8),
            guidHex.slice(8, 12),
            guidHex.slice(12, 16),
            guidHex.slice(16, 20),
            guidHex.slice(20),
          ].join('-');

          const capabilities = bv.getUint32(24, true);

          // Windows FILETIME: 100-ns intervals since 1601-01-01
          // JS Date uses ms since 1970-01-01
          // Difference: 11644473600 seconds
          const ftLow  = bv.getUint32(40, true);
          const ftHigh = bv.getUint32(44, true);
          const ftMs = (ftHigh * 0x100000000 + ftLow) / 10000;
          const systemTimeMs = ftMs - 11644473600000;
          const systemTime = (systemTimeMs > 0 && systemTimeMs < 2e12)
            ? new Date(systemTimeMs).toISOString()
            : null;

          const securityModeFlags: string[] = [];
          if (securityMode & 0x01) securityModeFlags.push('SigningEnabled');
          if (securityMode & 0x02) securityModeFlags.push('SigningRequired');

          return {
            success: true,
            latencyMs,
            dialect: DIALECT_NAMES[dialectCode] ?? `Unknown (0x${dialectCode.toString(16)})`,
            dialectCode,
            dialectName: DIALECT_NAMES[dialectCode] ?? `Unknown (0x${dialectCode.toString(16)})`,
            serverGuid,
            securityMode,
            securityModeFlags,
            capabilities: decodeCapabilities(capabilities),
            capabilitiesRaw: capabilities,
            systemTime,
          };
        }

        // ── Check for SMB1 signature (fallback) ───────────────────────────
        if (data.length >= smb2Start + 4 &&
            data[smb2Start] === 0xFF && data[smb2Start + 1] === 0x53 &&
            data[smb2Start + 2] === 0x4D && data[smb2Start + 3] === 0x42) {
          return {
            success: true,
            latencyMs,
            dialect: 'SMB 1.x (CIFS)',
            dialectCode: 0x0001,
            dialectName: 'SMB 1.x (CIFS)',
            serverGuid: '',
            securityMode: 0,
            securityModeFlags: [] as string[],
            capabilities: [] as string[],
            systemTime: null,
            note: 'Server responded with SMB1 — limited information available',
          };
        }

        return {
          success: false,
          latencyMs,
          error: 'Response is not an SMB2 or SMB1 packet',
          rawHex: Array.from(data.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '),
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
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
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── Backward-compat alias ────────────────────────────────────────────────────

// Keep the SMB1 builder available for tests or other callers that may import it
export { buildSMB1NegotiateRequest };

// ─── SMB2 auth + tree connect constants ───────────────────────────────────────

const SMB2_CMD_SESSION_SETUP      = 0x0001;
const SMB2_CMD_TREE_CONNECT       = 0x0003;
const SMB2_CMD_CREATE             = 0x0005;
const SMB2_CMD_CLOSE              = 0x0006;
const SMB2_CMD_QUERY_INFO         = 0x0010;
const SMB2_STATUS_SUCCESS         = 0x00000000;
const SMB2_STATUS_MORE_PROCESSING = 0xC0000016; // STATUS_MORE_PROCESSING_REQUIRED

const SHARE_TYPES: Record<number, string> = { 0x01: 'DISK', 0x02: 'PIPE', 0x03: 'PRINT' };

// ─── Low-level helpers ────────────────────────────────────────────────────────

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function wrapNetBIOS(payload: Uint8Array): Uint8Array {
  const pkt = new Uint8Array(4 + payload.length);
  pkt[1] = (payload.length >> 16) & 0xFF;
  pkt[2] = (payload.length >>  8) & 0xFF;
  pkt[3] =  payload.length        & 0xFF;
  pkt.set(payload, 4);
  return pkt;
}

/** Build a 64-byte SMB2 header with the given fields. */
function buildSMB2Header(
  command: number,
  messageId: number,
  treeId: number,
  sessionId: string,
): Uint8Array {
  const h = new Uint8Array(64);
  const v = new DataView(h.buffer);
  h[0] = 0xFE; h[1] = 0x53; h[2] = 0x4D; h[3] = 0x42; // \xFESMB
  v.setUint16(4,  64,        true); // StructureSize
  v.setUint32(8,  0,         true); // Status
  v.setUint16(12, command,   true); // Command
  v.setUint16(14, 31,        true); // CreditRequest
  v.setUint32(24, messageId, true); // MessageId (lo)
  v.setUint32(36, treeId,    true); // TreeId
  // SessionId is 8 bytes (64-bit) at offset 40 [MS-SMB2 §2.2.1]
  const sid = BigInt(sessionId);
  v.setUint32(40, Number(sid & 0xFFFFFFFFn), true); // SessionId lo
  v.setUint32(44, Number(sid >> 32n),        true); // SessionId hi
  return h;
}

/** Parse SMB2 header fields from a raw TCP buffer (after NetBIOS 4-byte prefix). */
function parseSMB2ResponseHeader(data: Uint8Array): {
  valid: boolean; status: number; command: number; treeId: number; sessionId: string;
} {
  const offset = 4; // skip NetBIOS header
  if (data.length < offset + 64) return { valid: false, status: 0, command: 0, treeId: 0, sessionId: '0' };
  if (data[offset] !== 0xFE || data[offset+1] !== 0x53 ||
      data[offset+2] !== 0x4D || data[offset+3] !== 0x42) {
    return { valid: false, status: 0, command: 0, treeId: 0, sessionId: '0' };
  }
  const v = new DataView(data.buffer, data.byteOffset + offset);
  // SessionId is 8 bytes (64-bit) at offset 40 [MS-SMB2 §2.2.1]
  const lo = BigInt(v.getUint32(40, true));
  const hi = BigInt(v.getUint32(44, true));
  const sessionId64 = (hi << 32n) | lo;
  return {
    valid:     true,
    status:    v.getUint32(8,  true),
    command:   v.getUint16(12, true),
    treeId:    v.getUint32(36, true),
    sessionId: '0x' + sessionId64.toString(16),
  };
}

// ─── DER / ASN.1 / SPNEGO helpers ────────────────────────────────────────────

/** Encode a DER TLV (tag + length + value). Handles lengths up to 65535. */
function derTLV(tag: number, content: Uint8Array): Uint8Array {
  const len = content.length;
  let lenBytes: number[];
  if      (len < 128) lenBytes = [len];
  else if (len < 256) lenBytes = [0x81, len];
  else                lenBytes = [0x82, (len >> 8) & 0xFF, len & 0xFF];
  const out = new Uint8Array(1 + lenBytes.length + len);
  out[0] = tag;
  lenBytes.forEach((b, i) => { out[1 + i] = b; });
  out.set(content, 1 + lenBytes.length);
  return out;
}

/**
 * Wrap an NTLMSSP blob in a SPNEGO negTokenInit APPLICATION[0] wrapper.
 * This is the GSS-API framing required by SMB2 SESSION_SETUP round 1.
 *
 * Structure:
 *   APPLICATION[0] { SPNEGO_OID, [0] negTokenInit {
 *     [0] mechTypes { NTLMSSP_OID },
 *     [2] mechToken { ntlmBlob }
 *   } }
 */
function buildSPNEGONegTokenInit(ntlmBlob: Uint8Array): Uint8Array {
  const spnegoOID = new Uint8Array([0x06,0x06,0x2b,0x06,0x01,0x05,0x05,0x02]);
  const ntlmOID   = new Uint8Array([0x06,0x0a,0x2b,0x06,0x01,0x04,0x01,0x82,0x37,0x02,0x02,0x0a]);
  const mechTypes    = derTLV(0xa0, derTLV(0x30, ntlmOID));
  const mechToken    = derTLV(0xa2, derTLV(0x04, ntlmBlob));
  const negTokenInit = derTLV(0x30, concatBytes(mechTypes, mechToken));
  const tagged       = derTLV(0xa0, negTokenInit);
  return derTLV(0x60, concatBytes(spnegoOID, tagged));
}

/**
 * Wrap an NTLMSSP AUTHENTICATE blob in a SPNEGO negTokenResp [1] wrapper.
 * Used for SESSION_SETUP round 2.
 */
function buildSPNEGONegTokenResp(ntlmBlob: Uint8Array): Uint8Array {
  return derTLV(0xa1, derTLV(0x30, derTLV(0xa2, derTLV(0x04, ntlmBlob))));
}

// ─── NTLM message builders ────────────────────────────────────────────────────

const NTLM_FLAGS = 0x60088215; // Unicode, OEM, NTLM, AlwaysSign, 56-bit, 128-bit

/** Build NTLMSSP NEGOTIATE (type 1) — advertises capabilities to the server. */
function buildNTLMNegotiate(): Uint8Array {
  const m = new Uint8Array(32);
  const v = new DataView(m.buffer);
  [0x4e,0x54,0x4c,0x4d,0x53,0x53,0x50,0x00].forEach((b, i) => { m[i] = b; });
  v.setUint32(8,  1,          true); // MessageType = NEGOTIATE
  v.setUint32(12, NTLM_FLAGS, true); // NegotiateFlags
  v.setUint32(20, 32,         true); // DomainNameOffset (past fixed block)
  v.setUint32(28, 32,         true); // WorkstationOffset (past fixed block)
  return m;
}

/**
 * Build anonymous NTLMSSP AUTHENTICATE (type 3) — all credential fields empty.
 * Servers with null-session enabled will grant a restricted anonymous token.
 */
function buildNTLMAuthenticateAnonymous(): Uint8Array {
  const m = new Uint8Array(72);
  const v = new DataView(m.buffer);
  [0x4e,0x54,0x4c,0x4d,0x53,0x53,0x50,0x00].forEach((b, i) => { m[i] = b; });
  v.setUint32(8, 3, true); // MessageType = AUTHENTICATE
  // Each SecurityBuffer field: len(2) + maxLen(2) + offset(4) — all empty, offset = 72
  for (const off of [12, 20, 28, 36, 44, 52]) v.setUint32(off + 4, 72, true);
  v.setUint32(60, NTLM_FLAGS, true); // NegotiateFlags
  return m;
}

// ─── SMB2 packet builders ─────────────────────────────────────────────────────

/**
 * Build a complete NetBIOS-framed SMB2 SESSION_SETUP request.
 *
 * [MS-SMB2] 2.2.5 — body layout:
 *   +0  StructureSize (2) = 25
 *   +2  Flags (1)
 *   +3  SecurityMode (1)
 *   +4  Capabilities (4)
 *   +8  Channel (4)
 *   +12 SecurityBufferOffset (2)  — from start of SMB2 header
 *   +14 SecurityBufferLength (2)
 *   +16 PreviousSessionId (8)
 *   +24 SecurityBuffer (variable)
 */
function buildSessionSetupPacket(
  secBlob: Uint8Array,
  messageId: number,
  sessionId = '0',
): Uint8Array {
  const header = buildSMB2Header(SMB2_CMD_SESSION_SETUP, messageId, 0, sessionId);
  const body = new Uint8Array(24);
  const bv = new DataView(body.buffer);
  bv.setUint16(0,  25,              true); // StructureSize
  body[3] = 0x01;                          // SecurityMode: signing enabled
  bv.setUint32(4,  0x7F,            true); // Capabilities
  bv.setUint16(12, 64 + 24,         true); // SecurityBufferOffset (header + fixed body)
  bv.setUint16(14, secBlob.length,  true); // SecurityBufferLength
  return wrapNetBIOS(concatBytes(header, body, secBlob));
}

/**
 * Build a complete NetBIOS-framed SMB2 TREE_CONNECT request.
 *
 * [MS-SMB2] 2.2.9 — body layout:
 *   +0 StructureSize (2) = 9
 *   +2 Reserved (2)
 *   +4 PathOffset (2)   — from start of SMB2 header
 *   +6 PathLength (2)
 *   +8 Path (variable, UTF-16LE UNC path)
 */
function buildTreeConnectPacket(
  uncPath: string,
  messageId: number,
  sessionId: string,
): Uint8Array {
  const header = buildSMB2Header(SMB2_CMD_TREE_CONNECT, messageId, 0, sessionId);
  const pathBytes = new Uint8Array(uncPath.length * 2);
  const pv = new DataView(pathBytes.buffer);
  for (let i = 0; i < uncPath.length; i++) pv.setUint16(i * 2, uncPath.charCodeAt(i), true);
  const body = new Uint8Array(8);
  const bv = new DataView(body.buffer);
  bv.setUint16(0, 9,               true); // StructureSize
  bv.setUint16(4, 64 + 8,          true); // PathOffset (header + fixed body)
  bv.setUint16(6, pathBytes.length, true); // PathLength
  return wrapNetBIOS(concatBytes(header, body, pathBytes));
}

// ─── POST /api/smb/session ────────────────────────────────────────────────────

/**
 * Perform a full SMB2 anonymous null-session authentication exchange:
 *   NEGOTIATE → SESSION_SETUP (NTLMSSP_NEGOTIATE) → SESSION_SETUP (NTLMSSP_AUTHENTICATE, anonymous)
 *
 * This probes whether the server accepts null/anonymous sessions, which is
 * a common security baseline check for SMB servers.
 *
 * Request body: { host, port=445, timeout=10000 }
 * Response: { success, sessionId, sessionFlags, guest, anonymous, latencyMs }
 *   sessionFlags: 0x0001 = guest, 0x0002 = null session, 0x0004 = encrypted
 */
export async function handleSMBSession(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = 445, timeout = 10000 } = body;
    if (!host) return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, isCloudflare: true,
        error: getCloudflareErrorMessage(host, cfCheck.ip) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        // Round 0: SMB2 NEGOTIATE
        await writer.write(buildSMB2NegotiateRequest());
        const negResp = await readResponse(reader, 68, 5000);
        const negHdr = parseSMB2ResponseHeader(negResp);
        if (!negHdr.valid || negHdr.status !== SMB2_STATUS_SUCCESS) {
          throw new Error(`Negotiate failed: 0x${(negHdr.status >>> 0).toString(16).padStart(8, '0')}`);
        }

        // Round 1: SESSION_SETUP with SPNEGO-wrapped NTLMSSP_NEGOTIATE
        const blob1 = buildSPNEGONegTokenInit(buildNTLMNegotiate());
        await writer.write(buildSessionSetupPacket(blob1, 1));
        const ss1 = await readResponse(reader, 68, 5000);
        const ss1Hdr = parseSMB2ResponseHeader(ss1);
        if (!ss1Hdr.valid) throw new Error('SESSION_SETUP round 1: invalid response');

        const sessionId = ss1Hdr.sessionId;

        if (ss1Hdr.status === SMB2_STATUS_SUCCESS) {
          // Server granted session in one round (unusual but valid)
          writer.releaseLock(); reader.releaseLock(); socket.close();
          return { success: true, latencyMs: Date.now() - startTime, sessionId, anonymous: true, rounds: 1 };
        }
        if (ss1Hdr.status !== SMB2_STATUS_MORE_PROCESSING) {
          throw new Error(`SESSION_SETUP round 1 rejected: 0x${(ss1Hdr.status >>> 0).toString(16).padStart(8, '0')}`);
        }

        // Round 2: SESSION_SETUP with anonymous NTLMSSP_AUTHENTICATE
        const blob2 = buildSPNEGONegTokenResp(buildNTLMAuthenticateAnonymous());
        await writer.write(buildSessionSetupPacket(blob2, 2, sessionId));
        const ss2 = await readResponse(reader, 68, 5000);
        const ss2Hdr = parseSMB2ResponseHeader(ss2);

        writer.releaseLock(); reader.releaseLock(); socket.close();

        if (!ss2Hdr.valid) throw new Error('SESSION_SETUP round 2: invalid response');
        if (ss2Hdr.status !== SMB2_STATUS_SUCCESS) {
          return {
            success: false,
            latencyMs: Date.now() - startTime,
            error: `Anonymous session rejected: 0x${(ss2Hdr.status >>> 0).toString(16).padStart(8, '0')}`,
            sessionId: '0x0',
          };
        }

        // Parse SESSION_SETUP response body for SessionFlags [MS-SMB2] 2.2.6
        const bodyOff = 4 + 64; // NetBIOS + SMB2 header
        let sessionFlags = 0;
        if (ss2.length >= bodyOff + 4) {
          sessionFlags = new DataView(ss2.buffer, ss2.byteOffset + bodyOff).getUint16(2, true);
        }

        return {
          success: true,
          latencyMs: Date.now() - startTime,
          sessionId,
          sessionFlags,
          anonymous: true,
          guest:     (sessionFlags & 0x0001) !== 0,
          encrypted: (sessionFlags & 0x0004) !== 0,
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
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
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── POST /api/smb/tree ───────────────────────────────────────────────────────

/**
 * Perform full SMB2 TREE_CONNECT to a named share after anonymous session setup:
 *   NEGOTIATE → SESSION_SETUP × 2 → TREE_CONNECT
 *
 * Returns the share type (DISK / PIPE / PRINT), share flags, server capabilities,
 * and maximal access mask for the tree — all without requiring credentials.
 *
 * Request body: { host, port=445, share='IPC$', timeout=10000 }
 * Response: { success, sessionId, treeId, share, shareType, shareFlags, maximalAccess, latencyMs }
 */
export async function handleSMBTreeConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const body = await request.json() as { host: string; port?: number; share?: string; timeout?: number };
    const { host, port = 445, timeout = 10000 } = body;
    const share = body.share ?? 'IPC$';
    if (!host) return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, isCloudflare: true,
        error: getCloudflareErrorMessage(host, cfCheck.ip) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        // NEGOTIATE
        await writer.write(buildSMB2NegotiateRequest());
        const negResp = await readResponse(reader, 68, 5000);
        const negHdr = parseSMB2ResponseHeader(negResp);
        if (!negHdr.valid || negHdr.status !== SMB2_STATUS_SUCCESS) throw new Error('Negotiate failed');

        // SESSION_SETUP round 1
        const blob1 = buildSPNEGONegTokenInit(buildNTLMNegotiate());
        await writer.write(buildSessionSetupPacket(blob1, 1));
        const ss1 = await readResponse(reader, 68, 5000);
        const ss1Hdr = parseSMB2ResponseHeader(ss1);
        if (!ss1Hdr.valid) throw new Error('SESSION_SETUP round 1: invalid response');

        let sessionId = ss1Hdr.sessionId;

        if (ss1Hdr.status === SMB2_STATUS_MORE_PROCESSING) {
          // SESSION_SETUP round 2
          const blob2 = buildSPNEGONegTokenResp(buildNTLMAuthenticateAnonymous());
          await writer.write(buildSessionSetupPacket(blob2, 2, sessionId));
          const ss2 = await readResponse(reader, 68, 5000);
          const ss2Hdr = parseSMB2ResponseHeader(ss2);
          if (!ss2Hdr.valid || ss2Hdr.status !== SMB2_STATUS_SUCCESS) {
            throw new Error(`Session auth failed: 0x${((ss2Hdr.status || 0) >>> 0).toString(16).padStart(8, '0')}`);
          }
          if (ss2Hdr.sessionId !== '0x0') sessionId = ss2Hdr.sessionId;
        } else if (ss1Hdr.status !== SMB2_STATUS_SUCCESS) {
          throw new Error(`Session setup failed: 0x${(ss1Hdr.status >>> 0).toString(16).padStart(8, '0')}`);
        }

        // TREE_CONNECT — UNC path: \\host\share
        const uncPath = `\\\\${host}\\${share}`;
        await writer.write(buildTreeConnectPacket(uncPath, 3, sessionId));
        const tcResp = await readResponse(reader, 68, 5000);
        const tcHdr = parseSMB2ResponseHeader(tcResp);

        writer.releaseLock(); reader.releaseLock(); socket.close();

        if (!tcHdr.valid || tcHdr.status !== SMB2_STATUS_SUCCESS) {
          return {
            success: false,
            latencyMs: Date.now() - startTime,
            error: `TREE_CONNECT failed: 0x${((tcHdr.status || 0) >>> 0).toString(16).padStart(8, '0')}`,
            sessionId,
            share,
          };
        }

        // Parse TREE_CONNECT response body [MS-SMB2] 2.2.10:
        //   +0  StructureSize (2) = 16
        //   +2  ShareType (1)
        //   +3  Reserved (1)
        //   +4  ShareFlags (4)
        //   +8  Capabilities (4)
        //   +12 MaximalAccess (4)
        const bodyOff = 4 + 64;
        let shareType = 0, shareFlags = 0, capabilities = 0, maximalAccess = 0;
        if (tcResp.length >= bodyOff + 16) {
          const bv = new DataView(tcResp.buffer, tcResp.byteOffset + bodyOff);
          shareType     = bv.getUint8(2);
          shareFlags    = bv.getUint32(4,  true);
          capabilities  = bv.getUint32(8,  true);
          maximalAccess = bv.getUint32(12, true);
        }

        return {
          success: true,
          latencyMs: Date.now() - startTime,
          sessionId,
          treeId:        tcHdr.treeId,
          share,
          shareType:     SHARE_TYPES[shareType] ?? `Unknown (${shareType})`,
          shareFlags,
          capabilities,
          maximalAccess: `0x${maximalAccess.toString(16).padStart(8, '0')}`,
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
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
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── POST /api/smb/stat ───────────────────────────────────────────────────────

/** Build an SMB2 CREATE request (open existing file, read-attributes only). */
function buildCreatePacket(
  filename: string,
  messageId: number,
  treeId: number,
  sessionId: string,
): Uint8Array {
  const header = buildSMB2Header(SMB2_CMD_CREATE, messageId, treeId, sessionId);
  const nameBytes = new Uint8Array(filename.length * 2);
  const nv = new DataView(nameBytes.buffer);
  for (let i = 0; i < filename.length; i++) nv.setUint16(i * 2, filename.charCodeAt(i), true);
  const body = new Uint8Array(56);
  const bv = new DataView(body.buffer);
  bv.setUint16(0,  57,               true); // StructureSize
  bv.setUint32(4,  2,                true); // ImpersonationLevel = Impersonation
  bv.setUint32(24, 0x00120080,       true); // DesiredAccess = READ_ATTRIBUTES | SYNCHRONIZE
  bv.setUint32(32, 7,                true); // ShareAccess = READ|WRITE|DELETE
  bv.setUint32(36, 1,                true); // CreateDisposition = FILE_OPEN
  bv.setUint16(44, 64 + 56,          true); // NameOffset (relative to SMB2 hdr start)
  bv.setUint16(46, nameBytes.length, true); // NameLength
  return wrapNetBIOS(concatBytes(header, body, nameBytes));
}

/** Build an SMB2 QUERY_INFO request for FileBasicInformation (class 4). */
function buildQueryInfoPacket(
  fileId: Uint8Array,
  messageId: number,
  treeId: number,
  sessionId: string,
): Uint8Array {
  const header = buildSMB2Header(SMB2_CMD_QUERY_INFO, messageId, treeId, sessionId);
  const body = new Uint8Array(40);
  const bv = new DataView(body.buffer);
  bv.setUint16(0, 41,  true); // StructureSize
  bv.setUint8 (2, 1);         // InfoType = SMB2_0_INFO_FILE
  bv.setUint8 (3, 4);         // FileInfoClass = FileBasicInformation
  bv.setUint32(4, 40,  true); // OutputBufferLength
  body.set(fileId, 24);
  return wrapNetBIOS(concatBytes(header, body));
}

/** Build an SMB2 CLOSE request. */
function buildClosePacket(
  fileId: Uint8Array,
  messageId: number,
  treeId: number,
  sessionId: string,
): Uint8Array {
  const header = buildSMB2Header(SMB2_CMD_CLOSE, messageId, treeId, sessionId);
  const body = new Uint8Array(24);
  const bv = new DataView(body.buffer);
  bv.setUint16(0, 24, true); // StructureSize
  body.set(fileId, 8);
  return wrapNetBIOS(concatBytes(header, body));
}

/** Convert Windows FILETIME (two 32-bit LE halves) to ISO date string. */
function filetimeToISO(lo: number, hi: number): string | null {
  if (lo === 0 && hi === 0) return null;
  const ms = (hi * 4294967296 + (lo >>> 0)) / 10000 - 11644473600000;
  return isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Open a file on an SMB2 share and query its basic file attributes:
 *   NEGOTIATE → SESSION_SETUP × 2 (anonymous) → TREE_CONNECT → CREATE → QUERY_INFO → CLOSE
 *
 * Returns creationTime, lastAccessTime, lastWriteTime, changeTime, fileAttributes.
 * Anonymous sessions typically only have access to IPC$ and world-readable shares.
 *
 * Request body: { host, port=445, share='C$', path, timeout=10000 }
 *   path: relative path within the share (e.g. 'Windows\\System32\\ntoskrnl.exe')
 */
export async function handleSMBStat(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const body = await request.json() as { host: string; port?: number; share?: string; path?: string; timeout?: number };
    const { host, port = 445, timeout = 10000 } = body;
    const share = body.share ?? 'C$';
    const path = body.path ?? '';
    if (!host) return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, isCloudflare: true,
        error: getCloudflareErrorMessage(host, cfCheck.ip) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    const statWork = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        // NEGOTIATE
        await writer.write(buildSMB2NegotiateRequest());
        const negResp = await readResponse(reader, 68, 5000);
        const negHdr = parseSMB2ResponseHeader(negResp);
        if (!negHdr.valid || negHdr.status !== SMB2_STATUS_SUCCESS) throw new Error('Negotiate failed');

        // SESSION_SETUP round 1 (NTLMSSP_NEGOTIATE)
        const blob1 = buildSPNEGONegTokenInit(buildNTLMNegotiate());
        await writer.write(buildSessionSetupPacket(blob1, 1));
        const ss1 = await readResponse(reader, 68, 5000);
        const ss1Hdr = parseSMB2ResponseHeader(ss1);
        if (!ss1Hdr.valid) throw new Error('SESSION_SETUP round 1: invalid response');

        let sessionId = ss1Hdr.sessionId;
        if (ss1Hdr.status === SMB2_STATUS_MORE_PROCESSING) {
          const blob2 = buildSPNEGONegTokenResp(buildNTLMAuthenticateAnonymous());
          await writer.write(buildSessionSetupPacket(blob2, 2, sessionId));
          const ss2 = await readResponse(reader, 68, 5000);
          const ss2Hdr = parseSMB2ResponseHeader(ss2);
          if (!ss2Hdr.valid || ss2Hdr.status !== SMB2_STATUS_SUCCESS) {
            throw new Error(`Session auth failed: 0x${((ss2Hdr.status || 0) >>> 0).toString(16).padStart(8, '0')}`);
          }
          if (ss2Hdr.sessionId !== '0x0') sessionId = ss2Hdr.sessionId;
        } else if (ss1Hdr.status !== SMB2_STATUS_SUCCESS) {
          throw new Error(`Session setup failed: 0x${(ss1Hdr.status >>> 0).toString(16).padStart(8, '0')}`);
        }

        // TREE_CONNECT
        const uncPath = `\\\\${host}\\${share}`;
        await writer.write(buildTreeConnectPacket(uncPath, 3, sessionId));
        const tcResp = await readResponse(reader, 68, 5000);
        const tcHdr = parseSMB2ResponseHeader(tcResp);
        if (!tcHdr.valid || tcHdr.status !== SMB2_STATUS_SUCCESS) {
          throw new Error(`TREE_CONNECT failed: 0x${((tcHdr.status || 0) >>> 0).toString(16).padStart(8, '0')}`);
        }
        const treeId = tcHdr.treeId;

        // CREATE (open file for attribute read)
        await writer.write(buildCreatePacket(path, 4, treeId, sessionId));
        const crResp = await readResponse(reader, 68, 5000);
        const crHdr = parseSMB2ResponseHeader(crResp);
        if (!crHdr.valid || crHdr.status !== SMB2_STATUS_SUCCESS) {
          const errHex = `0x${((crHdr.status || 0) >>> 0).toString(16).padStart(8, '0')}`;
          const errDesc = crHdr.status === 0xC0000022 ? ' (ACCESS_DENIED)' :
            crHdr.status === 0xC0000034 ? ' (OBJECT_NAME_NOT_FOUND)' :
            crHdr.status === 0xC0000039 ? ' (OBJECT_PATH_INVALID)' : '';
          throw new Error(`CREATE failed: ${errHex}${errDesc}`);
        }

        // FileId from CREATE response body at offset 4+64+64=132
        const fileIdOff = 4 + 64 + 64;
        const fileId = crResp.length >= fileIdOff + 16
          ? crResp.slice(fileIdOff, fileIdOff + 16)
          : new Uint8Array(16);

        // QUERY_INFO (FileBasicInformation)
        await writer.write(buildQueryInfoPacket(fileId, 5, treeId, sessionId));
        const qiResp = await readResponse(reader, 68, 5000);
        const qiHdr = parseSMB2ResponseHeader(qiResp);

        // CLOSE
        await writer.write(buildClosePacket(fileId, 6, treeId, sessionId));
        writer.releaseLock(); reader.releaseLock(); socket.close();

        if (!qiHdr.valid || qiHdr.status !== SMB2_STATUS_SUCCESS) {
          throw new Error(`QUERY_INFO failed: 0x${((qiHdr.status || 0) >>> 0).toString(16).padStart(8, '0')}`);
        }

        // Parse FileBasicInformation from QUERY_INFO response
        // qiResp: [NetBIOS 4][SMB2 hdr 64][body: StructureSize(2) OutputBufferOffset(2) OutputBufferLength(4) data...]
        // OutputBufferOffset is relative to start of SMB2 message (offset 4 in packet)
        const qiBodyOff = 4 + 64;
        let dv: DataView | null = null;
        if (qiResp.length >= qiBodyOff + 8) {
          const hdrView = new DataView(qiResp.buffer, qiResp.byteOffset + qiBodyOff);
          const outOff = hdrView.getUint16(2, true);
          const dataStart = 4 + outOff;
          if (qiResp.length >= dataStart + 36) {
            dv = new DataView(qiResp.buffer, qiResp.byteOffset + dataStart);
          }
        }

        return {
          success: true, latencyMs: Date.now() - startTime,
          sessionId, treeId, share, path,
          creationTime:   dv ? filetimeToISO(dv.getUint32(0,  true), dv.getUint32(4,  true)) : null,
          lastAccessTime: dv ? filetimeToISO(dv.getUint32(8,  true), dv.getUint32(12, true)) : null,
          lastWriteTime:  dv ? filetimeToISO(dv.getUint32(16, true), dv.getUint32(20, true)) : null,
          changeTime:     dv ? filetimeToISO(dv.getUint32(24, true), dv.getUint32(28, true)) : null,
          fileAttributes: dv ? `0x${dv.getUint32(32, true).toString(16).padStart(4, '0')}` : null,
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close(); throw err;
      }
    })();

    const statResult = await Promise.race([
      statWork,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
    ]);
    return new Response(JSON.stringify(statResult), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'SMB stat failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
