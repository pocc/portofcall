/**
 * NFS Protocol Implementation (ONC-RPC over TCP)
 *
 * NFS (Network File System) uses the ONC-RPC (Open Network Computing Remote
 * Procedure Call) protocol. Over TCP, RPC messages use Record Marking: a
 * 4-byte header with last-fragment bit (bit 31) and 31-bit fragment length,
 * followed by the XDR-encoded RPC message.
 *
 * Protocol Flow:
 * 1. Client connects to NFS server (port 2049)
 * 2. Client sends RPC CALL with Record Marking framing
 * 3. Server responds with RPC REPLY
 * 4. Parse XDR-encoded response
 *
 * Use Cases:
 * - NFS service detection and version probing (NULL calls)
 * - Export list discovery (MOUNT EXPORT procedure)
 * - NFS server health checking
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// RPC constants
const RPC_VERSION = 2;
const MSG_CALL = 0;
const MSG_REPLY = 1;
const MSG_ACCEPTED = 0;

// Accept stat values
const ACCEPT_SUCCESS = 0;
const ACCEPT_PROG_MISMATCH = 2;

// Program numbers
const NFS_PROGRAM = 100003;
const MOUNT_PROGRAM = 100005;

// Procedure numbers
const PROC_NULL = 0;
const MOUNTPROC_MNT = 1;
const MOUNTPROC_EXPORT = 5;

// NFSv3 procedures
const NFSPROC3_GETATTR = 1;
const NFSPROC3_LOOKUP = 3;
const NFSPROC3_READ = 6;
const NFSPROC3_WRITE = 7;
// const NFSPROC3_CREATE = 8;    // Reserved for future use
// const NFSPROC3_MKDIR = 9;     // Reserved for future use
// const NFSPROC3_REMOVE = 12;   // Reserved for future use
// const NFSPROC3_RMDIR = 13;    // Reserved for future use
// const NFSPROC3_RENAME = 14;   // Reserved for future use
const NFSPROC3_READDIR = 16;
const NFS3_FILE_SYNC = 2; // stable_how: write synchronously

// NFSv3 create modes (reserved for future use)
// const UNCHECKED = 0;
// const GUARDED = 1;
// const EXCLUSIVE = 2;

// NFSv3 file types
const NF3_FILE_TYPES: Record<number, string> = {
  1: 'REG',
  2: 'DIR',
  3: 'BLK',
  4: 'CHR',
  5: 'LNK',
  6: 'SOCK',
  7: 'FIFO',
};

// Accept stat names
const ACCEPT_STAT_NAMES: Record<number, string> = {
  0: 'SUCCESS',
  1: 'PROG_UNAVAIL',
  2: 'PROG_MISMATCH',
  3: 'PROC_UNAVAIL',
  4: 'GARBAGE_ARGS',
  5: 'SYSTEM_ERR',
};

/**
 * Build an RPC CALL message (XDR encoded)
 */
function buildRpcCall(
  xid: number,
  program: number,
  version: number,
  procedure: number,
  data?: Uint8Array,
): Uint8Array {
  // 10 uint32 fields: xid, msg_type, rpc_ver, prog, ver, proc, cred_flavor, cred_len, verf_flavor, verf_len
  const headerSize = 10 * 4;
  const dataSize = data ? data.length : 0;
  const message = new Uint8Array(headerSize + dataSize);
  const view = new DataView(message.buffer);

  let offset = 0;
  view.setUint32(offset, xid); offset += 4;
  view.setUint32(offset, MSG_CALL); offset += 4;
  view.setUint32(offset, RPC_VERSION); offset += 4;
  view.setUint32(offset, program); offset += 4;
  view.setUint32(offset, version); offset += 4;
  view.setUint32(offset, procedure); offset += 4;
  // AUTH_NULL credential
  view.setUint32(offset, 0); offset += 4; // flavor = AUTH_NULL
  view.setUint32(offset, 0); offset += 4; // length = 0
  // AUTH_NULL verifier
  view.setUint32(offset, 0); offset += 4; // flavor = AUTH_NULL
  view.setUint32(offset, 0); offset += 4; // length = 0

  if (data) {
    message.set(data, offset);
  }

  return message;
}

/**
 * Frame an RPC message for TCP Record Marking
 * Bit 31 = last fragment (1), bits 0-30 = fragment length
 */
function frameRpcMessage(message: Uint8Array): Uint8Array {
  const framed = new Uint8Array(4 + message.length);
  const view = new DataView(framed.buffer);
  view.setUint32(0, 0x80000000 | message.length);
  framed.set(message, 4);
  return framed;
}

/**
 * Parse an RPC reply from TCP data
 */
interface RpcReply {
  xid: number;
  accepted: boolean;
  acceptStat?: number;
  acceptStatName?: string;
  mismatchLow?: number;
  mismatchHigh?: number;
  data?: Uint8Array;
  rejectStat?: number;
}

function parseRpcReply(data: Uint8Array): RpcReply | null {
  if (data.length < 4) return null;

  let offset = 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Check for Record Marking header (bit 31 set = last fragment)
  const firstWord = view.getUint32(0);
  if (firstWord & 0x80000000) {
    offset = 4;
  }

  if (data.length < offset + 12) return null;

  const xid = view.getUint32(offset); offset += 4;
  const msgType = view.getUint32(offset); offset += 4;
  if (msgType !== MSG_REPLY) return null;

  const replyStat = view.getUint32(offset); offset += 4;

  if (replyStat === MSG_ACCEPTED) {
    if (data.length < offset + 8) return { xid, accepted: true };

    // Read verifier
    offset += 4; // verifier flavor
    const verifLen = view.getUint32(offset); offset += 4;
    offset += verifLen; // skip verifier data

    if (data.length < offset + 4) return { xid, accepted: true };
    const acceptStat = view.getUint32(offset); offset += 4;

    const result: RpcReply = {
      xid,
      accepted: true,
      acceptStat,
      acceptStatName: ACCEPT_STAT_NAMES[acceptStat] || `UNKNOWN(${acceptStat})`,
    };

    if (acceptStat === ACCEPT_PROG_MISMATCH && data.length >= offset + 8) {
      result.mismatchLow = view.getUint32(offset); offset += 4;
      result.mismatchHigh = view.getUint32(offset); offset += 4;
    }

    if (acceptStat === ACCEPT_SUCCESS && offset < data.length) {
      result.data = data.slice(offset);
    }

    return result;
  } else {
    // MSG_DENIED
    const rejectStat = data.length >= offset + 4 ? view.getUint32(offset) : undefined;
    return { xid, accepted: false, rejectStat };
  }
}

/**
 * Send an RPC call and receive reply over TCP
 */
async function sendRpcCall(
  host: string,
  port: number,
  program: number,
  version: number,
  procedure: number,
  data?: Uint8Array,
  timeout = 10000,
): Promise<RpcReply | null> {
  const xid = Math.floor(Math.random() * 0xFFFFFFFF);
  const message = buildRpcCall(xid, program, version, procedure, data);
  const framed = frameRpcMessage(message);

  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  await writer.write(framed);

  let responseData: Uint8Array | null = null;
  try {
    const readResult = await Promise.race([reader.read(), timeoutPromise]);
    if (readResult.value) {
      responseData = readResult.value;
    }
  } catch {
    // timeout
  }

  writer.releaseLock();
  reader.releaseLock();
  socket.close();

  if (!responseData) return null;
  return parseRpcReply(responseData);
}

