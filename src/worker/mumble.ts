/**
 * Mumble Protocol Implementation
 *
 * Mumble is a free, open-source, low-latency voice chat application.
 * Uses TLS-wrapped TCP for control traffic and OCB-AES128 for UDP voice.
 *
 * Port: 64738 (TCP + UDP)
 * Transport: TLS/TCP (control), UDP (voice — unavailable in Workers)
 * Framing: 2-byte type (BE uint16) + 4-byte length (BE uint32) + protobuf payload
 *
 * Message types (relevant subset):
 *   0  Version         — client/server version exchange
 *   2  Authenticate    — username/password/token auth
 *   3  Ping            — keepalive
 *   4  Reject          — auth rejection with reason
 *   5  ServerSync      — sent when server is done syncing state (auth complete)
 *   7  ChannelState    — channel info (id, parent, name, description)
 *   9  UserState       — user info (session, name, channel, mute/deaf flags)
 *  11  TextMessage     — channel/user chat message
 *  15  CryptSetup      — encryption key exchange
 *  21  CodecVersion    — audio codec negotiation
 *  24  ServerConfig    — server-side config (max_bandwidth, welcome_text, etc.)
 *
 * Auth proto fields (Authenticate type=2):
 *   optional string username = 2;
 *   optional string password = 3;
 *   repeated int32  celt_versions = 5;
 *   optional bool   opus = 7;
 *
 * Connection flow:
 *   1. TLS connect
 *   2. Client → Version (type 0)
 *   3. Server → Version
 *   4. Client → Authenticate (type 2)
 *   5. Server → CryptSetup, CodecVersion, ChannelState×N, UserState×N, ServerSync
 *   6. Client → TextMessage, Ping, etc.
 *
 * Endpoints:
 *   POST /api/mumble/probe        — TLS connect + version exchange
 *   POST /api/mumble/version      — alias for probe
 *   POST /api/mumble/ping         — version + ping, report server response types
 *   POST /api/mumble/auth         — full auth + channel/user list + server info
 *   POST /api/mumble/text-message — auth + send TextMessage to a channel
 *
 * References:
 *   https://mumble-protocol.readthedocs.io/
 *   https://github.com/mumble-voip/mumble/blob/master/src/Mumble.proto
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ---- Protobuf helpers (no Buffer, pure Uint8Array) -------------------------

function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return new Uint8Array(bytes);
}

/** Encode a protobuf varint field (wire type 0). */
function pbVarint(fieldNum: number, value: number): Uint8Array {
  const v = encodeVarint(value);
  const r = new Uint8Array(1 + v.length);
  r[0] = (fieldNum << 3) | 0;
  r.set(v, 1);
  return r;
}

/** Encode a protobuf string/bytes field (wire type 2) with proper varint length. */
function pbString(fieldNum: number, value: string): Uint8Array {
  const enc = new TextEncoder().encode(value);
  const lenBytes = encodeVarint(enc.length);
  const result = new Uint8Array(1 + lenBytes.length + enc.length);
  result[0] = (fieldNum << 3) | 2;
  result.set(lenBytes, 1);
  result.set(enc, 1 + lenBytes.length);
  return result;
}

function cat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ---- Mumble frame builder ---------------------------------------------------

function buildMsg(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(6 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, type, false);
  view.setUint32(2, payload.length, false);
  out.set(payload, 6);
  return out;
}

// ---- Message type constants -------------------------------------------------

const MSG_VERSION       = 0;
const MSG_AUTHENTICATE  = 2;
const MSG_PING          = 3;
const MSG_REJECT        = 4;
const MSG_SERVER_SYNC   = 5;
const MSG_CHANNEL_STATE = 7;
const MSG_USER_STATE    = 9;
const MSG_TEXT_MESSAGE  = 11;
const MSG_CRYPT_SETUP   = 15;
const MSG_CODEC_VERSION = 21;
const MSG_SERVER_CONFIG = 24;

const MSG_NAMES: Record<number, string> = {
  [MSG_VERSION]:       'Version',
  [MSG_AUTHENTICATE]:  'Authenticate',
  [MSG_PING]:          'Ping',
  [MSG_REJECT]:        'Reject',
  [MSG_SERVER_SYNC]:   'ServerSync',
  [MSG_CHANNEL_STATE]: 'ChannelState',
  [MSG_USER_STATE]:    'UserState',
  [MSG_TEXT_MESSAGE]:  'TextMessage',
  [MSG_CRYPT_SETUP]:   'CryptSetup',
  [MSG_CODEC_VERSION]: 'CodecVersion',
  [MSG_SERVER_CONFIG]: 'ServerConfig',
};

