/**
 * 9P (Plan 9 Filesystem Protocol) Implementation
 *
 * 9P is a network protocol from Plan 9 (Bell Labs) that presents
 * all system resources as files in a hierarchical filesystem.
 * Used by QEMU (virtio-9p), WSL2, and other virtualization systems.
 *
 * Protocol: 9P2000 (binary, little-endian)
 *
 * Message Format:
 *   [size:uint32LE][type:uint8][tag:uint16LE][body...]
 *
 * Connection Flow:
 * 1. Client sends Tversion (type 100) with msize and "9P2000"
 * 2. Server responds Rversion (type 101) with agreed msize and version
 * 3. Client sends Tattach (type 104) to mount filesystem root
 * 4. Server responds Rattach (type 105) with root QID
 *
 * Message Types:
 *   100/101 = Tversion/Rversion  (version negotiation)
 *   102/103 = Tauth/Rauth        (authentication)
 *   104/105 = Tattach/Rattach     (mount root)
 *   107     = Rerror              (error response; 106/Terror is illegal)
 *   110/111 = Twalk/Rwalk         (navigate path)
 *   112/113 = Topen/Ropen         (open file)
 *   116/117 = Tread/Rread         (read file)
 *   120/121 = Tclunk/Rclunk       (close fid)
 *   124/125 = Tstat/Rstat         (file info)
 */

import { connect } from 'cloudflare:sockets';

// 9P2000 message types
const Tversion = 100;
const Rversion = 101;
const Tattach = 104;
const Rattach = 105;
const Rerror = 107;
const Twalk = 110;
const Rwalk = 111;
const Topen = 112;
const Ropen = 113;
const Tread = 116;
const Rread = 117;
const Tclunk = 120;
// const Rclunk = 121;
const Tstat = 124;
const Rstat = 125;

// Default max message size
const DEFAULT_MSIZE = 8192;
const VERSION_STRING = '9P2000';
const NOTAG = 0xffff;
const NOFID = 0xffffffff;

interface NinePConnectRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface NinePResponse {
  success: boolean;
  version?: string;
  msize?: number;
  serverVersion?: string;
  rootQid?: { type: number; version: number; path: string };
  error?: string;
}

/**
 * Build a 9P2000 message
 *
 * Format: [size:uint32LE][type:uint8][tag:uint16LE][body...]
 * Size includes itself (4 bytes) + type (1) + tag (2) + body
 */
function build9PMessage(type: number, tag: number, body: Uint8Array): Uint8Array {
  const size = 4 + 1 + 2 + body.length;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);

  view.setUint32(0, size, true);   // size (LE)
  view.setUint8(4, type);          // type
  view.setUint16(5, tag, true);    // tag (LE)

  const array = new Uint8Array(buffer);
  array.set(body, 7);

  return array;
}

/**
 * Build Tversion message body
 * Body: [msize:uint32LE][version:string]
 * String format in 9P: [len:uint16LE][chars...]
 */
function buildTversion(msize: number): Uint8Array {
  const encoder = new TextEncoder();
  const versionBytes = encoder.encode(VERSION_STRING);

  const bodyLen = 4 + 2 + versionBytes.length;
  const body = new ArrayBuffer(bodyLen);
  const view = new DataView(body);

  view.setUint32(0, msize, true);                 // msize
  view.setUint16(4, versionBytes.length, true);    // version string length
  new Uint8Array(body).set(versionBytes, 6);       // version string

  return new Uint8Array(body);
}

/**
 * Build Tattach message body
 * Body: [fid:uint32LE][afid:uint32LE][uname:string][aname:string]
 */