/**
 * Parse MOUNT EXPORT reply - list of exported filesystems
 * XDR format: linked list of (dirpath string, groups linked list)
 */
function parseMountExports(data: Uint8Array): Array<{ path: string; groups: string[] }> {
  const exports: Array<{ path: string; groups: string[] }> = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  while (offset + 4 <= data.length) {
    // "follows" indicator (1 = more entries, 0 = end of list)
    const follows = view.getUint32(offset); offset += 4;
    if (follows === 0) break;

    // Read directory path (XDR string: uint32 length + data padded to 4 bytes)
    if (offset + 4 > data.length) break;
    const pathLen = view.getUint32(offset); offset += 4;
    if (offset + pathLen > data.length) break;
    const path = new TextDecoder().decode(data.slice(offset, offset + pathLen));
    offset += pathLen;
    offset += (4 - (pathLen % 4)) % 4; // pad to 4-byte boundary

    // Read groups linked list
    const groups: string[] = [];
    while (offset + 4 <= data.length) {
      const groupFollows = view.getUint32(offset); offset += 4;
      if (groupFollows === 0) break;

      if (offset + 4 > data.length) break;
      const groupLen = view.getUint32(offset); offset += 4;
      if (offset + groupLen > data.length) break;
      const group = new TextDecoder().decode(data.slice(offset, offset + groupLen));
      offset += groupLen;
      offset += (4 - (groupLen % 4)) % 4;

      groups.push(group);
    }

    exports.push({ path, groups });
  }

  return exports;
}

/**
 * Encode an XDR string (uint32 length + data + padding to 4-byte boundary)
 */
function xdrEncodeString(str: string): Uint8Array {
  const encoded = new TextEncoder().encode(str);
  const padded = Math.ceil(encoded.length / 4) * 4;
  const result = new Uint8Array(4 + padded);
  const view = new DataView(result.buffer);
  view.setUint32(0, encoded.length);
  result.set(encoded, 4);
  return result;
}

/**
 * Encode a file handle as XDR opaque data (uint32 length + bytes + padding)
 */
function xdrEncodeFileHandle(fh: Uint8Array): Uint8Array {
  const padded = Math.ceil(fh.length / 4) * 4;
  const result = new Uint8Array(4 + padded);
  const view = new DataView(result.buffer);
  view.setUint32(0, fh.length);
  result.set(fh, 4);
  return result;
}
/**
 * Parse MOUNT MNT reply to get the root file handle
 * XDR format: status(uint32) + fhandle(opaque, variable length in v3)
 */
function parseMountMntReply(data: Uint8Array): Uint8Array | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  if (data.length < 4) return null;
  const status = view.getUint32(offset); offset += 4;
  if (status !== 0) return null; // non-zero = error

  // MNTv3: variable-length opaque file handle (uint32 len + bytes)
  // MNTv1: fixed 32-byte file handle
  if (offset + 4 > data.length) return null;

  // Try variable-length first (v3)
  const fhLen = view.getUint32(offset);
  if (fhLen > 0 && fhLen <= 64 && offset + 4 + fhLen <= data.length) {
    offset += 4;
    return data.slice(offset, offset + fhLen);
  }

  // Fallback: fixed 32-byte handle (v1)
  if (offset + 32 <= data.length) {
    // The status was 0, next 32 bytes are the file handle (no length prefix in v1)
    return data.slice(offset, offset + 32);
  }

  return null;
}

/**
 * Read an XDR uint64 as two uint32s (high, low) — returns number (approx)
 */
function xdrReadUint64(view: DataView, offset: number): number {
  const hi = view.getUint32(offset);
  const lo = view.getUint32(offset + 4);
  return hi * 0x100000000 + lo;
}

/**
 * Parse NFSv3 fattr3 structure (starting at offset in data)
 * Returns parsed attributes and next offset
 */
function parseFattr3(data: Uint8Array, offset: number): {
  ftype: number;
  ftypeName: string;
  mode: number;
  modeStr: string;
  nlink: number;
  uid: number;
  gid: number;
  size: number;
  blocksize: number;
  rdev: number;
  blocks: number;
  fsid: number;
  fileid: number;
  atime: number;
  mtime: number;
  ctime: number;
  nextOffset: number;
} | null {
  // fattr3: ftype(4) mode(4) nlink(4) uid(4) gid(4) size(8) used(8) rdev(8)
  //         fsid(8) fileid(8) atime(8) mtime(8) ctime(8) = 84 bytes minimum
  if (offset + 84 > data.length) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const ftype = view.getUint32(offset); offset += 4;
  const mode = view.getUint32(offset); offset += 4;
  const nlink = view.getUint32(offset); offset += 4;
  const uid = view.getUint32(offset); offset += 4;
  const gid = view.getUint32(offset); offset += 4;
  const size = xdrReadUint64(view, offset); offset += 8;
  offset += 8; // used (skip)
  offset += 8; // rdev specdata1+specdata2 (skip)
  const fsid = xdrReadUint64(view, offset); offset += 8;
  const fileid = xdrReadUint64(view, offset); offset += 8;
  // atime: seconds(4) + nseconds(4)
  const atime = view.getUint32(offset); offset += 8;
  const mtime = view.getUint32(offset); offset += 8;
  const ctime = view.getUint32(offset); offset += 8;

  // Build mode string like ls -l
  const ftypeName = NF3_FILE_TYPES[ftype] || `UNKNOWN(${ftype})`;
  const typeChar: Record<string, string> = {
    REG: '-', DIR: 'd', BLK: 'b', CHR: 'c', LNK: 'l', SOCK: 's', FIFO: 'p',
  };
  const tc = typeChar[ftypeName] ?? '?';
  const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  const modeStr = tc +
    perms[(mode >> 6) & 7] +
    perms[(mode >> 3) & 7] +
    perms[mode & 7];

  return {
    ftype,
    ftypeName,
    mode,
    modeStr,
    nlink,
    uid,
    gid,
    size,
    blocksize: 4096, // NFSv3 fattr3 doesn't include blocksize directly
    rdev: 0,
    blocks: 0,
    fsid,
    fileid,
    atime,
    mtime,
    ctime,
    nextOffset: offset,
  };
}

/**
 * Mount an export path and return the root file handle.
 * Uses MOUNT protocol v3 (MNT procedure = 1) or falls back to v1.
 */
async function mountExportPath(
  host: string,
  mountPort: number,
  exportPath: string,
  timeout: number,
): Promise<Uint8Array | null> {
  const pathArg = xdrEncodeString(exportPath);

  for (const ver of [3, 1]) {
    const reply = await sendRpcCall(
      host, mountPort, MOUNT_PROGRAM, ver, MOUNTPROC_MNT, pathArg, timeout,
    );
    if (reply && reply.accepted && reply.acceptStat === ACCEPT_SUCCESS && reply.data) {
      const fh = parseMountMntReply(reply.data);
      if (fh) return fh;
    }
  }
  return null;
}

/**
 * Handle NFS probe - detect supported NFS versions via NULL calls
 */