// ---- Build helpers ---------------------------------------------------------

/** Version 1.5.0 — recent enough for modern servers. */
function buildVersion(): Uint8Array {
  const ver = (1 << 16) | (5 << 8) | 0; // 1.5.0
  return buildMsg(MSG_VERSION, cat(
    pbVarint(1, ver),   // version_v1
    pbString(2, '1.5.0'), // release
    pbString(3, 'Linux'),  // os
  ));
}

/**
 * Authenticate proto:
 *   optional string username = 2;
 *   optional string password = 3;
 *   repeated int32  celt_versions = 5;
 *   optional bool   opus = 7;
 */
function buildAuthenticate(username: string, password: string): Uint8Array {
  return buildMsg(MSG_AUTHENTICATE, cat(
    pbString(2, username),
    ...(password ? [pbString(3, password)] : []),
    pbVarint(7, 1), // opus = true
  ));
}

function buildPing(): Uint8Array {
  return buildMsg(MSG_PING, new Uint8Array(0));
}

/**
 * TextMessage proto:
 *   repeated uint32 channel_id = 3;
 *   optional string message    = 5;
 */
function buildTextMessage(channelId: number, message: string): Uint8Array {
  return buildMsg(MSG_TEXT_MESSAGE, cat(
    pbVarint(3, channelId),
    pbString(5, message),
  ));
}

// ---- Protobuf parser --------------------------------------------------------

/**
 * Parse a flat protobuf message into a map of fieldNum → first string or number value.
 * Handles varint lengths correctly; ignores fixed-width wire types.
 */