function buildTattach(fid: number, afid: number, uname: string, aname: string): Uint8Array {
  const encoder = new TextEncoder();
  const unameBytes = encoder.encode(uname);
  const anameBytes = encoder.encode(aname);

  const bodyLen = 4 + 4 + (2 + unameBytes.length) + (2 + anameBytes.length);
  const body = new ArrayBuffer(bodyLen);
  const view = new DataView(body);
  const array = new Uint8Array(body);

  let offset = 0;
  view.setUint32(offset, fid, true);              // fid
  offset += 4;
  view.setUint32(offset, afid, true);             // afid (NOFID = no auth)
  offset += 4;
  view.setUint16(offset, unameBytes.length, true); // uname length
  offset += 2;
  array.set(unameBytes, offset);                    // uname
  offset += unameBytes.length;
  view.setUint16(offset, anameBytes.length, true); // aname length
  offset += 2;
  array.set(anameBytes, offset);                    // aname

  return new Uint8Array(body);
}

/**
 * Parse a 9P2000 response message
 */
function parse9PMessage(data: Uint8Array): {
  size: number;
  type: number;
  tag: number;
  body: Uint8Array;
} | null {
  if (data.length < 7) return null; // Minimum: size(4) + type(1) + tag(2)

  const view = new DataView(data.buffer, data.byteOffset);
  const size = view.getUint32(0, true);

  if (data.length < size) return null; // Incomplete message

  const type = view.getUint8(4);
  const tag = view.getUint16(5, true);
  const body = data.slice(7, size);

  return { size, type, tag, body };
}

/**
 * Parse a 9P string from body at given offset
 * Returns [string, bytesConsumed]
 */
function parse9PString(body: Uint8Array, offset: number): [string, number] {
  if (offset + 2 > body.length) {
    throw new Error('9P string length field out of bounds');
  }
  const view = new DataView(body.buffer, body.byteOffset);
  const len = view.getUint16(offset, true);
  if (offset + 2 + len > body.length) {
    throw new Error(`9P string data out of bounds (need ${offset + 2 + len}, have ${body.length})`);
  }
  const str = new TextDecoder().decode(body.slice(offset + 2, offset + 2 + len));
  return [str, 2 + len];
}

/**
 * Parse a QID (13 bytes: type:uint8 + version:uint32LE + path:uint64LE)
 */
function parseQID(body: Uint8Array, offset: number): { type: number; version: number; path: string } {
  if (offset + 13 > body.length) {
    throw new Error('QID out of bounds');
  }
  const view = new DataView(body.buffer, body.byteOffset);
  const type = view.getUint8(offset);
  const version = view.getUint32(offset + 1, true);
  // path is uint64LE - read as two uint32s for JS compatibility
  const pathLow = view.getUint32(offset + 5, true);
  const pathHigh = view.getUint32(offset + 9, true);
  const path = `0x${pathHigh.toString(16).padStart(8, '0')}${pathLow.toString(16).padStart(8, '0')}`;

  return { type, version, path };
}

/**
 * Read data from socket with timeout
 */
async function readFromSocket(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
): Promise<Uint8Array> {
  const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
  if (done || !value) return new Uint8Array(0);
  return value;
}

/**
 * Validate input parameters
 */
function validateInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) {
    return 'Host is required';
  }

  if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
    return 'Host contains invalid characters';
  }

  if (port < 1 || port > 65535) {
    return 'Port must be between 1 and 65535';
  }

  return null;
}

/**
 * Handle 9P connect/version negotiation
 *
 * POST /api/9p/connect
 * Body: { host, port?, timeout? }
 *
 * Performs Tversion + Tattach handshake to probe a 9P server.
 */
