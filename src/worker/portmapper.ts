/**
 * ONC RPC Portmapper / rpcbind Protocol Implementation (RFC 1833)
 *
 * The Portmapper (rpcbind) service maps ONC RPC program numbers to their
 * network port numbers. It runs on port 111 and is the first thing an RPC
 * client contacts to discover where a service (NFS, NIS, mountd, etc.) lives.
 *
 * Protocol Stack:
 *   TCP Record Marking (RFC 1057) → ONC RPC (RFC 1831) → Portmapper (RFC 1833)
 *
 * TCP Record Marking:
 *   Each message is prefixed with a 4-byte header:
 *     Bit 31:    Last Fragment flag (1 = last)
 *     Bits 0-30: Fragment length
 *
 * ONC RPC Call Format (XDR-encoded):
 *   XID              (4 bytes) - Transaction ID
 *   Message Type     (4 bytes) - 0 = CALL
 *   RPC Version      (4 bytes) - 2
 *   Program          (4 bytes) - 100000 (portmapper)
 *   Program Version  (4 bytes) - 2
 *   Procedure        (4 bytes) - 0=NULL, 3=GETPORT, 4=DUMP
 *   Credential Flavor(4 bytes) - 0 = AUTH_NONE
 *   Credential Length (4 bytes) - 0
 *   Verifier Flavor  (4 bytes) - 0 = AUTH_NONE
 *   Verifier Length   (4 bytes) - 0
 *   [Procedure args...]
 *
 * DUMP Response (linked list of mapping entries):
 *   Value Follows (4 bytes) - 1=TRUE (entry present), 0=FALSE (end)
 *     Program  (4 bytes)
 *     Version  (4 bytes)
 *     Protocol (4 bytes) - 6=TCP, 17=UDP
 *     Port     (4 bytes)
 *   ... repeats until Value Follows = 0
 *
 * Use Cases:
 * - Discover NFS, mountd, nlockmgr, and other RPC services
 * - Verify rpcbind is running and responsive
 * - Network reconnaissance and service enumeration
 * - Complement to NFS protocol testing
 */

import { connect } from 'cloudflare:sockets';

// Well-known RPC program numbers
const RPC_PROGRAMS: Record<number, string> = {
  100000: 'portmapper',
  100001: 'rstatd',
  100002: 'rusersd',
  100003: 'nfs',
  100004: 'ypserv (NIS)',
  100005: 'mountd',
  100007: 'ypbind (NIS)',
  100008: 'walld',
  100009: 'yppasswdd',
  100011: 'rquotad',
  100012: 'sprayd',
  100017: 'rexd',
  100020: 'llockmgr',
  100021: 'nlockmgr',
  100024: 'status (NSM)',
  100026: 'bootparam',
  100028: 'ypupdated',
  100029: 'keyserv',
  100068: 'cmsd (CDE)',
  100069: 'ttdbserverd',
  100083: 'ttdbserver',
  100099: 'autofsd',
  100133: 'nsm_addrand',
  100155: 'cachefs',
  100227: 'nfs_acl',
  100229: 'nfsauth',
  100232: 'sadmind',
  100300: 'nisd (NIS+)',
  150001: 'pcnfsd',
  200006: 'sgi_fam',
  300019: 'amd',
  390109: 'snmpXdmid',
  391002: 'rpc.sgi_toolkitbus',
  805306368: 'fypxfrd',
};

const PROTOCOL_NAMES: Record<number, string> = {
  6: 'TCP',
  17: 'UDP',
};

const PORTMAP_PROGRAM = 100000;
const PORTMAP_VERSION = 2;
const RPC_VERSION = 2;

// RPC message types
const RPC_CALL = 0;

// Portmapper procedures
const PMAPPROC_NULL = 0;
const PMAPPROC_DUMP = 4;

// Auth flavors
const AUTH_NONE = 0;

// RPC reply status
const MSG_ACCEPTED = 0;
const SUCCESS = 0;

interface PortmapperProbeRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface MappingEntry {
  program: number;
  programName: string;
  version: number;
  protocol: string;
  protocolNumber: number;
  port: number;
}

interface PortmapperProbeResponse {
  success: boolean;
  host?: string;
  port?: number;
  rtt?: number;
  error?: string;
}

interface PortmapperDumpResponse {
  success: boolean;
  host?: string;
  port?: number;
  mappings?: MappingEntry[];
  totalServices?: number;
  rtt?: number;
  error?: string;
}

/**
 * Build a TCP Record Marking frame
 * Bit 31 = last fragment (1), bits 0-30 = length
 */
function buildRecordMark(data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + data.length);
  const view = new DataView(frame.buffer);
  // Set last-fragment bit (0x80000000) | length
  view.setUint32(0, 0x80000000 | data.length);
  frame.set(data, 4);
  return frame;
}

/**
 * Build an ONC RPC Call message (no procedure args)
 */
function buildRpcCall(procedure: number, args?: Uint8Array): Uint8Array {
  const xid = (Math.random() * 0xFFFFFFFF) >>> 0;
  const headerSize = 10 * 4; // 10 uint32 fields
  const argsSize = args ? args.length : 0;
  const message = new Uint8Array(headerSize + argsSize);
  const view = new DataView(message.buffer);

  let offset = 0;
  view.setUint32(offset, xid);            offset += 4; // XID
  view.setUint32(offset, RPC_CALL);        offset += 4; // Message Type = CALL
  view.setUint32(offset, RPC_VERSION);     offset += 4; // RPC Version = 2
  view.setUint32(offset, PORTMAP_PROGRAM); offset += 4; // Program = 100000
  view.setUint32(offset, PORTMAP_VERSION); offset += 4; // Program Version = 2
  view.setUint32(offset, procedure);       offset += 4; // Procedure
  view.setUint32(offset, AUTH_NONE);       offset += 4; // Credential Flavor
  view.setUint32(offset, 0);              offset += 4; // Credential Length
  view.setUint32(offset, AUTH_NONE);       offset += 4; // Verifier Flavor
  view.setUint32(offset, 0);              offset += 4; // Verifier Length

  if (args) {
    message.set(args, offset);
  }

  return message;
}

