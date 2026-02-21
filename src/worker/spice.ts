/**
 * SPICE (Simple Protocol for Independent Computing Environments) Protocol Implementation
 *
 * SPICE is a remote display protocol developed by Red Hat for virtual desktop infrastructure.
 * It's used primarily with KVM/QEMU virtual machines and provides:
 * - Remote display rendering
 * - Audio/video streaming
 * - USB redirection
 * - Clipboard sharing
 * - Multiple monitor support
 *
 * Protocol Overview:
 * - Default Port: 5900 (same as VNC, but different protocol)
 * - Transport: TCP
 * - Initial handshake uses SPICE link messages
 * - Binary protocol with little-endian byte order
 *
 * Handshake Flow:
 * 1. Client connects to server
 * 2. Client sends SpiceLinkHeader (16 bytes) + SpiceLinkMess body
 * 3. Server responds with SpiceLinkReply:
 *    - error code
 *    - RSA public key (162 bytes, for password encryption)
 *    - Common + channel capabilities
 * 4. Client sends SpiceLinkAuthMechanism (4 bytes: 0=RSA, 1=SASL)
 * 5. If RSA auth, client encrypts password with server's RSA pubkey
 * 6. Server responds with SpiceLinkAuthResult (4 bytes: 0=OK)
 * 7. After MAIN channel auth, server sends SpiceMainInit with available channels
 *
 * SpiceLinkHeader Format (16 bytes):
 * - Magic: "REDQ" (4 bytes)
 * - Major version: uint32 LE
 * - Minor version: uint32 LE
 * - Size: uint32 LE (length of following SpiceLinkMess)
 *
 * SpiceLinkMess Body (18 bytes):
 * - connection_id: uint32 LE (0 = new connection)
 * - channel_type: uint8 (1=MAIN, 2=DISPLAY, 3=INPUTS, 4=CURSOR, 5=PLAYBACK, 6=RECORD)
 * - channel_id: uint8 (0)
 * - num_common_caps: uint32 LE
 * - num_channel_caps: uint32 LE
 * - caps_offset: uint32 LE
 *
 * SpiceLinkReply (166+ bytes):
 * - error: uint32 LE (0=OK, 1=SPICE_LINK_ERR_ERROR, 2=SPICE_LINK_ERR_INVALID_MAGIC, ...)
 * - pub_key: 162 bytes (RSA PKCS#8 DER public key)
 * - num_common_caps: uint32 LE
 * - num_channel_caps: uint32 LE
 * - caps_offset: uint32 LE
 * - capabilities data...
 *
 * References:
 * - SPICE Protocol Specification: https://www.spice-space.org/
 * - GitLab: https://gitlab.freedesktop.org/spice/spice-protocol
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SPICERequest {
  host: string;
  port?: number;
  timeout?: number;
  password?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SPICE_MAGIC = new Uint8Array([0x52, 0x45, 0x44, 0x51]); // "REDQ"
const SPICE_REPLY_MAGIC = new Uint8Array([0x52, 0x45, 0x51, 0x44]); // "REQD"

const SPICE_VERSION_MAJOR = 2;
const SPICE_VERSION_MINOR = 2;

const SPICE_CHANNEL_TYPES: Record<number, string> = {
  1: 'main',
  2: 'display',
  3: 'inputs',
  4: 'cursor',
  5: 'playback',
  6: 'record',
  7: 'tunnel',
  8: 'smartcard',
  9: 'usbredir',
  10: 'port',
  11: 'webdav',
};

// SpiceLinkErr values
const SPICE_LINK_ERRORS: Record<number, string> = {
  0: 'OK',
  1: 'ERROR',
  2: 'INVALID_MAGIC',
  3: 'INVALID_DATA',
  4: 'VERSION_MISMATCH',
  5: 'NEED_SECURED',
  6: 'NEED_UNSECURED',
  7: 'PERMISSION_DENIED',
  8: 'BAD_CA_CERT',
  9: 'SERVER_BUSY',
};

// Auth mechanism constants
const SPICE_COMMON_CAPS: Record<number, string> = {
  0: 'auth-selection',
  1: 'auth-spice',
  2: 'auth-sasl',
  3: 'mini-header',
};

// SpiceMainMsgType - server-to-client on main channel
const SPICE_MSG_MAIN_INIT = 101;
const SPICE_MSG_MAIN_CHANNELS_LIST = 102;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readAtLeast(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needed: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;

  while (total < needed) {
    const remaining = Math.max(1, deadline - Date.now());
    const timer = new Promise<{ value: undefined; done: true }>((resolve) =>
      setTimeout(() => resolve({ value: undefined, done: true }), remaining),
    );
    const { value, done } = await Promise.race([reader.read(), timer]);
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }

  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ─── Protocol builders ────────────────────────────────────────────────────────

/**
 * Build a complete SPICE link message for the MAIN channel.
 * Advertises auth-selection and auth-spice common capabilities.
 */