export async function handle9PConnect(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as NinePConnectRequest;
    const { host, port = 564, timeout = 10000 } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: validationError,
        } satisfies NinePResponse),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: Send Tversion
      const tversionBody = buildTversion(DEFAULT_MSIZE);
      const tversionMsg = build9PMessage(Tversion, NOTAG, tversionBody);
      await writer.write(tversionMsg);

      // Read Rversion response
      const versionData = await readFromSocket(reader, timeoutPromise);
      const versionMsg = parse9PMessage(versionData);

      if (!versionMsg) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            error: 'No valid 9P response received',
          } satisfies NinePResponse),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      // Check for Rerror
      if (versionMsg.type === Rerror) {
        const [errMsg] = parse9PString(versionMsg.body, 0);
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            error: `9P server error: ${errMsg}`,
          } satisfies NinePResponse),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (versionMsg.type !== Rversion) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            error: `Unexpected response type: ${versionMsg.type} (expected Rversion=${Rversion})`,
          } satisfies NinePResponse),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      // Parse Rversion body: [msize:uint32LE][version:string]
      const rversionView = new DataView(versionMsg.body.buffer, versionMsg.body.byteOffset);
      const serverMsize = rversionView.getUint32(0, true);
      const [serverVersion] = parse9PString(versionMsg.body, 4);

      const result: NinePResponse = {
        success: true,
        version: VERSION_STRING,
        msize: serverMsize,
        serverVersion,
      };

      // Step 2: Try Tattach (to get root QID)
      if (serverVersion !== 'unknown') {
        try {
          const tattachBody = buildTattach(0, NOFID, 'anonymous', '');
          const tattachMsg = build9PMessage(Tattach, 0, tattachBody);
          await writer.write(tattachMsg);

          const attachData = await readFromSocket(reader, timeoutPromise);
          const attachMsg = parse9PMessage(attachData);

          if (attachMsg && attachMsg.type === Rattach) {
            // Rattach body: [qid:13bytes]
            result.rootQid = parseQID(attachMsg.body, 0);
          } else if (attachMsg && attachMsg.type === Rerror) {
            const [errMsg] = parse9PString(attachMsg.body, 0);
            result.error = `Attach failed: ${errMsg}`;
          }
        } catch {
          // Attach failure is non-fatal
        }
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } satisfies NinePResponse),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

// ─── Additional message builders ────────────────────────────────────────────

/** Twalk: navigate a path relative to fid, producing newFid */
function buildTwalk(fid: number, newFid: number, pathComponents: string[]): Uint8Array {
  // Validate path components for security
  if (pathComponents.length > 16) {
    throw new Error('Path depth exceeds maximum (16 components)');
  }
  for (const component of pathComponents) {
    if (component === '' || component === '.' || component === '..') {
      throw new Error('Invalid path component: empty, ".", or ".." not allowed');
    }
    if (component.includes('/') || component.includes('\0')) {
      throw new Error('Invalid path component: contains "/" or null byte');
    }
    if (component.length > 255) {
      throw new Error('Path component exceeds maximum length (255)');
    }
  }

  const enc = new TextEncoder();
  // Body: fid(4) + newFid(4) + nwname(2) + [wname strings...]
  const nameBuffers = pathComponents.map(p => enc.encode(p));
  const bodyLen = 4 + 4 + 2 + nameBuffers.reduce((s, b) => s + 2 + b.length, 0);
  const body = new Uint8Array(bodyLen);
  const view = new DataView(body.buffer);
  let off = 0;
  view.setUint32(off, fid, true); off += 4;
  view.setUint32(off, newFid, true); off += 4;
  view.setUint16(off, pathComponents.length, true); off += 2;
  for (const nb of nameBuffers) {
    view.setUint16(off, nb.length, true); off += 2;
    body.set(nb, off); off += nb.length;
  }
  return body;
}

/** Topen: open a fid with mode (0=read, 1=write, 2=rdwr, 3=exec) */
function buildTopen(fid: number, mode: number): Uint8Array {
  const body = new Uint8Array(5);
  const view = new DataView(body.buffer);
  view.setUint32(0, fid, true);
  body[4] = mode;
  return body;
}

/** Tread: read count bytes at offset from fid */
function buildTread(fid: number, offset: number, count: number): Uint8Array {
  const body = new Uint8Array(16);
  const view = new DataView(body.buffer);
  view.setUint32(0, fid, true);
  view.setUint32(4, offset, true);   // offset low 32 bits
  view.setUint32(8, 0, true);        // offset high 32 bits
  view.setUint32(12, count, true);
  return body;
}