/**
 * Parse an RPC Reply header, returns the offset after the header
 * or throws on error
 */
function parseRpcReply(data: Uint8Array): { offset: number; xid: number } {
  if (data.length < 24) {
    throw new Error('RPC reply too short');
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const xid = view.getUint32(offset);         offset += 4;
  const msgType = view.getUint32(offset);      offset += 4;

  if (msgType !== 1) { // 1 = REPLY
    throw new Error(`Expected RPC REPLY (1), got ${msgType}`);
  }

  const replyStatus = view.getUint32(offset);  offset += 4;

  if (replyStatus !== MSG_ACCEPTED) {
    throw new Error(`RPC call rejected (status=${replyStatus})`);
  }

  // Skip verifier (flavor + length + data)
  offset += 4; // verifier flavor
  const verifierLen = view.getUint32(offset);  offset += 4;
  offset += verifierLen; // verifier data

  const acceptStatus = view.getUint32(offset); offset += 4;

  if (acceptStatus !== SUCCESS) {
    const statusNames: Record<number, string> = {
      1: 'PROG_UNAVAIL',
      2: 'PROG_MISMATCH',
      3: 'PROC_UNAVAIL',
      4: 'GARBAGE_ARGS',
      5: 'SYSTEM_ERR',
    };
    throw new Error(`RPC error: ${statusNames[acceptStatus] || `status ${acceptStatus}`}`);
  }

  return { offset, xid };
}

/**
 * Parse DUMP response: linked list of mapping entries
 */
function parseDumpResponse(data: Uint8Array, startOffset: number): MappingEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const mappings: MappingEntry[] = [];
  let offset = startOffset;

  while (offset + 4 <= data.length) {
    const valueFollows = view.getUint32(offset); offset += 4;

    if (valueFollows === 0) break; // End of list

    if (offset + 16 > data.length) break; // Not enough data for entry

    const program = view.getUint32(offset);       offset += 4;
    const version = view.getUint32(offset);       offset += 4;
    const protocolNum = view.getUint32(offset);   offset += 4;
    const port = view.getUint32(offset);          offset += 4;

    mappings.push({
      program,
      programName: RPC_PROGRAMS[program] || `unknown (${program})`,
      version,
      protocol: PROTOCOL_NAMES[protocolNum] || `proto ${protocolNum}`,
      protocolNumber: protocolNum,
      port,
    });
  }

  return mappings;
}

/**
 * Read a complete TCP record-marked RPC response
 */
async function readRpcResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxBytes = 131072; // 128KB safety limit

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Read timeout')), timeout);
  });

  // First, read the 4-byte record mark
  let headerBuf = new Uint8Array(0);

  while (headerBuf.length < 4) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) throw new Error('Connection closed before record header');
    const newBuf = new Uint8Array(headerBuf.length + value.length);
    newBuf.set(headerBuf);
    newBuf.set(value, headerBuf.length);
    headerBuf = newBuf;
  }

  const headerView = new DataView(headerBuf.buffer, headerBuf.byteOffset, headerBuf.byteLength);
  const recordHeader = headerView.getUint32(0);
  const fragmentLength = recordHeader & 0x7FFFFFFF;

  if (fragmentLength > maxBytes) {
    throw new Error(`Fragment too large: ${fragmentLength} bytes`);
  }

  // We may have extra bytes after the header
  if (headerBuf.length > 4) {
    const extra = headerBuf.slice(4);
    chunks.push(extra);
    totalBytes += extra.length;
  }

  // Read remaining fragment data
  while (totalBytes < fragmentLength) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) break;
    chunks.push(value);
    totalBytes += value.length;
  }

  // Combine chunks
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Probe the Portmapper with a NULL procedure call
 * Verifies the portmapper is running and responsive
 */
export async function handlePortmapperProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as PortmapperProbeRequest;
    const { host, port = 111, timeout = 10000 } = body;

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

    const startTime = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Build NULL call (no args)
      const rpcCall = buildRpcCall(PMAPPROC_NULL);
      const frame = buildRecordMark(rpcCall);

      await writer.write(frame);

      // Read response
      const responseData = await readRpcResponse(reader, timeout);
      const rtt = Date.now() - startTime;

      // Parse RPC reply (NULL returns empty body on success)
      parseRpcReply(responseData);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const result: PortmapperProbeResponse = {
        success: true,
        host,
        port,
        rtt,
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
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
 * Dump all registered RPC services from the Portmapper
 * Returns a list of program→port mappings
 */
export async function handlePortmapperDump(request: Request): Promise<Response> {
  try {
    const body = await request.json() as PortmapperProbeRequest;
    const { host, port = 111, timeout = 10000 } = body;

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

    const startTime = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Build DUMP call (no args)
      const rpcCall = buildRpcCall(PMAPPROC_DUMP);
      const frame = buildRecordMark(rpcCall);

      await writer.write(frame);

      // Read response
      const responseData = await readRpcResponse(reader, timeout);
      const rtt = Date.now() - startTime;

      // Parse RPC reply header
      const { offset } = parseRpcReply(responseData);

      // Parse DUMP mapping list
      const mappings = parseDumpResponse(responseData, offset);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const result: PortmapperDumpResponse = {
        success: true,
        host,
        port,
        mappings,
        totalServices: mappings.length,
        rtt,
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
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