function buildSpiceLinkMess(channelType = 1, channelId = 0): Uint8Array {
  // Common capabilities: auth-selection (bit 0) + auth-spice (bit 1) + auth-sasl (bit 2)
  const commonCaps = new Uint8Array(4);
  new DataView(commonCaps.buffer).setUint32(0, 0x07, true); // bits 0,1,2

  const numCommonCaps = 1; // one uint32 of caps
  const numChannelCaps = 0;
  // caps_offset is relative from start of SpiceLinkMess
  // SpiceLinkMess header: connection_id(4) + channel_type(1) + channel_id(1) +
  //                        num_common_caps(4) + num_channel_caps(4) + caps_offset(4) = 18 bytes
  const capsOffset = 18;

  // SpiceLinkMess body: 18 bytes header + caps data
  const messSize = capsOffset + numCommonCaps * 4;
  const mess = new Uint8Array(messSize);
  const mv = new DataView(mess.buffer);

  mv.setUint32(0, 0, true);               // connection_id = 0 (new connection)
  mess[4] = channelType;                  // channel_type
  mess[5] = channelId;                    // channel_id
  mv.setUint32(6, numCommonCaps, true);   // num_common_caps
  mv.setUint32(10, numChannelCaps, true); // num_channel_caps
  mv.setUint32(14, capsOffset, true);     // caps_offset
  mess.set(commonCaps, capsOffset);       // common caps uint32

  // SpiceLinkHeader: magic(4) + major(4) + minor(4) + size(4) = 16 bytes
  const header = new Uint8Array(16);
  const hv = new DataView(header.buffer);
  header.set(SPICE_MAGIC, 0);
  hv.setUint32(4, SPICE_VERSION_MAJOR, true);
  hv.setUint32(8, SPICE_VERSION_MINOR, true);
  hv.setUint32(12, messSize, true); // size of the SpiceLinkMess body

  const packet = new Uint8Array(16 + messSize);
  packet.set(header, 0);
  packet.set(mess, 16);
  return packet;
}

// ─── Response parsers ─────────────────────────────────────────────────────────

interface SpiceLinkReplyParsed {
  serverMajor: number;
  serverMinor: number;
  error: number;
  errorName: string;
  hasPubKey: boolean;
  pubKeyHex?: string;
  numCommonCaps: number;
  numChannelCaps: number;
  capabilities: string[];
  supportsAuthSelection: boolean;
  supportsSpiceAuth: boolean;
  supportsSASL: boolean;
}

/**
 * Parse the SpiceLinkReply from the server.
 * Layout: magic(4) + major(4) + minor(4) + size(4) [= 16 byte header]
 *         then the SpiceLinkReply body at offset 16:
 *         error(4) + pub_key(162) + num_common_caps(4) + num_channel_caps(4) + caps_offset(4)
 *         + caps data
 */