/** Tstat: query stat for fid */
function buildTstat(fid: number): Uint8Array {
  const body = new Uint8Array(4);
  new DataView(body.buffer).setUint32(0, fid, true);
  return body;
}

/** Tclunk: release fid */
function buildTclunk(fid: number): Uint8Array {
  const body = new Uint8Array(4);
  new DataView(body.buffer).setUint32(0, fid, true);
  return body;
}

interface Stat9P {
  type: number;
  dev: number;
  qid: { type: number; version: number; path: string };
  mode: number;
  atime: number;
  mtime: number;
  length: string;
  name: string;
  uid: string;
  gid: string;
  muid: string;
}

/**
 * Parse a single 9P2000 stat structure.
 *
 * A raw stat is: size[2] type[2] dev[4] qid[13] mode[4] atime[4] mtime[4]
 *                length[8] name[s] uid[s] gid[s] muid[s]
 *
 * The offset must point at the stat's own size[2] prefix.
 *
 * NOTE: Rstat body = nstat[2] + stat_bytes. The caller must skip the
 * leading nstat[2] before calling this function (i.e. pass offset=2
 * for Rstat, or the current offset within concatenated dir-read data).
 */
function parseStat(body: Uint8Array, offset: number): Stat9P | null {
  if (offset + 2 > body.length) return null;
  const view = new DataView(body.buffer, body.byteOffset);
  // outer stat size word
  offset += 2;
  if (offset + 2 > body.length) return null;
  const type = view.getUint16(offset, true); offset += 2;
  if (offset + 4 > body.length) return null;
  const dev = view.getUint32(offset, true); offset += 4;
  const qid = parseQID(body, offset); offset += 13;
  if (offset + 4 > body.length) return null;
  const mode = view.getUint32(offset, true); offset += 4;
  if (offset + 4 > body.length) return null;
  const atime = view.getUint32(offset, true); offset += 4;
  if (offset + 4 > body.length) return null;
  const mtime = view.getUint32(offset, true); offset += 4;
  // length is uint64LE
  if (offset + 8 > body.length) return null;
  const lenLo = view.getUint32(offset, true);
  const lenHi = view.getUint32(offset + 4, true);
  // Use BigInt to avoid precision loss for large files
  const length = lenHi !== 0
    ? (BigInt(lenHi) * BigInt(0x100000000) + BigInt(lenLo)).toString()
    : lenLo.toString();
  offset += 8;
  const [name, ns] = parse9PString(body, offset); offset += ns;
  const [uid, us] = parse9PString(body, offset); offset += us;
  const [gid, gs] = parse9PString(body, offset); offset += gs;
  const [muid] = parse9PString(body, offset);
  return { type, dev, qid, mode, atime, mtime, length, name, uid, gid, muid };
}

/**
 * Read from socket accumulating chunks until we have a complete 9P message.
 * Returns the first complete message bytes.
 */
async function read9PMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  const deadline = Date.now() + timeoutMs;
  let buf = new Uint8Array(0);

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const timer = new Promise<{ value: undefined; done: true }>((resolve) =>
      setTimeout(() => resolve({ value: undefined, done: true }), remaining),
    );
    const { value, done } = await Promise.race([reader.read(), timer]);
    if (done || !value) break;

    const next = new Uint8Array(buf.length + value.length);
    next.set(buf); next.set(value, buf.length);
    buf = next;

    // Check if we have a complete message
    if (buf.length >= 4) {
      const size = new DataView(buf.buffer, buf.byteOffset).getUint32(0, true);
      if (buf.length >= size) return buf.slice(0, size);
    }
  }
  return buf;
}

/**
 * Perform version + attach handshake, returns { reader, writer, rootFid, msize }
 */