function parseProto(data: Uint8Array): Map<number, string | number> {
  const fields = new Map<number, string | number>();
  const dec = new TextDecoder('utf-8', { fatal: false });
  let i = 0;

  while (i < data.length) {
    // Read tag (varint: field_number << 3 | wire_type)
    let tagVal = 0, shift = 0;
    while (i < data.length) {
      const b = data[i++];
      tagVal |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    const fieldNum = tagVal >>> 3;
    const wireType = tagVal & 0x07;

    if (wireType === 0) {
      // Varint value
      let val = 0; shift = 0;
      while (i < data.length) {
        const b = data[i++];
        val |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      if (!fields.has(fieldNum)) fields.set(fieldNum, val);
    } else if (wireType === 2) {
      // Length-delimited: read varint length
      let len = 0; shift = 0;
      while (i < data.length) {
        const b = data[i++];
        len |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      if (i + len > data.length) break;
      const str = dec.decode(data.subarray(i, i + len));
      i += len;
      if (!fields.has(fieldNum)) fields.set(fieldNum, str);
    } else if (wireType === 1) {
      i += 8; // 64-bit fixed
    } else if (wireType === 5) {
      i += 4; // 32-bit fixed
    } else {
      break;  // unknown wire type — stop
    }
  }
  return fields;
}

// ---- Message stream reader --------------------------------------------------

/**
 * Read Mumble frames from a stream until ServerSync (type 5) or timeout.
 * Handles streaming / fragmented reads by accumulating into a byte buffer.
 */
async function readMumbleMsgs(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Array<{ type: number; payload: Uint8Array }>> {
  const msgs: Array<{ type: number; payload: Uint8Array }> = [];
  const buf: number[] = [];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((_, rej) =>
        setTimeout(() => rej(new Error('read timeout')), remaining),
      ),
    ]).catch(() => ({ value: undefined, done: true as const }));

    if (done || !value) break;
    for (let i = 0; i < value.length; i++) buf.push(value[i]);

    // Extract complete frames from buf
    let offset = 0;
    while (offset + 6 <= buf.length) {
      const msgType = (buf[offset] << 8) | buf[offset + 1];
      const msgLen =
        (buf[offset + 2] << 24) | (buf[offset + 3] << 16) |
        (buf[offset + 4] << 8)  | buf[offset + 5];
      if (msgLen > 4_000_000) break; // sanity limit
      if (offset + 6 + msgLen > buf.length) break;
      msgs.push({ type: msgType, payload: new Uint8Array(buf.slice(offset + 6, offset + 6 + msgLen)) });
      offset += 6 + msgLen;
      if (msgType === MSG_SERVER_SYNC) {
        buf.splice(0, offset);
        return msgs;
      }
    }
    buf.splice(0, offset);
  }
  return msgs;
}

// ---- Connect helper ---------------------------------------------------------

interface MumbleBaseRequest {
  host: string;
  port?: number;
  timeout?: number;
  tls?: boolean;
}

async function mumbleOpen(
  host: string, port: number, tls: boolean, timeout: number,
): Promise<{
  socket: ReturnType<typeof connect>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  reader: ReadableStreamDefaultReader<Uint8Array>;
}> {
  const socket = connect(`${host}:${port}`, {
    secureTransport: tls ? 'on' : 'off',
    allowHalfOpen: false,
  });
  await Promise.race([
    socket.opened,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connection timeout')), timeout)),
  ]);
  return { socket, writer: socket.writable.getWriter(), reader: socket.readable.getReader() };
}

function mumbleClose(socket: ReturnType<typeof connect>, writer: WritableStreamDefaultWriter<Uint8Array>, reader: ReadableStreamDefaultReader<Uint8Array>) {
  try { reader.releaseLock(); } catch { /* ignore */ }
  try { writer.releaseLock(); } catch { /* ignore */ }
  try { socket.close(); } catch { /* ignore */ }
}

// ---- Handlers --------------------------------------------------------------

/**
 * Version probe — TLS connect, send Version, read server Version.
 *
 * POST /api/mumble/probe
 * Body: { host, port?, timeout?, tls? }
 * Returns: { success, host, port, tls, version, release, os, rtt }
 */
export async function handleMumbleProbe(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await request.json() as MumbleBaseRequest;
    const { host, port = 64738, timeout = 10000, tls = true } = body;
    if (!host) return Response.json({ success: false, error: 'Host is required' }, { status: 400 });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }, { status: 403 });
    }

    const { socket, writer, reader } = await mumbleOpen(host, port, tls, timeout);
    try {
      await writer.write(buildVersion());
      const msgs = await readMumbleMsgs(reader, Math.min(timeout, 5000));
      const rtt = Date.now() - start;

      const vMsg = msgs.find(m => m.type === MSG_VERSION);
      const rMsg = msgs.find(m => m.type === MSG_REJECT);

      if (rMsg) {
        const f = parseProto(rMsg.payload);
        return Response.json({ success: false, host, port, tls, error: `Rejected: ${f.get(2) || 'unknown'}`, rtt });
      }

      const result: Record<string, unknown> = { success: !!vMsg || msgs.length > 0, host, port, tls, rtt };
      if (vMsg) {
        const f = parseProto(vMsg.payload);
        const ver = f.get(1) as number | undefined;
        if (ver !== undefined) {
          result.versionHex = `0x${ver.toString(16).padStart(6, '0')}`;
          result.version = `${(ver >> 16) & 0xff}.${(ver >> 8) & 0xff}.${ver & 0xff}`;
        }
        if (f.has(2)) result.release = f.get(2);
        if (f.has(3)) result.os = f.get(3);
        if (f.has(4)) result.osVersion = f.get(4);
      }
      result.msgTypes = msgs.map(m => MSG_NAMES[m.type] ?? String(m.type));
      return Response.json(result);
    } finally {
      mumbleClose(socket, writer, reader);
    }
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : 'Connection failed', rtt: Date.now() - start }, { status: 500 });
  }
}

/** Alias for probe. */
export async function handleMumbleVersion(request: Request): Promise<Response> {
  return handleMumbleProbe(request);
}

/**
 * Ping — send Version + Ping, report what the server sends back.
 *
 * POST /api/mumble/ping
 * Body: { host, port?, timeout?, tls? }
 * Returns: { success, host, port, tls, rtt, gotVersion, gotPong, msgTypes }
 */
export async function handleMumblePing(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await request.json() as MumbleBaseRequest;
    const { host, port = 64738, timeout = 8000, tls = true } = body;
    if (!host) return Response.json({ success: false, error: 'Host is required' }, { status: 400 });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }, { status: 403 });
    }

    const { socket, writer, reader } = await mumbleOpen(host, port, tls, timeout);
    try {
      await writer.write(buildVersion());
      await writer.write(buildPing());
      const msgs = await readMumbleMsgs(reader, Math.min(timeout, 4000));
      const rtt = Date.now() - start;
      return Response.json({
        success: msgs.length > 0,
        host, port, tls, rtt,
        gotVersion: msgs.some(m => m.type === MSG_VERSION),
        gotPong: msgs.some(m => m.type === MSG_PING),
        msgTypes: msgs.map(m => MSG_NAMES[m.type] ?? String(m.type)),
      });
    } finally {
      mumbleClose(socket, writer, reader);
    }
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : 'Connection failed', rtt: Date.now() - start }, { status: 500 });
  }
}

