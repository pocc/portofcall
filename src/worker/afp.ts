/**
 * AFP (Apple Filing Protocol) Worker Handler
 *
 * Implements AFP over DSI (Data Stream Interface) probing.
 * AFP is Apple's file sharing protocol on port 548 (TCP).
 *
 * DSI Header (16 bytes):
 *   Byte 0:    Flags (0x00 = request, 0x01 = reply)
 *   Byte 1:    Command (DSIOpenSession=4, DSICommand=2, DSIGetStatus=3, etc.)
 *   Byte 2-3:  Request ID (uint16 BE)
 *   Byte 4-7:  Error Code / Data Offset (int32 BE)
 *   Byte 8-11: Total Data Length (uint32 BE)
 *   Byte 12-15: Reserved (zeros)
 *
 * The probe sends DSIGetStatus to retrieve server info (FPGetSrvrInfo)
 * without authentication, including server name, AFP versions,
 * UAMs (User Authentication Methods), and machine type.
 */

import { connect } from 'cloudflare:sockets';

// DSI Commands
const DSI_FLAG_REQUEST = 0x00;
const DSI_FLAG_REPLY = 0x01;
const DSI_OPEN_SESSION = 0x04;
const DSI_CLOSE_SESSION = 0x01;
const DSI_COMMAND = 0x02;
const DSI_GET_STATUS = 0x03;
const DSI_TICKLE = 0x05;
const DSI_ATTENTION = 0x08;

// DSI Header size
const DSI_HEADER_SIZE = 16;

function getDSICommandName(cmd: number): string {
  switch (cmd) {
    case DSI_CLOSE_SESSION: return 'DSICloseSession';
    case DSI_COMMAND: return 'DSICommand';
    case DSI_GET_STATUS: return 'DSIGetStatus';
    case DSI_OPEN_SESSION: return 'DSIOpenSession';
    case DSI_TICKLE: return 'DSITickle';
    case DSI_ATTENTION: return 'DSIAttention';
    default: return `DSI_0x${cmd.toString(16).padStart(2, '0')}`;
  }
}

/**
 * Build a DSI header.
 */
function buildDSIHeader(flags: number, command: number, requestId: number, errorCodeOrOffset: number, dataLength: number): Uint8Array {
  const header = new Uint8Array(DSI_HEADER_SIZE);
  const view = new DataView(header.buffer);
  header[0] = flags;
  header[1] = command;
  view.setUint16(2, requestId, false); // BE
  view.setInt32(4, errorCodeOrOffset, false); // BE
  view.setUint32(8, dataLength, false); // BE
  // bytes 12-15 reserved (zeros)
  return header;
}

/**
 * Build DSIOpenSession request.
 * Includes option for requested quantum (attention quantum).
 */
export function buildDSIOpenSession(requestId: number): Uint8Array {
  // Option: Attention Quantum (type=0x01, length=4, value=1024)
  const optionData = new Uint8Array([
    0x01, // Option type: Attention Quantum
    0x04, // Option length: 4 bytes
    0x00, 0x00, 0x04, 0x00, // 1024
  ]);

  const header = buildDSIHeader(DSI_FLAG_REQUEST, DSI_OPEN_SESSION, requestId, 0, optionData.length);
  const message = new Uint8Array(DSI_HEADER_SIZE + optionData.length);
  message.set(header, 0);
  message.set(optionData, DSI_HEADER_SIZE);
  return message;
}

/**
 * Build DSIGetStatus request (FPGetSrvrInfo without auth).
 */
function buildDSIGetStatus(requestId: number): Uint8Array {
  // DSIGetStatus has no payload - it returns server info
  const header = buildDSIHeader(DSI_FLAG_REQUEST, DSI_GET_STATUS, requestId, 0, 0);
  return header;
}

/**
 * Build DSICloseSession request.
 */
function buildDSICloseSession(requestId: number): Uint8Array {
  return buildDSIHeader(DSI_FLAG_REQUEST, DSI_CLOSE_SESSION, requestId, 0, 0);
}

/**
 * Parse a DSI reply header.
 */