async function ninePHandshake(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  timeoutMs: number,
): Promise<{ rootFid: number; msize: number }> {
  const startTime = Date.now();
  const timeLeft = () => Math.max(timeoutMs - (Date.now() - startTime), 1000);

  const tvBody = buildTversion(DEFAULT_MSIZE);
  await writer.write(build9PMessage(Tversion, NOTAG, tvBody));
  const rvData = await read9PMessage(reader, timeLeft());
  const rv = parse9PMessage(rvData);
  if (!rv || rv.type !== Rversion) throw new Error(`Expected Rversion, got type ${rv?.type}`);
  const rvView = new DataView(rv.body.buffer, rv.body.byteOffset);
  const msize = rvView.getUint32(0, true);

  const rootFid = 1;
  const taBody = buildTattach(rootFid, NOFID, 'anonymous', '');
  await writer.write(build9PMessage(Tattach, 1, taBody));
  const raData = await read9PMessage(reader, timeLeft());
  const ra = parse9PMessage(raData);
  if (!ra || (ra.type !== Rattach && ra.type !== Rerror)) {
    throw new Error(`Expected Rattach, got type ${ra?.type}`);
  }
  if (ra.type === Rerror) {
    const [errMsg] = parse9PString(ra.body, 0);
    throw new Error(`Attach failed: ${errMsg}`);
  }
  return { rootFid, msize };
}

// ─── POST /api/9p/stat ───────────────────────────────────────────────────────

/**
 * Walk to a path and stat the target file or directory.
 *
 * POST /api/9p/stat
 * Body: { host, port?, path?, timeout? }
 *   path — slash-separated path e.g. "usr/local/bin" (default: "" = root)
 *
 * Flow: Tversion → Tattach (root fid=1) → Twalk (path, newFid=2) → Tstat → Tclunk
 */
export async function handle9PStat(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = (await request.json()) as { host?: string; port?: number; path?: string; timeout?: number };
    const host = (body.host ?? '').trim();
    const port = body.port ?? 564;
    const pathStr = (body.path ?? '').replace(/^\/+|\/+$/g, '');
    const timeout = Math.min(body.timeout ?? 10000, 30000);

    const err = validateInput(host, port);
    if (err) return new Response(JSON.stringify({ success: false, error: err }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));
    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, timeoutPromise]);

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    try {
      const { rootFid } = await ninePHandshake(reader, writer, timeout);

      const pathComponents = pathStr ? pathStr.split('/').filter(Boolean) : [];
      const targetFid = rootFid + 1;
      let stat: Stat9P | null = null;

      if (pathComponents.length === 0) {
        // Stat the root directly
        await writer.write(build9PMessage(Tstat, 2, buildTstat(rootFid)));
        const rsData = await read9PMessage(reader, 5000);
        const rs = parse9PMessage(rsData);
        // Rstat body = nstat[2] + stat_data; parseStat expects offset at the stat size field
        if (rs && rs.type === Rstat) {
          // Skip the 2-byte nstat prefix (should be the stat size + 2)
          if (rs.body.length < 2) throw new Error('Rstat response too short');
          stat = parseStat(rs.body, 2);
        }
      } else {
        // Walk to path
        await writer.write(build9PMessage(Twalk, 2, buildTwalk(rootFid, targetFid, pathComponents)));
        const rwData = await read9PMessage(reader, 5000);
        const rw = parse9PMessage(rwData);
        if (!rw || rw.type !== Rwalk) {
          if (rw?.type === Rerror) {
            const [errMsg] = parse9PString(rw.body, 0);
            throw new Error(`Walk failed: ${errMsg}`);
          }
          throw new Error(`Walk failed: unexpected type ${rw?.type}`);
        }

        await writer.write(build9PMessage(Tstat, 3, buildTstat(targetFid)));
        const rsData = await read9PMessage(reader, 5000);
        const rs = parse9PMessage(rsData);
        if (rs && rs.type === Rstat) {
          // Rstat body = nstat[2] + stat_data; skip the 2-byte nstat prefix
          if (rs.body.length < 2) throw new Error('Rstat response too short');
          stat = parseStat(rs.body, 2);
        }

        // Clunk the new fid
        try { await writer.write(build9PMessage(Tclunk, 4, buildTclunk(targetFid))); } catch { /* ignore */ }
      }

      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host, port,
        path: pathStr || '/',
        stat,
      }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { writer.releaseLock(); } catch { /* ignore */ }
      socket.close();
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── POST /api/9p/read ───────────────────────────────────────────────────────

