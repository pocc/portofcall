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
const MOUNTPROC_EXPORT = 5;

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
 * Handle NFS probe - detect supported NFS versions via NULL calls
 */
export async function handleNFSProbe(request: Request): Promise<Response> {
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