function parseDSIHeader(data: Uint8Array): {
  flags: number;
  command: number;
  requestId: number;
  errorCode: number;
  dataLength: number;
} | null {
  if (data.length < DSI_HEADER_SIZE) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    flags: data[0],
    command: data[1],
    requestId: view.getUint16(2, false),
    errorCode: view.getInt32(4, false),
    dataLength: view.getUint32(8, false),
  };
}

/**
 * Parse FPGetSrvrInfo response payload.
 * This is the AFP server information block returned by DSIGetStatus.
 *
 * Structure (offsets from start of payload):
 *   0-1:   Machine Type Offset (uint16 BE)
 *   2-3:   AFP Versions Offset (uint16 BE)
 *   4-5:   UAMs Offset (uint16 BE)
 *   6-7:   Volume Icon & Mask Offset (uint16 BE) — usually 0
 *   8-9:   Flags (uint16 BE)
 *   10:    Server Name (Pascal string: length byte + string)
 *
 *   At various offsets: Pascal strings or counted arrays
 */
function parseServerInfo(data: Uint8Array): {
  serverName: string;
  machineType: string;
  afpVersions: string[];
  uams: string[];
  flags: number;
  flagDescriptions: string[];
  utf8ServerName?: string;
  serverSignature?: string;
  directoryNames?: string[];
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: false });

  const machineTypeOffset = view.getUint16(0, false);
  const afpVersionsOffset = view.getUint16(2, false);
  const uamsOffset = view.getUint16(4, false);
  // const volumeIconOffset = view.getUint16(6, false);
  const flags = view.getUint16(8, false);

  // Parse server name (Pascal string at offset 10)
  const serverNameLen = data[10];
  const serverName = decoder.decode(data.subarray(11, 11 + serverNameLen));

  // Parse flags
  const flagDescriptions: string[] = [];
  if (flags & 0x01) flagDescriptions.push('CopyFile');
  if (flags & 0x02) flagDescriptions.push('ChangeablePasswords');
  if (flags & 0x04) flagDescriptions.push('NoSavePassword');
  if (flags & 0x08) flagDescriptions.push('ServerMessages');
  if (flags & 0x10) flagDescriptions.push('ServerSignature');
  if (flags & 0x20) flagDescriptions.push('TCPoverIP');
  if (flags & 0x40) flagDescriptions.push('ServerNotifications');
  if (flags & 0x80) flagDescriptions.push('Reconnect');
  if (flags & 0x100) flagDescriptions.push('DirectoryServices');
  if (flags & 0x200) flagDescriptions.push('UTF8ServerName');
  if (flags & 0x400) flagDescriptions.push('UUIDs');
  if (flags & 0x800) flagDescriptions.push('SuperClient');

  // Parse machine type (Pascal string)
  let machineType = '';
  if (machineTypeOffset > 0 && machineTypeOffset < data.length) {
    const mtLen = data[machineTypeOffset];
    if (machineTypeOffset + 1 + mtLen <= data.length) {
      machineType = decoder.decode(data.subarray(machineTypeOffset + 1, machineTypeOffset + 1 + mtLen));
    }
  }

  // Parse AFP versions (counted array of Pascal strings)
  const afpVersions: string[] = [];
  if (afpVersionsOffset > 0 && afpVersionsOffset < data.length) {
    const count = data[afpVersionsOffset];
    let offset = afpVersionsOffset + 1;
    for (let i = 0; i < count && offset < data.length; i++) {
      const len = data[offset];
      offset++;
      if (offset + len <= data.length) {
        afpVersions.push(decoder.decode(data.subarray(offset, offset + len)));
      }
      offset += len;
    }
  }

  // Parse UAMs (counted array of Pascal strings)
  const uams: string[] = [];
  if (uamsOffset > 0 && uamsOffset < data.length) {
    const count = data[uamsOffset];
    let offset = uamsOffset + 1;
    for (let i = 0; i < count && offset < data.length; i++) {
      const len = data[offset];
      offset++;
      if (offset + len <= data.length) {
        uams.push(decoder.decode(data.subarray(offset, offset + len)));
      }
      offset += len;
    }
  }

  // Parse server signature (16 bytes at offset after volume icon if flag is set)
  let serverSignature: string | undefined;
  if (flags & 0x10) {
    // Server signature is typically at a fixed offset after the standard fields
    // We need to find it by checking if there are additional offsets
    // For simplicity, check after the standard structure
    const sigOffset = 11 + serverNameLen;
    // Align to even boundary
    const alignedOffset = sigOffset + (sigOffset % 2);
    if (alignedOffset + 16 <= data.length) {
      // Check for signature offset in the extended header
      // This is a simplification; real parsing would follow the offsets
    }
  }

  // Parse UTF-8 server name if flag is set
  let utf8ServerName: string | undefined;
  if (flags & 0x200) {
    // UTF8 server name offset is at a specific location in extended info
    // We rely on the Pascal name for now
  }

  // Parse directory names if available
  const directoryNames: string[] = [];

  return {
    serverName,
    machineType,
    afpVersions,
    uams,
    flags,
    flagDescriptions,
    utf8ServerName,
    serverSignature,
    directoryNames: directoryNames.length > 0 ? directoryNames : undefined,
  };
}

