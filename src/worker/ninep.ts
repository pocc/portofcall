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
 *   106     = Rerror              (error response)
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
  const view = new DataView(body.buffer, body.byteOffset);
  const len = view.getUint16(offset, true);
  const str = new TextDecoder().decode(body.slice(offset + 2, offset + 2 + len));
  return [str, 2 + len];
}

/**
 * Parse a QID (13 bytes: type:uint8 + version:uint32LE + path:uint64LE)
 */
function parseQID(body: Uint8Array, offset: number): { type: number; version: number; path: string } {
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