/**
 * Walk to a file path, open it, and read its contents.
 *
 * POST /api/9p/read
 * Body: { host, port?, path, offset?, count?, timeout? }
 *   path   — slash-separated path to file (required)
 *   offset — byte offset to start reading (default: 0)
 *   count  — max bytes to read (default: 4096, max: 65536)
 *
 * Flow: Tversion → Tattach → Twalk → Topen → Tread → Tclunk
 */
export async function handle9PRead(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = (await request.json()) as {
      host?: string; port?: number; path?: string;
      offset?: number; count?: number; timeout?: number;
    };
    const host = (body.host ?? '').trim();
    const port = body.port ?? 564;
    const pathStr = (body.path ?? '').replace(/^\/+|\/+$/g, '');
    const readOffset = Math.max(0, body.offset ?? 0);
    const readCount = Math.min(Math.max(1, body.count ?? 4096), 65536);
    const timeout = Math.min(body.timeout ?? 15000, 30000);

    const err = validateInput(host, port);
    if (err) return new Response(JSON.stringify({ success: false, error: err }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!pathStr) return new Response(JSON.stringify({ success: false, error: 'path is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));
    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, timeoutPromise]);

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    try {
      const { rootFid } = await ninePHandshake(reader, writer, timeout);

      const pathComponents = pathStr.split('/').filter(Boolean);
      const fileFid = rootFid + 1;

      // Walk to path
      await writer.write(build9PMessage(Twalk, 2, buildTwalk(rootFid, fileFid, pathComponents)));
      const rwData = await read9PMessage(reader, 5000);
      const rw = parse9PMessage(rwData);
      if (!rw || rw.type !== Rwalk) {
        if (rw?.type === Rerror) {
          const [errMsg] = parse9PString(rw.body, 0);
          throw new Error(`Walk failed: ${errMsg}`);
        }
        throw new Error(`Walk failed: unexpected type ${rw?.type}`);
      }

      // Open the file (mode 0 = read)
      await writer.write(build9PMessage(Topen, 3, buildTopen(fileFid, 0)));
      const roData = await read9PMessage(reader, 5000);
      const ro = parse9PMessage(roData);
      if (!ro || ro.type !== Ropen) {
        if (ro?.type === Rerror) {
          const [errMsg] = parse9PString(ro.body, 0);
          throw new Error(`Open failed: ${errMsg}`);
        }
        throw new Error(`Open failed: unexpected type ${ro?.type}`);
      }

      // Read the file
      await writer.write(build9PMessage(Tread, 4, buildTread(fileFid, readOffset, readCount)));
      const rrData = await read9PMessage(reader, 8000);
      const rr = parse9PMessage(rrData);

      let data: string | undefined;
      let bytesRead = 0;
      if (rr && rr.type === Rread && rr.body.length >= 4) {
        const rrView = new DataView(rr.body.buffer, rr.body.byteOffset);
        bytesRead = rrView.getUint32(0, true);
        const dataBytes = rr.body.slice(4, 4 + bytesRead);
        // Return as base64 for binary safety
        let binary = '';
        for (let i = 0; i < dataBytes.length; i++) {
          binary += String.fromCharCode(dataBytes[i]);
        }
        data = btoa(binary);
      } else if (rr?.type === Rerror) {
        const [errMsg] = parse9PString(rr.body, 0);
        throw new Error(`Read failed: ${errMsg}`);
      }

      // Clunk the fid
      try { await writer.write(build9PMessage(Tclunk, 5, buildTclunk(fileFid))); } catch { /* ignore */ }

      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host, port,
        path: '/' + pathStr,
        offset: readOffset,
        bytesRead,
        data,
        encoding: 'base64',
      }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { writer.releaseLock(); } catch { /* ignore */ }
      socket.close();
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── POST /api/9p/ls ─────────────────────────────────────────────────────────

/**
 * Walk to a directory and read its directory entries (stat records).
 *
 * POST /api/9p/ls
 * Body: { host, port?, path?, timeout? }
 *   path — directory path (default: "" = root)
 *
 * Flow: Tversion → Tattach → Twalk (if path) → Topen (mode 0) → Tread (dir) → Tclunk
 *
 * In 9P, reading a directory returns concatenated stat structures.
 */
export async function handle9PLs(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = (await request.json()) as { host?: string; port?: number; path?: string; timeout?: number };
    const host = (body.host ?? '').trim();
    const port = body.port ?? 564;
    const pathStr = (body.path ?? '').replace(/^\/+|\/+$/g, '');
    const timeout = Math.min(body.timeout ?? 15000, 30000);

    const err = validateInput(host, port);
    if (err) return new Response(JSON.stringify({ success: false, error: err }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));
    const socket = connect(`${host}:${port}`);
    await Promise.race([socket.opened, timeoutPromise]);

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    try {
      const { rootFid, msize } = await ninePHandshake(reader, writer, timeout);

      const pathComponents = pathStr ? pathStr.split('/').filter(Boolean) : [];
      let dirFid = rootFid;

      if (pathComponents.length > 0) {
        const newFid = rootFid + 1;
        await writer.write(build9PMessage(Twalk, 2, buildTwalk(rootFid, newFid, pathComponents)));
        const rwData = await read9PMessage(reader, 5000);
        const rw = parse9PMessage(rwData);
        if (!rw || rw.type !== Rwalk) {
          if (rw?.type === Rerror) {
            const [errMsg] = parse9PString(rw.body, 0);
            throw new Error(`Walk failed: ${errMsg}`);
          }
          throw new Error(`Walk failed: unexpected type ${rw?.type}`);
        }
        dirFid = newFid;
      }

      // Open directory (mode 0 = read)
      await writer.write(build9PMessage(Topen, 3, buildTopen(dirFid, 0)));
      const roData = await read9PMessage(reader, 5000);
      const ro = parse9PMessage(roData);
      if (!ro || ro.type !== Ropen) {
        if (ro?.type === Rerror) {
          const [errMsg] = parse9PString(ro.body, 0);
          throw new Error(`Open failed: ${errMsg}`);
        }
        throw new Error(`Open dir failed: unexpected type ${ro?.type}`);
      }

      // Read directory — request up to msize bytes
      const dirReadCount = Math.min(msize - 11, 65525); // msize - header overhead
      await writer.write(build9PMessage(Tread, 4, buildTread(dirFid, 0, dirReadCount)));
      const rrData = await read9PMessage(reader, 8000);
      const rr = parse9PMessage(rrData);

      const entries: Stat9P[] = [];
      if (rr && rr.type === Rread && rr.body.length >= 4) {
        const rrView = new DataView(rr.body.buffer, rr.body.byteOffset);
        const bytesRead = rrView.getUint32(0, true);
        // Parse stat records from the data
        let off = 4;
        const dataEnd = 4 + bytesRead;
        while (off + 2 < dataEnd) {
          const statSize = new DataView(rr.body.buffer, rr.body.byteOffset + off).getUint16(0, true);
          if (statSize < 2 || off + 2 + statSize > dataEnd) break;
          const s = parseStat(rr.body, off);
          if (s) entries.push(s);
          off += 2 + statSize;
        }
      } else if (rr?.type === Rerror) {
        const [errMsg] = parse9PString(rr.body, 0);
        throw new Error(`Read dir failed: ${errMsg}`);
      }

      // Clunk the fid
      try { await writer.write(build9PMessage(Tclunk, 5, buildTclunk(dirFid))); } catch { /* ignore */ }

      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host, port,
        path: '/' + pathStr,
        count: entries.length,
        entries,
      }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      try { reader.releaseLock(); } catch { /* ignore */ }
      try { writer.releaseLock(); } catch { /* ignore */ }
      socket.close();
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