export async function handleNFSProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 2049, timeout = 10000 } = body;

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
    const versions: Record<string, {
      supported: boolean;
      rtt?: number;
      error?: string;
      mismatch?: { low: number; high: number };
    }> = {};

    // Try NULL call for each NFS version (v4, v3, v2)
    for (const ver of [4, 3, 2]) {
      const verStart = Date.now();
      try {
        const reply = await sendRpcCall(host, port, NFS_PROGRAM, ver, PROC_NULL, undefined, timeout);
        const verRtt = Date.now() - verStart;

        if (reply) {
          if (reply.accepted && reply.acceptStat === ACCEPT_SUCCESS) {
            versions[`v${ver}`] = { supported: true, rtt: verRtt };
          } else if (reply.accepted && reply.acceptStat === ACCEPT_PROG_MISMATCH) {
            versions[`v${ver}`] = {
              supported: false,
              rtt: verRtt,
              error: 'PROG_MISMATCH',
              mismatch: reply.mismatchLow !== undefined ? {
                low: reply.mismatchLow,
                high: reply.mismatchHigh!,
              } : undefined,
            };
          } else {
            versions[`v${ver}`] = {
              supported: false,
              rtt: verRtt,
              error: reply.acceptStatName || 'unknown',
            };
          }
        } else {
          versions[`v${ver}`] = { supported: false, error: 'no response' };
        }
      } catch (err) {
        versions[`v${ver}`] = {
          supported: false,
          error: err instanceof Error ? err.message : 'failed',
        };
      }
    }

    const totalRtt = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt: totalRtt,
      versions,
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

/**
 * Handle NFS exports list - uses MOUNT protocol EXPORT procedure
 * The MOUNT service may be on port 2049 (same as NFS) or a separate port.
 * NFSv4 doesn't use the mount protocol, but many servers still support it.
 */