function parseSpiceLinkReply(data: Uint8Array): SpiceLinkReplyParsed {
  if (data.length < 16) {
    throw new Error(`Response too short: ${data.length} bytes (need 16 for header)`);
  }

  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== 'REQD') {
    // Some servers don't send the header — try parsing directly as reply body
    if (data.length < 4) {
      throw new Error(`Invalid SPICE magic: expected 'REQD', got '${magic}'`);
    }
  }

  // The header is optional depending on server implementation
  // Try with header offset first, then without
  let bodyOffset = 16;
  let serverMajor = SPICE_VERSION_MAJOR;
  let serverMinor = SPICE_VERSION_MINOR;
  if (magic === 'REQD') {
    // Extract the server's actual version from the reply header
    const hv = new DataView(data.buffer, data.byteOffset, 16);
    serverMajor = hv.getUint32(4, true);
    serverMinor = hv.getUint32(8, true);
  } else {
    bodyOffset = 0; // No standard header, body starts at 0
  }

  if (data.length < bodyOffset + 4) {
    throw new Error(`Response too short for SpiceLinkReply body`);
  }

  const bv = new DataView(data.buffer, data.byteOffset + bodyOffset, data.byteLength - bodyOffset);
  const error = bv.getUint32(0, true);
  const errorName = SPICE_LINK_ERRORS[error] ?? `UNKNOWN_${error}`;

  // pub_key: 162 bytes at offset 4 (RSA public key in PKCS#8 DER)
  let hasPubKey = false;
  let pubKeyHex: string | undefined;
  if (data.length >= bodyOffset + 4 + 162) {
    hasPubKey = true;
    const keyBytes = new Uint8Array(data.buffer, data.byteOffset + bodyOffset + 4, 162);
    // Only extract if non-zero (server has a pubkey configured)
    const isNonZero = keyBytes.some(b => b !== 0);
    if (isNonZero) {
      pubKeyHex = Array.from(keyBytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('') + '...';
    }
  }

  // After error(4) + pub_key(162) = offset 166
  const capsHeaderOffset = 166;
  let numCommonCaps = 0;
  let numChannelCaps = 0;
  const capabilities: string[] = [];

  if (data.length >= bodyOffset + capsHeaderOffset + 12) {
    numCommonCaps = bv.getUint32(capsHeaderOffset, true);
    numChannelCaps = bv.getUint32(capsHeaderOffset + 4, true);
    const capsOffset = bv.getUint32(capsHeaderOffset + 8, true);

    // Parse common capabilities (each is a uint32 bitmask)
    const capsDataOffset = capsHeaderOffset + capsOffset;
    for (let i = 0; i < numCommonCaps && i < 4; i++) {
      const capOffset = capsDataOffset + i * 4;
      if (data.length >= bodyOffset + capOffset + 4) {
        const capBits = bv.getUint32(capOffset, true);
        for (const [bit, name] of Object.entries(SPICE_COMMON_CAPS)) {
          if (capBits & (1 << parseInt(bit, 10))) {
            capabilities.push(name);
          }
        }
      }
    }
  }

  return {
    serverMajor,
    serverMinor,
    error,
    errorName,
    hasPubKey,
    pubKeyHex,
    numCommonCaps,
    numChannelCaps,
    capabilities,
    supportsAuthSelection: capabilities.includes('auth-selection'),
    supportsSpiceAuth: capabilities.includes('auth-spice'),
    supportsSASL: capabilities.includes('auth-sasl'),
  };
}

/**
 * Parse a SPICE mini-header data message to extract SpiceMainInit channel list.
 * SpiceMainInit contains the list of channels the server is listening on.
 */
function parseChannelList(data: Uint8Array): Array<{ type: number; name: string; id: number }> {
  if (data.length < 4) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const numChannels = view.getUint32(0, true);
  const channels: Array<{ type: number; name: string; id: number }> = [];
  for (let i = 0; i < numChannels && i < 64; i++) {
    const offset = 4 + i * 2;
    if (offset + 2 > data.length) break;
    const type = data[offset];
    const id = data[offset + 1];
    channels.push({ type, id, name: SPICE_CHANNEL_TYPES[type] ?? `unknown-${type}` });
  }
  return channels;
}

// ─── SPICE mini-header parser ─────────────────────────────────────────────────

/**
 * Parse SPICE mini data header (when mini-header capability is negotiated).
 * Mini header: type(2 LE) + size(4 LE) = 6 bytes
 */