/**
 * Read exact number of bytes with timeout.
 */
async function readExact(reader: ReadableStreamDefaultReader<Uint8Array>, length: number, timeoutMs: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let offset = 0;
  const deadline = Date.now() + timeoutMs;

  while (offset < length) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Read timeout');

    const readPromise = reader.read();
    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
      setTimeout(() => resolve({ done: true, value: undefined }), remaining)
    );

    const { done, value } = await Promise.race([readPromise, timeoutPromise]);
    if (done || !value) throw new Error('Connection closed');

    const toCopy = Math.min(value.length, length - offset);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
  }

  return buffer;
}

/**
 * Handle AFP server status probe via DSIGetStatus.
 * No authentication required — returns server info.
 */
export async function handleAFPConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json() as {
      host?: string;
      port?: number;
      timeout?: number;
    };

    const host = (body.host || '').trim();
    const port = body.port ?? 548;
    const timeout = Math.min(body.timeout || 10000, 30000);

    // Validation
    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();

    // Connect to AFP server
    const socket = connect({ hostname: host, port });
    await socket.opened;
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      let requestId = 0;

      // Step 1: Send DSIGetStatus (this works without DSIOpenSession)
      const getStatusMsg = buildDSIGetStatus(requestId++);
      await writer.write(getStatusMsg);

      // Read DSI reply header
      const replyHeader = await readExact(reader, DSI_HEADER_SIZE, timeout - connectTime);
      const header = parseDSIHeader(replyHeader);

      if (!header) {
        return new Response(JSON.stringify({
          success: false, error: 'Invalid DSI reply header',
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      if (header.flags !== DSI_FLAG_REPLY) {
        return new Response(JSON.stringify({
          success: false,
          error: `Unexpected DSI flags: 0x${header.flags.toString(16)} (expected reply)`,
          dsiCommand: getDSICommandName(header.command),
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      if (header.errorCode !== 0) {
        return new Response(JSON.stringify({
          success: true,
          host, port,
          status: 'error',
          dsiCommand: getDSICommandName(header.command),
          errorCode: header.errorCode,
          connectTime,
          rtt: Date.now() - startTime,
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      // Read payload
      let serverInfo = null;
      if (header.dataLength > 0 && header.dataLength < 65536) {
        const payload = await readExact(reader, header.dataLength, timeout - (Date.now() - startTime));
        serverInfo = parseServerInfo(payload);
      }

      // Clean up: send DSICloseSession
      try {
        const closeMsg = buildDSICloseSession(requestId++);
        await writer.write(closeMsg);
      } catch {
        // Ignore cleanup errors
      }

      const rtt = Date.now() - startTime;

      return new Response(JSON.stringify({
        success: true,
        host, port,
        status: 'connected',
        dsiCommand: getDSICommandName(header.command),
        serverName: serverInfo?.serverName,
        machineType: serverInfo?.machineType,
        afpVersions: serverInfo?.afpVersions,
        uams: serverInfo?.uams,
        flags: serverInfo?.flags,
        flagDescriptions: serverInfo?.flagDescriptions,
        utf8ServerName: serverInfo?.utf8ServerName,
        connectTime,
        rtt,
      }), { headers: { 'Content-Type': 'application/json' } });
    } finally {
      reader.releaseLock();
      writer.releaseLock();
      await socket.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'AFP connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