export async function handleNFSExports(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      mountPort?: number;
      timeout?: number;
    };

    const { host, port = 2049, mountPort, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
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
    const targetPort = mountPort || port;

    // Try MOUNT EXPORT with different mount protocol versions (v3, then v1)
    let exports: Array<{ path: string; groups: string[] }> = [];
    let mountVersion = 0;
    let exportError = '';

    for (const ver of [3, 1]) {
      try {
        const reply = await sendRpcCall(
          host, targetPort, MOUNT_PROGRAM, ver, MOUNTPROC_EXPORT, undefined, timeout,
        );
        if (reply && reply.accepted && reply.acceptStat === ACCEPT_SUCCESS && reply.data) {
          exports = parseMountExports(reply.data);
          mountVersion = ver;
          break;
        }
      } catch (err) {
        exportError = err instanceof Error ? err.message : 'failed';
      }
    }

    const rtt = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: true,
      host,
      port: targetPort,
      rtt,
      mountVersion: mountVersion || null,
      exports,
      error: exports.length === 0
        ? (exportError || 'No exports found or mount protocol not available')
        : undefined,
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

/**
 * Handle NFSv3 LOOKUP — resolve a filename within an exported directory.
 *
 * Flow:
 *  1. MOUNT MNT(exportPath) → root file handle
 *  2. NFSv3 LOOKUP(proc 3) with root file handle + filename → child file handle + attributes
 *
 * Request body: { host, port?, timeout?, exportPath, path }
 * Response:     { fileHandle, type, mode, size, uid, gid, mtime, rtt }
 */
export async function handleNFSLookup(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      exportPath: string;
      path: string;
    };

    const { host, port = 2049, timeout = 10000, exportPath, path } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!exportPath) {
      return new Response(JSON.stringify({ success: false, error: 'exportPath is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!path) {
      return new Response(JSON.stringify({ success: false, error: 'path is required' }), {
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

    // Step 1: MOUNT to get root file handle
    const rootFH = await mountExportPath(host, port, exportPath, timeout);
    if (!rootFH) {
      return new Response(JSON.stringify({
        success: false,
        error: `MOUNT failed for export path: ${exportPath}`,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Step 2: NFSv3 LOOKUP (proc 3)
    // diropargs3: { dir: nfs_fh3, name: filename3 }
    // nfs_fh3 = XDR opaque<>: uint32 length + bytes (padded to 4-byte boundary)
    // filename3 = XDR string: uint32 length + bytes (padded to 4-byte boundary)
    const fhEncoded = xdrEncodeFileHandle(rootFH);
    // Strip leading slash from path for the lookup filename
    const filename = path.replace(/^\//, '');
    const nameEncoded = xdrEncodeString(filename);
    const lookupArgs = new Uint8Array(fhEncoded.length + nameEncoded.length);
    lookupArgs.set(fhEncoded, 0);
    lookupArgs.set(nameEncoded, fhEncoded.length);

    const reply = await sendRpcCall(
      host, port, NFS_PROGRAM, 3, NFSPROC3_LOOKUP, lookupArgs, timeout,
    );

    const rtt = Date.now() - startTime;

    if (!reply || !reply.accepted || reply.acceptStat !== ACCEPT_SUCCESS || !reply.data) {
      return new Response(JSON.stringify({
        success: false,
        error: reply
          ? `NFSv3 LOOKUP failed: ${reply.acceptStatName}`
          : 'No reply from NFS server',
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Parse LOOKUP3res:
    //   status(4) + [on success] object_fh(opaque<>) + obj_attributes(post_op_attr)
    // post_op_attr: follows(4) + [if follows==1] fattr3(84 bytes)
    const replyData = reply.data;
    if (replyData.length < 4) {
      return new Response(JSON.stringify({ success: false, error: 'LOOKUP reply too short', rtt }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const replyView = new DataView(replyData.buffer, replyData.byteOffset, replyData.byteLength);
    let replyOff = 0;

    const nfsStatus = replyView.getUint32(replyOff); replyOff += 4;
    if (nfsStatus !== 0) {
      return new Response(JSON.stringify({
        success: false,
        error: `NFSv3 LOOKUP error status: ${nfsStatus}`,
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Read object file handle (variable-length opaque)
    if (replyOff + 4 > replyData.length) {
      return new Response(JSON.stringify({ success: false, error: 'Truncated LOOKUP reply', rtt }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const objFhLen = replyView.getUint32(replyOff); replyOff += 4;
    if (objFhLen > 64 || replyOff + objFhLen > replyData.length) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid file handle length', rtt }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const objFh = replyData.slice(replyOff, replyOff + objFhLen);
    replyOff += objFhLen;
    // Pad to 4-byte boundary
    replyOff += (4 - (objFhLen % 4)) % 4;

    // Read post_op_attr for the object
    let attrs: ReturnType<typeof parseFattr3> | null = null;
    if (replyOff + 4 <= replyData.length) {
      const attrFollows = replyView.getUint32(replyOff); replyOff += 4;
      if (attrFollows === 1) {
        attrs = parseFattr3(replyData, replyOff);
      }
    }

    const fileHandleHex = Array.from(objFh)
      .map(b => b.toString(16).padStart(2, '0')).join('');

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      exportPath,
      path,
      fileHandle: fileHandleHex,
      type: attrs?.ftypeName ?? null,
      mode: attrs ? `0${attrs.mode.toString(8)}` : null,
      size: attrs?.size ?? null,
      uid: attrs?.uid ?? null,
      gid: attrs?.gid ?? null,
      mtime: attrs?.mtime ?? null,
      rtt,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle NFSv3 GETATTR — retrieve file attributes for an exported root directory.
 *
 * Flow:
 *  1. MOUNT MNT(exportPath) → root file handle
 *  2. NFSv3 GETATTR (proc 1) with root file handle → fattr3 attributes
 *
 * Request body: { host, port?, timeout?, exportPath }
 * Response:     { type, mode, modeStr, nlink, uid, gid, size, atime, mtime, ctime, rtt }
 */
export async function handleNFSGetAttr(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      exportPath: string;
    };

    const { host, port = 2049, timeout = 10000, exportPath } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!exportPath) {
      return new Response(JSON.stringify({ success: false, error: 'exportPath is required' }), {
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

    // Step 1: MOUNT to get root file handle
    const rootFH = await mountExportPath(host, port, exportPath, timeout);
    if (!rootFH) {
      return new Response(JSON.stringify({
        success: false,
        error: `MOUNT failed for export path: ${exportPath}`,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Step 2: NFSv3 GETATTR (proc 1)
    // Args: nfs_fh3 — XDR opaque<>: uint32 length + bytes
    const fhEncoded = xdrEncodeFileHandle(rootFH);

    const reply = await sendRpcCall(
      host, port, NFS_PROGRAM, 3, NFSPROC3_GETATTR, fhEncoded, timeout,
    );

    const rtt = Date.now() - startTime;

    if (!reply || !reply.accepted || reply.acceptStat !== ACCEPT_SUCCESS || !reply.data) {
      return new Response(JSON.stringify({
        success: false,
        error: reply
          ? `NFSv3 GETATTR failed: ${reply.acceptStatName}`
          : 'No reply from NFS server',
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Parse GETATTR3res: status(4) + fattr3(84 bytes)
    const replyData = reply.data;
    if (replyData.length < 4) {
      return new Response(JSON.stringify({ success: false, error: 'GETATTR reply too short', rtt }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const replyView2 = new DataView(replyData.buffer, replyData.byteOffset, replyData.byteLength);
    const nfsStatus2 = replyView2.getUint32(0);
    if (nfsStatus2 !== 0) {
      return new Response(JSON.stringify({
        success: false,
        error: `NFSv3 GETATTR error status: ${nfsStatus2}`,
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const attrs = parseFattr3(replyData, 4);
    if (!attrs) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to parse NFSv3 fattr3 attributes (reply may be truncated)',
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      exportPath,
      type: attrs.ftypeName,
      mode: `0${attrs.mode.toString(8)}`,
      modeStr: attrs.modeStr,
      nlink: attrs.nlink,
      uid: attrs.uid,
      gid: attrs.gid,
      size: attrs.size,
      atime: attrs.atime,
      mtime: attrs.mtime,
      ctime: attrs.ctime,
      rtt,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Build NFSv3 READ procedure arguments (XDR-encoded).
 * READ3args: { file: nfs_fh3, offset: uint64, count: uint32 }
 */
function buildReadArgs(fh: Uint8Array, byteOffset: number, count: number): Uint8Array {
  const fhEncoded = xdrEncodeFileHandle(fh);
  const buf = new Uint8Array(fhEncoded.length + 12);
  const view = new DataView(buf.buffer);
  buf.set(fhEncoded, 0);
  let pos = fhEncoded.length;
  view.setUint32(pos, Math.floor(byteOffset / 0x100000000)); pos += 4;
  view.setUint32(pos, byteOffset >>> 0); pos += 4;
  view.setUint32(pos, count);
  return buf;
}

/**
 * Resolve a file path by chaining NFSv3 LOOKUP calls for each component.
 * Returns the final file handle, or null on any failure.
 */
async function resolveNFSFilePath(
  host: string,
  port: number,
  rootFH: Uint8Array,
  filePath: string,
  timeout: number,
): Promise<Uint8Array | null> {
  const parts = filePath.split('/').filter(p => p.length > 0);
  let currentFH = rootFH;

  for (const part of parts) {
    const fhEncoded = xdrEncodeFileHandle(currentFH);
    const nameEncoded = xdrEncodeString(part);
    const args = new Uint8Array(fhEncoded.length + nameEncoded.length);
    args.set(fhEncoded, 0);
    args.set(nameEncoded, fhEncoded.length);

    const reply = await sendRpcCall(host, port, NFS_PROGRAM, 3, NFSPROC3_LOOKUP, args, timeout);
    if (!reply || !reply.accepted || reply.acceptStat !== ACCEPT_SUCCESS || !reply.data) {
      return null;
    }

    const data = reply.data;
    if (data.length < 8) return null;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (dv.getUint32(0) !== 0) return null;

    const fhLen = dv.getUint32(4);
    if (fhLen > 64 || 8 + fhLen > data.length) return null;
    currentFH = data.slice(8, 8 + fhLen);
  }

  return currentFH;
}

/**
 * Handle NFSv3 READ — mount an export, resolve a file path, and read its contents.
 *
 * Flow:
 *  1. MOUNT MNT(exportPath) → root file handle
 *  2. LOOKUP each path component → target file handle
 *  3. NFSv3 READ (proc 6) → file data
 *
 * Request body: { host, port?, timeout?, exportPath, path, offset?, count? }
 * Response:     { data, eof, bytesRead, encoding, rtt }
 */
export async function handleNFSRead(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      exportPath: string;
      path: string;
      offset?: number;
      count?: number;
    };

    const { host, port = 2049, timeout = 10000, exportPath, path, offset = 0, count = 4096 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!exportPath) {
      return new Response(JSON.stringify({ success: false, error: 'exportPath is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!path) {
      return new Response(JSON.stringify({ success: false, error: 'path is required' }), {
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

    const rootFH = await mountExportPath(host, port, exportPath, timeout);
    if (!rootFH) {
      return new Response(JSON.stringify({
        success: false,
        error: `MOUNT failed for export path: ${exportPath}`,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const targetFH = await resolveNFSFilePath(host, port, rootFH, path, timeout);
    if (!targetFH) {
      return new Response(JSON.stringify({
        success: false,
        error: `LOOKUP failed for path: ${path}`,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const readArgs = buildReadArgs(targetFH, offset, Math.min(count, 65536));
    const reply = await sendRpcCall(host, port, NFS_PROGRAM, 3, NFSPROC3_READ, readArgs, timeout);

    const rtt = Date.now() - startTime;

    if (!reply || !reply.accepted || reply.acceptStat !== ACCEPT_SUCCESS || !reply.data) {
      return new Response(JSON.stringify({
        success: false,
        error: reply ? `NFSv3 READ failed: ${reply.acceptStatName}` : 'No reply from NFS server',
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Parse READ3res: status(4) + post_op_attr + count(4) + eof(4) + data_len(4) + data
    const rd = reply.data;
    if (rd.length < 4) {
      return new Response(JSON.stringify({ success: false, error: 'READ reply too short', rtt }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const rdView = new DataView(rd.buffer, rd.byteOffset, rd.byteLength);
    if (rdView.getUint32(0) !== 0) {
      return new Response(JSON.stringify({
        success: false,
        error: `NFSv3 READ error status: ${rdView.getUint32(0)}`,
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    let rdOff = 4;
    const attrFollows = rdView.getUint32(rdOff); rdOff += 4;
    if (attrFollows === 1) rdOff += 84;

    if (rdOff + 12 > rd.length) {
      return new Response(JSON.stringify({ success: false, error: 'READ reply truncated', rtt }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const bytesRead = rdView.getUint32(rdOff); rdOff += 4;
    const eof = rdView.getUint32(rdOff) !== 0; rdOff += 4;
    const dataLen = rdView.getUint32(rdOff); rdOff += 4;
    const fileData = rd.slice(rdOff, rdOff + dataLen);

    let encoding: 'utf-8' | 'base64';
    let dataStr: string;
    try {
      dataStr = new TextDecoder('utf-8', { fatal: true }).decode(fileData);
      encoding = 'utf-8';
    } catch {
      let binaryStr = '';
      for (let i = 0; i < fileData.length; i++) binaryStr += String.fromCharCode(fileData[i]);
      dataStr = btoa(binaryStr);
      encoding = 'base64';
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      exportPath,
      path,
      offset,
      bytesRead,
      eof,
      encoding,
      data: dataStr,
      rtt,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle NFSv3 READDIR — list directory entries.
 *
 * Flow:
 *  1. MOUNT MNT(exportPath) → root file handle
 *  2. Optional: resolveNFSFilePath(path) → directory file handle
 *  3. NFSv3 READDIR (proc 16) → linked list of { fileid, name }
 *
 * Request body: { host, port?, mountPort?, timeout?, exportPath, path?, count? }
 *   path  — sub-path within export (default: export root)
 *   count — max reply size in bytes (default: 4096)
 */
export async function handleNFSReaddir(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as {
      host: string; port?: number; mountPort?: number; timeout?: number;
      exportPath: string; path?: string; count?: number;
    };
    const { host, port = 2049, timeout = 15000, exportPath } = body;
    const path = body.path ?? '';
    const count = Math.min(Math.max(body.count ?? 4096, 512), 32768);

    if (!host) return new Response(JSON.stringify({ success: false, error: 'host is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!exportPath) return new Response(JSON.stringify({ success: false, error: 'exportPath is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const mountPort = body.mountPort ?? port;

    const rootFH = await mountExportPath(host, mountPort, exportPath, timeout);
    if (!rootFH) return new Response(JSON.stringify({ success: false, error: `MOUNT failed for export path: ${exportPath}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const dirFH = await resolveNFSFilePath(host, port, rootFH, path, timeout);
    if (!dirFH) return new Response(JSON.stringify({ success: false, error: `Path not found: ${path || '/'}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // READDIR args: dir(nfs_fh3) + cookie(uint64=0) + cookieverf(uint64=0) + count(uint32)
    const fhEncoded = xdrEncodeFileHandle(dirFH);
    const readdirArgs = new Uint8Array(fhEncoded.length + 8 + 8 + 4);
    const argsView = new DataView(readdirArgs.buffer);
    let argsOff = 0;
    readdirArgs.set(fhEncoded, argsOff); argsOff += fhEncoded.length;
    argsView.setUint32(argsOff, 0); argsOff += 4; // cookie hi
    argsView.setUint32(argsOff, 0); argsOff += 4; // cookie lo
    argsView.setUint32(argsOff, 0); argsOff += 4; // cookieverf hi
    argsView.setUint32(argsOff, 0); argsOff += 4; // cookieverf lo
    argsView.setUint32(argsOff, count);

    const reply = await sendRpcCall(host, port, NFS_PROGRAM, 3, NFSPROC3_READDIR, readdirArgs, timeout);
    const rtt = Date.now() - startTime;

    if (!reply || !reply.accepted || reply.acceptStat !== ACCEPT_SUCCESS || !reply.data) {
      return new Response(JSON.stringify({ success: false, error: reply ? `READDIR failed: ${reply.acceptStatName}` : 'No reply', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const rd = reply.data;
    const rdv = new DataView(rd.buffer, rd.byteOffset, rd.byteLength);
    let rdOff = 0;

    if (rd.length < 4) return new Response(JSON.stringify({ success: false, error: 'READDIR reply too short', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const nfsStatus = rdv.getUint32(rdOff); rdOff += 4;
    if (nfsStatus !== 0) return new Response(JSON.stringify({ success: false, error: `NFSv3 READDIR error status: ${nfsStatus}`, rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // Skip dir_attributes (post_op_attr)
    if (rdOff + 4 <= rd.length) { const af = rdv.getUint32(rdOff); rdOff += 4; if (af === 1) rdOff += 84; }
    rdOff += 8; // skip cookieverf

    const entries: Array<{ fileid: number; name: string }> = [];
    let eof = false;
    while (rdOff + 4 <= rd.length) {
      const follows = rdv.getUint32(rdOff); rdOff += 4;
      if (follows === 0) { if (rdOff + 4 <= rd.length) eof = rdv.getUint32(rdOff) !== 0; break; }
      if (rdOff + 8 > rd.length) break;
      const fileidHi = rdv.getUint32(rdOff); rdOff += 4;
      const fileidLo = rdv.getUint32(rdOff); rdOff += 4;
      const fileid = fileidHi * 0x100000000 + fileidLo;
      if (rdOff + 4 > rd.length) break;
      const nameLen = rdv.getUint32(rdOff); rdOff += 4;
      if (nameLen > 256 || rdOff + nameLen > rd.length) break;
      const name = new TextDecoder().decode(rd.slice(rdOff, rdOff + nameLen));
      rdOff += nameLen + (4 - (nameLen % 4)) % 4;
      rdOff += 8; // cookie uint64
      entries.push({ fileid, name });
    }

    return new Response(JSON.stringify({ success: true, host, port, exportPath, path: path || '/', count: entries.length, eof, entries, rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle NFSv3 WRITE — write data to a file.
 *
 * Request body: { host, port?, mountPort?, timeout?, exportPath, path, data (base64), offset? }
 *   data   — base64-encoded bytes to write
 *   offset — byte offset to write at (default: 0)
 * Note: Most NFS exports are read-only; the server will reject writes if not permitted.
 */
export async function handleNFSWrite(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as {
      host: string; port?: number; mountPort?: number; timeout?: number;
      exportPath: string; path: string; data: string; offset?: number;
    };
    const { host, port = 2049, timeout = 15000, exportPath, path } = body;
    const offset = Math.max(0, body.offset ?? 0);

    if (!host || !exportPath || !path || !body.data) {
      return new Response(JSON.stringify({ success: false, error: 'host, exportPath, path and data are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    let writeBytes: Uint8Array;
    try {
      const binary = atob(body.data);
      writeBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) writeBytes[i] = binary.charCodeAt(i);
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'data must be valid base64' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (writeBytes.length > 65536) return new Response(JSON.stringify({ success: false, error: 'data too large (max 65536 bytes)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const mountPort = body.mountPort ?? port;

    const rootFH = await mountExportPath(host, mountPort, exportPath, timeout);
    if (!rootFH) return new Response(JSON.stringify({ success: false, error: `MOUNT failed for: ${exportPath}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const fileFH = await resolveNFSFilePath(host, port, rootFH, path, timeout);
    if (!fileFH) return new Response(JSON.stringify({ success: false, error: `File not found: ${path}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // WRITE args: file(nfs_fh3) + offset(uint64) + count(uint32) + stable(uint32) + data(opaque<>)
    const fhEncoded = xdrEncodeFileHandle(fileFH);
    const dataPadded = Math.ceil(writeBytes.length / 4) * 4;
    const writeArgs = new Uint8Array(fhEncoded.length + 8 + 4 + 4 + 4 + dataPadded);
    const av = new DataView(writeArgs.buffer);
    let ao = 0;
    writeArgs.set(fhEncoded, ao); ao += fhEncoded.length;
    // offset uint64
    av.setUint32(ao, Math.floor(offset / 0x100000000)); ao += 4;
    av.setUint32(ao, offset >>> 0); ao += 4;
    av.setUint32(ao, writeBytes.length); ao += 4; // count
    av.setUint32(ao, NFS3_FILE_SYNC); ao += 4;    // stable = FILE_SYNC
    av.setUint32(ao, writeBytes.length); ao += 4;  // data opaque length
    writeArgs.set(writeBytes, ao);

    const reply = await sendRpcCall(host, port, NFS_PROGRAM, 3, NFSPROC3_WRITE, writeArgs, timeout);
    const rtt = Date.now() - startTime;

    if (!reply || !reply.accepted || reply.acceptStat !== ACCEPT_SUCCESS || !reply.data) {
      return new Response(JSON.stringify({ success: false, error: reply ? `WRITE failed: ${reply.acceptStatName}` : 'No reply', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const wr = reply.data;
    const wrv = new DataView(wr.buffer, wr.byteOffset, wr.byteLength);
    let wrOff = 0;

    if (wr.length < 4) return new Response(JSON.stringify({ success: false, error: 'WRITE reply too short', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const nfsStatus = wrv.getUint32(wrOff); wrOff += 4;
    if (nfsStatus !== 0) return new Response(JSON.stringify({ success: false, error: `NFSv3 WRITE error status: ${nfsStatus} (export may be read-only)`, rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // Skip wcc_data (pre_op_attr + post_op_attr)
    if (wrOff + 4 <= wr.length) { const pf = wrv.getUint32(wrOff); wrOff += 4; if (pf === 1) wrOff += 24; }
    if (wrOff + 4 <= wr.length) { const qf = wrv.getUint32(wrOff); wrOff += 4; if (qf === 1) wrOff += 84; }

    let bytesWritten = writeBytes.length;
    const stableNames = ['UNSTABLE', 'DATA_SYNC', 'FILE_SYNC'];
    let committedStr = 'FILE_SYNC';
    if (wrOff + 8 <= wr.length) {
      bytesWritten = wrv.getUint32(wrOff); wrOff += 4;
      const committed = wrv.getUint32(wrOff); wrOff += 4;
      committedStr = stableNames[committed] ?? `UNKNOWN(${committed})`;
    }

    return new Response(JSON.stringify({ success: true, host, port, exportPath, path, offset, bytesWritten, committed: committedStr, rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle NFSv3 CREATE — create a new file.
 *
 * Request body: { host, port?, mountPort?, timeout?, exportPath, path, mode?, data? }
 *   path — path to the new file (including filename)
 *   mode — file permissions in octal (default: 0644)
 *   data — optional base64-encoded initial file content
 *
 * Flow:
 *  1. MOUNT MNT(exportPath) → root file handle
 *  2. Resolve parent directory path → parent directory file handle
 *  3. NFSv3 CREATE (proc 8) → create file and get file handle
 *  4. Optional: if data provided, WRITE to the new file
 */
export async function handleNFSCreate(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as {
      host: string; port?: number; mountPort?: number; timeout?: number;
      exportPath: string; path: string; mode?: number; data?: string;
    };
    const { host, port = 2049, timeout = 15000, exportPath, path } = body;
    const mode = body.mode ?? 0o644;

    if (!host || !exportPath || !path) {
      return new Response(JSON.stringify({ success: false, error: 'host, exportPath, and path are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const mountPort = body.mountPort ?? port;

    const rootFH = await mountExportPath(host, mountPort, exportPath, timeout);
    if (!rootFH) return new Response(JSON.stringify({ success: false, error: `MOUNT failed for: ${exportPath}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // Split path into parent directory and filename
    const pathParts = path.split('/').filter(p => p.length > 0);
    if (pathParts.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid path: must specify a filename' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const filename = pathParts[pathParts.length - 1];
    const parentPath = pathParts.slice(0, -1).join('/');

    const parentFH = parentPath ? await resolveNFSFilePath(host, port, rootFH, parentPath, timeout) : rootFH;
    if (!parentFH) return new Response(JSON.stringify({ success: false, error: `Parent directory not found: ${parentPath || '/'}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // CREATE args: where(diropargs3) + how(createhow3)
    // diropargs3: dir(nfs_fh3) + name(filename3)
    // createhow3: mode(uint32) + [if mode==UNCHECKED or GUARDED] sattr3
    // sattr3: mode(set_mode3) + uid(set_uid3) + gid(set_gid3) + size(set_size3) + atime(set_atime) + mtime(set_mtime)
    // set_mode3: set_it(bool/uint32) + [if set_it] mode(uint32)
    const fhEncoded = xdrEncodeFileHandle(parentFH);
    const nameEncoded = xdrEncodeString(filename);

    // Build sattr3 with mode set, others unset
    const sattr3 = new Uint8Array(24); // 6 fields * 4 bytes each
    const sattr3View = new DataView(sattr3.buffer);
    sattr3View.setUint32(0, 1); // set mode
    sattr3View.setUint32(4, mode); // mode value
    sattr3View.setUint32(8, 0); // don't set uid
    sattr3View.setUint32(12, 0); // don't set gid
    sattr3View.setUint32(16, 0); // don't set size
    sattr3View.setUint32(20, 0); // don't set atime

    const createArgs = new Uint8Array(fhEncoded.length + nameEncoded.length + 4 + sattr3.length);
    const av = new DataView(createArgs.buffer);
    let ao = 0;
    createArgs.set(fhEncoded, ao); ao += fhEncoded.length;
    createArgs.set(nameEncoded, ao); ao += nameEncoded.length;
    av.setUint32(ao, 0); ao += 4; // createmode = UNCHECKED (0)
    createArgs.set(sattr3, ao);

    const reply = await sendRpcCall(host, port, NFS_PROGRAM, 3, 8, createArgs, timeout); // proc 8 = CREATE
    const rtt = Date.now() - startTime;

    if (!reply || !reply.accepted || reply.acceptStat !== ACCEPT_SUCCESS || !reply.data) {
      return new Response(JSON.stringify({ success: false, error: reply ? `CREATE failed: ${reply.acceptStatName}` : 'No reply', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const cr = reply.data;
    const crv = new DataView(cr.buffer, cr.byteOffset, cr.byteLength);
    let crOff = 0;

    if (cr.length < 4) return new Response(JSON.stringify({ success: false, error: 'CREATE reply too short', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const nfsStatus = crv.getUint32(crOff); crOff += 4;
    if (nfsStatus !== 0) return new Response(JSON.stringify({ success: false, error: `NFSv3 CREATE error status: ${nfsStatus} (export may be read-only or file exists)`, rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // CREATE3res: status + post_op_fh3 (optional file handle) + post_op_attr + wcc_data
    // post_op_fh3: handle_follows(bool) + [if follows] nfs_fh3
    let createdFH: Uint8Array | null = null;
    if (crOff + 4 <= cr.length) {
      const handleFollows = crv.getUint32(crOff); crOff += 4;
      if (handleFollows === 1 && crOff + 4 <= cr.length) {
        const fhLen = crv.getUint32(crOff); crOff += 4;
        if (fhLen <= 64 && crOff + fhLen <= cr.length) {
          createdFH = cr.slice(crOff, crOff + fhLen);
        }
      }
    }

    // If data is provided and we have the file handle, write it
    let bytesWritten = 0;
    if (body.data && createdFH) {
      let writeBytes: Uint8Array;
      try {
        const binary = atob(body.data);
        writeBytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) writeBytes[i] = binary.charCodeAt(i);
      } catch {
        return new Response(JSON.stringify({ success: true, created: true, warning: 'File created but data is invalid base64', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (writeBytes.length <= 65536) {
        const fhEncoded2 = xdrEncodeFileHandle(createdFH);
        const dataPadded = Math.ceil(writeBytes.length / 4) * 4;
        const writeArgs = new Uint8Array(fhEncoded2.length + 8 + 4 + 4 + 4 + dataPadded);
        const wv = new DataView(writeArgs.buffer);
        let wo = 0;
        writeArgs.set(fhEncoded2, wo); wo += fhEncoded2.length;
        wv.setUint32(wo, 0); wo += 4; // offset hi
        wv.setUint32(wo, 0); wo += 4; // offset lo
        wv.setUint32(wo, writeBytes.length); wo += 4;
        wv.setUint32(wo, NFS3_FILE_SYNC); wo += 4;
        wv.setUint32(wo, writeBytes.length); wo += 4;
        writeArgs.set(writeBytes, wo);

        const writeReply = await sendRpcCall(host, port, NFS_PROGRAM, 3, NFSPROC3_WRITE, writeArgs, timeout);
        if (writeReply && writeReply.accepted && writeReply.acceptStat === ACCEPT_SUCCESS && writeReply.data) {
          const wd = writeReply.data;
          const wdv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
          if (wd.length >= 4 && wdv.getUint32(0) === 0) {
            let wdOff = 4;
            if (wdOff + 4 <= wd.length) { const pf = wdv.getUint32(wdOff); wdOff += 4; if (pf === 1) wdOff += 24; }
            if (wdOff + 4 <= wd.length) { const qf = wdv.getUint32(wdOff); wdOff += 4; if (qf === 1) wdOff += 84; }
            if (wdOff + 4 <= wd.length) {
              bytesWritten = wdv.getUint32(wdOff);
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      exportPath,
      path,
      created: true,
      bytesWritten: bytesWritten > 0 ? bytesWritten : undefined,
      rtt
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle NFSv3 REMOVE — delete a file.
 *
 * Request body: { host, port?, mountPort?, timeout?, exportPath, path }
 *   path — path to the file to delete
 *
 * Flow:
 *  1. MOUNT MNT(exportPath) → root file handle
 *  2. Resolve parent directory path → parent directory file handle
 *  3. NFSv3 REMOVE (proc 12) → delete the file
 */
export async function handleNFSRemove(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as {
      host: string; port?: number; mountPort?: number; timeout?: number;
      exportPath: string; path: string;
    };
    const { host, port = 2049, timeout = 15000, exportPath, path } = body;

    if (!host || !exportPath || !path) {
      return new Response(JSON.stringify({ success: false, error: 'host, exportPath, and path are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const mountPort = body.mountPort ?? port;

    const rootFH = await mountExportPath(host, mountPort, exportPath, timeout);
    if (!rootFH) return new Response(JSON.stringify({ success: false, error: `MOUNT failed for: ${exportPath}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // Split path into parent directory and filename
    const pathParts = path.split('/').filter(p => p.length > 0);
    if (pathParts.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid path: must specify a filename' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const filename = pathParts[pathParts.length - 1];
    const parentPath = pathParts.slice(0, -1).join('/');

    const parentFH = parentPath ? await resolveNFSFilePath(host, port, rootFH, parentPath, timeout) : rootFH;
    if (!parentFH) return new Response(JSON.stringify({ success: false, error: `Parent directory not found: ${parentPath || '/'}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // REMOVE args: diropargs3 (dir + name)
    const fhEncoded = xdrEncodeFileHandle(parentFH);
    const nameEncoded = xdrEncodeString(filename);
    const removeArgs = new Uint8Array(fhEncoded.length + nameEncoded.length);
    removeArgs.set(fhEncoded, 0);
    removeArgs.set(nameEncoded, fhEncoded.length);

    const reply = await sendRpcCall(host, port, NFS_PROGRAM, 3, 12, removeArgs, timeout); // proc 12 = REMOVE
    const rtt = Date.now() - startTime;

    if (!reply || !reply.accepted || reply.acceptStat !== ACCEPT_SUCCESS || !reply.data) {
      return new Response(JSON.stringify({ success: false, error: reply ? `REMOVE failed: ${reply.acceptStatName}` : 'No reply', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const rm = reply.data;
    const rmv = new DataView(rm.buffer, rm.byteOffset, rm.byteLength);

    if (rm.length < 4) return new Response(JSON.stringify({ success: false, error: 'REMOVE reply too short', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const nfsStatus = rmv.getUint32(0);
    if (nfsStatus !== 0) return new Response(JSON.stringify({ success: false, error: `NFSv3 REMOVE error status: ${nfsStatus} (export may be read-only or file not found)`, rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      exportPath,
      path,
      deleted: true,
      rtt
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle NFSv3 RENAME — rename or move a file.
 *
 * Request body: { host, port?, mountPort?, timeout?, exportPath, fromPath, toPath }
 *   fromPath — current file path
 *   toPath   — new file path
 *
 * Flow:
 *  1. MOUNT MNT(exportPath) → root file handle
 *  2. Resolve source parent directory → from parent file handle
 *  3. Resolve destination parent directory → to parent file handle
 *  4. NFSv3 RENAME (proc 14) → rename/move the file
 */
export async function handleNFSRename(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as {
      host: string; port?: number; mountPort?: number; timeout?: number;
      exportPath: string; fromPath: string; toPath: string;
    };
    const { host, port = 2049, timeout = 15000, exportPath, fromPath, toPath } = body;

    if (!host || !exportPath || !fromPath || !toPath) {
      return new Response(JSON.stringify({ success: false, error: 'host, exportPath, fromPath, and toPath are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const mountPort = body.mountPort ?? port;

    const rootFH = await mountExportPath(host, mountPort, exportPath, timeout);
    if (!rootFH) return new Response(JSON.stringify({ success: false, error: `MOUNT failed for: ${exportPath}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // Parse source path
    const fromParts = fromPath.split('/').filter(p => p.length > 0);
    if (fromParts.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid fromPath: must specify a filename' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const fromFilename = fromParts[fromParts.length - 1];
    const fromParentPath = fromParts.slice(0, -1).join('/');

    // Parse destination path
    const toParts = toPath.split('/').filter(p => p.length > 0);
    if (toParts.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid toPath: must specify a filename' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const toFilename = toParts[toParts.length - 1];
    const toParentPath = toParts.slice(0, -1).join('/');

    const fromParentFH = fromParentPath ? await resolveNFSFilePath(host, port, rootFH, fromParentPath, timeout) : rootFH;
    if (!fromParentFH) return new Response(JSON.stringify({ success: false, error: `Source parent directory not found: ${fromParentPath || '/'}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const toParentFH = toParentPath ? await resolveNFSFilePath(host, port, rootFH, toParentPath, timeout) : rootFH;
    if (!toParentFH) return new Response(JSON.stringify({ success: false, error: `Destination parent directory not found: ${toParentPath || '/'}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // RENAME args: from(diropargs3) + to(diropargs3)
    // diropargs3: dir(nfs_fh3) + name(filename3)
    const fromDirEncoded = xdrEncodeFileHandle(fromParentFH);
    const fromNameEncoded = xdrEncodeString(fromFilename);
    const toDirEncoded = xdrEncodeFileHandle(toParentFH);
    const toNameEncoded = xdrEncodeString(toFilename);

    const renameArgs = new Uint8Array(
      fromDirEncoded.length + fromNameEncoded.length +
      toDirEncoded.length + toNameEncoded.length
    );
    let offset = 0;
    renameArgs.set(fromDirEncoded, offset); offset += fromDirEncoded.length;
    renameArgs.set(fromNameEncoded, offset); offset += fromNameEncoded.length;
    renameArgs.set(toDirEncoded, offset); offset += toDirEncoded.length;
    renameArgs.set(toNameEncoded, offset);

    const reply = await sendRpcCall(host, port, NFS_PROGRAM, 3, 14, renameArgs, timeout); // proc 14 = RENAME
    const rtt = Date.now() - startTime;

    if (!reply || !reply.accepted || reply.acceptStat !== ACCEPT_SUCCESS || !reply.data) {
      return new Response(JSON.stringify({ success: false, error: reply ? `RENAME failed: ${reply.acceptStatName}` : 'No reply', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const rn = reply.data;
    const rnv = new DataView(rn.buffer, rn.byteOffset, rn.byteLength);

    if (rn.length < 4) return new Response(JSON.stringify({ success: false, error: 'RENAME reply too short', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const nfsStatus = rnv.getUint32(0);
    if (nfsStatus !== 0) return new Response(JSON.stringify({ success: false, error: `NFSv3 RENAME error status: ${nfsStatus} (export may be read-only or file not found)`, rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      exportPath,
      fromPath,
      toPath,
      renamed: true,
      rtt
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle NFSv3 MKDIR — create a new directory.
 *
 * Request body: { host, port?, mountPort?, timeout?, exportPath, path, mode? }
 *   path — path to the new directory
 *   mode — directory permissions in octal (default: 0755)
 *
 * Flow:
 *  1. MOUNT MNT(exportPath) → root file handle
 *  2. Resolve parent directory path → parent directory file handle
 *  3. NFSv3 MKDIR (proc 9) → create directory
 */
export async function handleNFSMkdir(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as {
      host: string; port?: number; mountPort?: number; timeout?: number;
      exportPath: string; path: string; mode?: number;
    };
    const { host, port = 2049, timeout = 15000, exportPath, path } = body;
    const mode = body.mode ?? 0o755;

    if (!host || !exportPath || !path) {
      return new Response(JSON.stringify({ success: false, error: 'host, exportPath, and path are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const mountPort = body.mountPort ?? port;

    const rootFH = await mountExportPath(host, mountPort, exportPath, timeout);
    if (!rootFH) return new Response(JSON.stringify({ success: false, error: `MOUNT failed for: ${exportPath}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // Split path into parent directory and dirname
    const pathParts = path.split('/').filter(p => p.length > 0);
    if (pathParts.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid path: must specify a directory name' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const dirname = pathParts[pathParts.length - 1];
    const parentPath = pathParts.slice(0, -1).join('/');

    const parentFH = parentPath ? await resolveNFSFilePath(host, port, rootFH, parentPath, timeout) : rootFH;
    if (!parentFH) return new Response(JSON.stringify({ success: false, error: `Parent directory not found: ${parentPath || '/'}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // MKDIR args: where(diropargs3) + attributes(sattr3)
    const fhEncoded = xdrEncodeFileHandle(parentFH);
    const nameEncoded = xdrEncodeString(dirname);

    // Build sattr3 with mode set, others unset
    const sattr3 = new Uint8Array(24);
    const sattr3View = new DataView(sattr3.buffer);
    sattr3View.setUint32(0, 1); // set mode
    sattr3View.setUint32(4, mode); // mode value
    sattr3View.setUint32(8, 0); // don't set uid
    sattr3View.setUint32(12, 0); // don't set gid
    sattr3View.setUint32(16, 0); // don't set size
    sattr3View.setUint32(20, 0); // don't set atime

    const mkdirArgs = new Uint8Array(fhEncoded.length + nameEncoded.length + sattr3.length);
    let ao = 0;
    mkdirArgs.set(fhEncoded, ao); ao += fhEncoded.length;
    mkdirArgs.set(nameEncoded, ao); ao += nameEncoded.length;
    mkdirArgs.set(sattr3, ao);

    const reply = await sendRpcCall(host, port, NFS_PROGRAM, 3, 9, mkdirArgs, timeout); // proc 9 = MKDIR
    const rtt = Date.now() - startTime;

    if (!reply || !reply.accepted || reply.acceptStat !== ACCEPT_SUCCESS || !reply.data) {
      return new Response(JSON.stringify({ success: false, error: reply ? `MKDIR failed: ${reply.acceptStatName}` : 'No reply', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const md = reply.data;
    const mdv = new DataView(md.buffer, md.byteOffset, md.byteLength);

    if (md.length < 4) return new Response(JSON.stringify({ success: false, error: 'MKDIR reply too short', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const nfsStatus = mdv.getUint32(0);
    if (nfsStatus !== 0) return new Response(JSON.stringify({ success: false, error: `NFSv3 MKDIR error status: ${nfsStatus} (export may be read-only or directory exists)`, rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      exportPath,
      path,
      created: true,
      rtt
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle NFSv3 RMDIR — remove an empty directory.
 *
 * Request body: { host, port?, mountPort?, timeout?, exportPath, path }
 *   path — path to the directory to remove (must be empty)
 *
 * Flow:
 *  1. MOUNT MNT(exportPath) → root file handle
 *  2. Resolve parent directory path → parent directory file handle
 *  3. NFSv3 RMDIR (proc 13) → remove directory
 */
export async function handleNFSRmdir(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as {
      host: string; port?: number; mountPort?: number; timeout?: number;
      exportPath: string; path: string;
    };
    const { host, port = 2049, timeout = 15000, exportPath, path } = body;

    if (!host || !exportPath || !path) {
      return new Response(JSON.stringify({ success: false, error: 'host, exportPath, and path are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const mountPort = body.mountPort ?? port;

    const rootFH = await mountExportPath(host, mountPort, exportPath, timeout);
    if (!rootFH) return new Response(JSON.stringify({ success: false, error: `MOUNT failed for: ${exportPath}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // Split path into parent directory and dirname
    const pathParts = path.split('/').filter(p => p.length > 0);
    if (pathParts.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid path: must specify a directory name' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const dirname = pathParts[pathParts.length - 1];
    const parentPath = pathParts.slice(0, -1).join('/');

    const parentFH = parentPath ? await resolveNFSFilePath(host, port, rootFH, parentPath, timeout) : rootFH;
    if (!parentFH) return new Response(JSON.stringify({ success: false, error: `Parent directory not found: ${parentPath || '/'}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // RMDIR args: diropargs3 (dir + name)
    const fhEncoded = xdrEncodeFileHandle(parentFH);
    const nameEncoded = xdrEncodeString(dirname);
    const rmdirArgs = new Uint8Array(fhEncoded.length + nameEncoded.length);
    rmdirArgs.set(fhEncoded, 0);
    rmdirArgs.set(nameEncoded, fhEncoded.length);

    const reply = await sendRpcCall(host, port, NFS_PROGRAM, 3, 13, rmdirArgs, timeout); // proc 13 = RMDIR
    const rtt = Date.now() - startTime;

    if (!reply || !reply.accepted || reply.acceptStat !== ACCEPT_SUCCESS || !reply.data) {
      return new Response(JSON.stringify({ success: false, error: reply ? `RMDIR failed: ${reply.acceptStatName}` : 'No reply', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const rd = reply.data;
    const rdv = new DataView(rd.buffer, rd.byteOffset, rd.byteLength);

    if (rd.length < 4) return new Response(JSON.stringify({ success: false, error: 'RMDIR reply too short', rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const nfsStatus = rdv.getUint32(0);
    if (nfsStatus !== 0) return new Response(JSON.stringify({ success: false, error: `NFSv3 RMDIR error status: ${nfsStatus} (export may be read-only, directory not empty, or not found)`, rtt }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      exportPath,
      path,
      deleted: true,
      rtt
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