function parseMiniHeader(data: Uint8Array): { type: number; size: number } | null {
  if (data.length < 6) return null;
  const view = new DataView(data.buffer, data.byteOffset);
  return {
    type: view.getUint16(0, true),
    size: view.getUint32(2, true),
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handle SPICE connection probe with full link exchange and channel enumeration.
 *
 * POST /api/spice/connect
 * Body: { host, port=5900, timeout=15000, password? }
 *
 * Returns: server version, auth methods, available channels (if readable),
 * error code from the SpiceLinkReply.
 */
export async function handleSPICEConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json() as SPICERequest;
    const { host, port = 5900, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required parameter: host' }), {
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
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const socket = connect(`${host}:${port}`);
    const timeoutAt = Date.now() + timeout;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    try {
      await Promise.race([socket.opened, timeoutPromise]);
    } catch (err) {
      try { socket.close(); } catch { /* ignore */ }
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: err instanceof Error ? err.message : 'Connection failed',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Step 1: Send SpiceLinkHeader + SpiceLinkMess for MAIN channel
      const linkMsg = buildSpiceLinkMess(1, 0); // channel_type=1 (MAIN)
      await writer.write(linkMsg);

      // Step 2: Read SpiceLinkReply
      // Expected: 16-byte header + 4(error) + 162(pubkey) + 4+4+4(caps header) = 190+ bytes
      const replyData = await readAtLeast(reader, 180, Math.min(5000, timeoutAt - Date.now()));

      let linkReply: SpiceLinkReplyParsed;
      try {
        linkReply = parseSpiceLinkReply(replyData);
      } catch (parseErr) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: parseErr instanceof Error ? parseErr.message : 'Failed to parse SpiceLinkReply',
          rawBytesReceived: replyData.length,
          rawHex: Array.from(replyData.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // If link error, return the error info (still useful)
      if (linkReply.error !== 0) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          protocolVersion: `${linkReply.serverMajor}.${linkReply.serverMinor}`,
          serverMajor: linkReply.serverMajor,
          serverMinor: linkReply.serverMinor,
          linkError: linkReply.error,
          linkErrorName: linkReply.errorName,
          hasPubKey: linkReply.hasPubKey,
          capabilities: linkReply.capabilities,
          message: `SPICE server returned error: ${linkReply.errorName}`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Step 3: Send auth mechanism selection
      // If server supports auth-selection, send SpiceLinkAuthMechanism
      // 0 = SPICE (password), 1 = SASL, 0xFFFFFFFF = no auth
      let authMechanism: number;
      let authRequired: boolean;

      if (linkReply.supportsSpiceAuth && body.password) {
        authMechanism = 0; // SPICE password auth
        authRequired = true;
      } else if (!linkReply.supportsSpiceAuth && !linkReply.supportsSASL) {
        authMechanism = 0xFFFFFFFF; // No auth
        authRequired = false;
      } else {
        authMechanism = 0xFFFFFFFF; // Try no auth
        authRequired = false;
      }

      // Send auth mechanism (4 bytes LE)
      const authMechBuf = new Uint8Array(4);
      new DataView(authMechBuf.buffer).setUint32(0, authMechanism, true);
      await writer.write(authMechBuf);

      // Step 4: If no auth, we should receive SpiceLinkAuthResult (4 bytes: 0=OK)
      // then server sends SpiceMainInit with channel list
      let channels: Array<{ type: number; name: string; id: number }> = [];
      let authResult: number | null = null;
      let serverInfo: Record<string, unknown> = {};

      const mainData = await readAtLeast(reader, 4, Math.min(3000, timeoutAt - Date.now()));

      if (mainData.length >= 4) {
        const view = new DataView(mainData.buffer, mainData.byteOffset);
        authResult = view.getUint32(0, true);

        if (authResult === 0 && mainData.length > 4) {
          // Auth OK — try to parse SpiceMainInit or SpiceMsgMainChannelsList
          // SpiceMainInit is type 101 in the main channel data stream
          // SpiceMsgMainChannelsList is type 102
          // The data after auth result is a SPICE data message
          // Format: header (mini: 6 bytes, or full: 18 bytes) + body
          const msgData = mainData.slice(4);

          // Try mini-header first (6 bytes)
          const miniHdr = parseMiniHeader(msgData);
          if (miniHdr && (miniHdr.type === SPICE_MSG_MAIN_INIT || miniHdr.type === SPICE_MSG_MAIN_CHANNELS_LIST)) {
            const msgBody = msgData.slice(6, 6 + miniHdr.size);
            if (miniHdr.type === SPICE_MSG_MAIN_CHANNELS_LIST) {
              channels = parseChannelList(msgBody);
            } else if (miniHdr.type === SPICE_MSG_MAIN_INIT) {
              // SpiceMainInit has session_id(4) + display_hints(4) + ...
              // Followed by channels list
              if (msgBody.length >= 8) {
                const initView = new DataView(msgBody.buffer, msgBody.byteOffset);
                serverInfo = {
                  sessionId: initView.getUint32(0, true),
                  displayHints: initView.getUint32(4, true),
                };
              }
            }
          }
        }
      }

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        protocolVersion: `${linkReply.serverMajor}.${linkReply.serverMinor}`,
        serverMajor: linkReply.serverMajor,
        serverMinor: linkReply.serverMinor,
        linkError: linkReply.error,
        linkErrorName: linkReply.errorName,
        hasPubKey: linkReply.hasPubKey,
        pubKeyPrefix: linkReply.pubKeyHex,
        numCommonCaps: linkReply.numCommonCaps,
        numChannelCaps: linkReply.numChannelCaps,
        capabilities: linkReply.capabilities,
        supportsAuthSelection: linkReply.supportsAuthSelection,
        supportsSpiceAuth: linkReply.supportsSpiceAuth,
        supportsSASL: linkReply.supportsSASL,
        authRequired,
        authResult,
        authResultOk: authResult === 0,
        channels,
        serverInfo,
        message: `SPICE server reachable. Auth: ${authRequired ? 'required' : 'not required'}. Capabilities: ${linkReply.capabilities.join(', ') || 'none'}`,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { writer.releaseLock(); } catch { /* ignore */ }
      try { socket.close(); } catch { /* ignore */ }
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Request processing failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Enumerate SPICE channels by connecting to the MAIN channel and reading SpiceMainChannelsList.
 *
 * POST /api/spice/channels
 * Body: { host, port=5900, timeout=15000 }
 *
 * Returns a list of channels the server is offering.
 */
export async function handleSPICEChannels(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Reuse the connect handler, it now returns channel info
  return handleSPICEConnect(request);
}

// Re-export magic bytes for tests
export { SPICE_MAGIC, SPICE_REPLY_MAGIC };