/**
 * Authenticate + enumerate channels and users.
 *
 * POST /api/mumble/auth
 * Body: { host, port?, username?, password?, timeout?, tls? }
 * Returns: { success, authenticated, session, maxBandwidth, welcomeText,
 *            channels[{id,parent,name}], users[{session,name,channel,muted,deafened}] }
 */
export async function handleMumbleAuth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MumbleBaseRequest & { username?: string; password?: string };
    const { host, port = 64738, username = 'portofcall', password = '', timeout = 12000, tls = true } = body;
    if (!host) return Response.json({ success: false, error: 'Host is required' }, { status: 400 });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }, { status: 403 });
    }

    const { socket, writer, reader } = await mumbleOpen(host, port, tls, timeout);
    try {
      await writer.write(buildVersion());
      await writer.write(buildAuthenticate(username, password));

      const msgs = await readMumbleMsgs(reader, timeout);

      const channels: Array<{ id: number; parent?: number; name: string }> = [];
      const users: Array<{ session: number; name: string; channel?: number; muted?: boolean; deafened?: boolean }> = [];
      let serverSync: { session?: number; maxBandwidth?: number; welcomeText?: string } | undefined;
      let rejectionReason: string | undefined;

      for (const { type, payload } of msgs) {
        const f = parseProto(payload);
        if (type === MSG_CHANNEL_STATE) {
          channels.push({
            id:     (f.get(1) as number) ?? 0,
            parent: f.get(2) as number | undefined,
            name:   (f.get(3) as string) ?? '',
          });
        } else if (type === MSG_USER_STATE) {
          users.push({
            session:  (f.get(1) as number) ?? 0,
            name:     (f.get(3) as string) ?? '',
            channel:  f.get(6) as number | undefined,
            muted:    (f.get(7) as number) === 1,
            deafened: (f.get(8) as number) === 1,
          });
        } else if (type === MSG_SERVER_SYNC) {
          serverSync = {
            session:      f.get(1) as number | undefined,
            maxBandwidth: f.get(2) as number | undefined,
            welcomeText:  f.get(3) as string | undefined,
          };
        } else if (type === MSG_REJECT) {
          rejectionReason = (f.get(2) as string) || 'Unknown reason';
        }
      }

      return Response.json({
        success: true,
        host, port, tls, username,
        authenticated: !!serverSync,
        ...(rejectionReason ? { rejectionReason } : {}),
        ...(serverSync?.session !== undefined    ? { session: serverSync.session }           : {}),
        ...(serverSync?.maxBandwidth !== undefined ? { maxBandwidth: serverSync.maxBandwidth } : {}),
        ...(serverSync?.welcomeText             ? { welcomeText: serverSync.welcomeText }    : {}),
        channels,
        users,
        messageCount: msgs.length,
      });
    } finally {
      mumbleClose(socket, writer, reader);
    }
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/**
 * Authenticate and send a TextMessage to a channel.
 *
 * POST /api/mumble/text-message
 * Body: { host, port?, username?, password?, channelId?, message, timeout?, tls? }
 * Returns: { success, channelId, messageSent }
 */
export async function handleMumbleTextMessage(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MumbleBaseRequest & {
      username?: string; password?: string; channelId?: number; message: string;
    };
    const { host, port = 64738, username = 'portofcall', password = '', channelId = 0, message, timeout = 12000, tls = true } = body;
    if (!host)    return Response.json({ success: false, error: 'Host is required' }, { status: 400 });
    if (!message) return Response.json({ success: false, error: 'Message is required' }, { status: 400 });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return Response.json({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }, { status: 403 });
    }

    const { socket, writer, reader } = await mumbleOpen(host, port, tls, timeout);
    try {
      await writer.write(buildVersion());
      await writer.write(buildAuthenticate(username, password));

      const syncMsgs = await readMumbleMsgs(reader, Math.min(timeout, 8000));
      const authenticated = syncMsgs.some(m => m.type === MSG_SERVER_SYNC);
      const rejectMsg = syncMsgs.find(m => m.type === MSG_REJECT);

      if (rejectMsg) {
        const f = parseProto(rejectMsg.payload);
        return Response.json({ success: false, host, port, tls, username, error: `Rejected: ${f.get(2) || 'unknown'}` });
      }
      if (!authenticated) {
        return Response.json({ success: false, host, port, tls, username, error: 'Authentication not confirmed (no ServerSync received)' });
      }

      await writer.write(buildTextMessage(channelId, message));
      return Response.json({ success: true, host, port, tls, username, channelId, messageSent: message });
    } finally {
      mumbleClose(socket, writer, reader);
    }
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
