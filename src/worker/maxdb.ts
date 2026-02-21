/**
 * SAP MaxDB Database Protocol Implementation
 *
 * MaxDB (formerly SAP DB) is a relational database management system.
 * It uses the SAP NI (Network Interface) protocol for client-server communication.
 *
 * Ports: 7200 (global listener / X Server), 7210 (sql6 service)
 *
 * NI Protocol Flow:
 *   1. Client → global listener: NI_CONNECT_REQUEST
 *   2. Listener → Client: NI_CONNECT_RESPONSE with X Server port
 *   3. Client → X Server: database-level connect + auth + SQL
 *
 * NI Packet Format:
 *   Bytes 0-3:  Total length (big-endian uint32, includes header)
 *   Byte  4:    NI protocol version (0x03)
 *   Byte  5:    Message type (0x00=data, 0x04=connect, 0x05=error, 0xFF=info)
 *   Bytes 6-7:  Return code (uint16 big-endian, 0 = success)
 *   Bytes 8+:   Payload
 *
 * Connect payload (client→listener):
 *   Null-terminated service descriptor string, e.g. "D=MAXDB\n\n\r\0"
 *
 * Connect response (listener→client):
 *   4-byte X Server port (big-endian uint32) if success, or error message
 *
 * References:
 *   SAP MaxDB developer documentation (SQLDBC, libSQLDBC, pyMaxDB)
 *   https://maxdb.sap.com/doc/7_8/
 *
 * Endpoints:
 *   POST /api/maxdb/connect  — NI handshake + version + X Server port discovery
 *   POST /api/maxdb/probe    — alias for connect
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

interface MaxDBRequest {
  host: string;
  port?: number;
  database?: string;
  timeout?: number;
}

// NI message type bytes
const NI_CONNECT  = 0x04;
const NI_DATA     = 0x00;
const NI_ERROR    = 0x05;
const NI_INFO     = 0xFF;

function niTypeName(t: number): string {
  switch (t) {
    case NI_CONNECT: return 'CONNECT';
    case NI_DATA:    return 'DATA';
    case NI_ERROR:   return 'ERROR';
    case NI_INFO:    return 'INFO';
    default: return `0x${t.toString(16).padStart(2, '0')}`;
  }
}

/**
 * Build an NI packet.
 * [4 bytes len BE][1 byte version=3][1 byte type][2 bytes rc=0][payload]
 */
function buildNIPacket(type: number, payload: Uint8Array): Uint8Array {
  const totalLen = 8 + payload.length;
  const pkt = new Uint8Array(totalLen);
  const dv = new DataView(pkt.buffer);
  dv.setUint32(0, totalLen, false);  // big-endian total length
  pkt[4] = 0x03;                     // NI protocol version
  pkt[5] = type;                     // message type
  dv.setUint16(6, 0, false);         // return code = 0 (success)
  pkt.set(payload, 8);
  return pkt;
}

/**
 * Parse an NI packet header.
 */
function parseNIPacket(data: Uint8Array): {
  totalLen: number;
  version: number;
  type: number;
  typeName: string;
  rc: number;
  payload: Uint8Array;
} | null {
  if (data.length < 8) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const totalLen = dv.getUint32(0, false);
  const version = data[4];
  const type = data[5];
  const rc = dv.getUint16(6, false);
  // Payload is from byte 8 to the end of the packet (limited by totalLen)
  const payloadEnd = Math.min(totalLen, data.length);
  const payload = data.slice(8, payloadEnd);
  return { totalLen, version, type, typeName: niTypeName(type), rc, payload };
}

/**
 * Read until we have a full NI packet (reads by length prefix).
 */
async function readNIResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalRead = 0;
  let expectedLen = -1;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read timeout')), deadline - Date.now())),
      ]);
    } catch {
      break;
    }
    if (result.done || !result.value) break;
    chunks.push(result.value);
    totalRead += result.value.length;

    // Once we have 4+ bytes, extract the expected total packet length
    if (expectedLen < 0 && totalRead >= 4) {
      const combined = new Uint8Array(totalRead);
      let off = 0;
      for (const c of chunks) { combined.set(c, off); off += c.length; }
      const dv = new DataView(combined.buffer);
      expectedLen = dv.getUint32(0, false);
      // Sanity check: if the length field is unreasonable (< 8 bytes for header, or > 1 MB),
      // treat as non-NI data and return what we have
      if (expectedLen < 8 || expectedLen > 1_048_576) break;
    }

    if (expectedLen > 0 && totalRead >= expectedLen) break;
  }

  const combined = new Uint8Array(totalRead);
  let off = 0;
  for (const c of chunks) { combined.set(c, off); off += c.length; }
  return combined;
}

/**
 * Handle MaxDB NI connect: discover version and X Server port.
 *
 * POST /api/maxdb/connect
 * Body: { host, port?, database?, timeout? }
 * Returns: { success, host, port, niVersion, xServerPort?, database, serverInfo?, rtt }
 */
export async function handleMaxDBConnect(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await request.json() as MaxDBRequest;
    const { host, port = 7210, database = 'MAXDB', timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false, error: 'Host is required',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
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
    const tp = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, tp]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // NI CONNECT: service descriptor identifies which database to connect to
        // Format: "D={database}\n\n\r\0" (SAP NI routing string, null-terminated)
        const serviceDesc = enc.encode(`D=${database}\n\n\r\0`);
        const connectPkt = buildNIPacket(NI_CONNECT, serviceDesc);
        await writer.write(connectPkt);

        // Read NI response
        const respData = await Promise.race([readNIResponse(reader, Math.min(timeout, 8000)), tp]);
        const rtt = Date.now() - start;

        if (respData.length === 0) {
          return new Response(JSON.stringify({
            success: false, host, port, database,
            error: 'No response from MaxDB (port open but no NI response)',
            rtt,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        const parsed = parseNIPacket(respData);

        if (!parsed) {
          // Got data but not an NI packet — might still be MaxDB with different protocol
          const hexDump = Array.from(respData.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
          const text = dec.decode(respData.slice(0, 128)).replace(/\0/g, '').trim();
          return new Response(JSON.stringify({
            success: true,
            host, port, database,
            note: 'Received response (may be pre-NI or different MaxDB variant)',
            responseHex: hexDump,
            responseText: text || undefined,
            byteCount: respData.length,
            rtt,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        const result: Record<string, unknown> = {
          success: parsed.rc === 0,
          host, port, database,
          niVersion: parsed.version,
          messageType: parsed.typeName,
          returnCode: parsed.rc,
          rtt,
        };

        if (parsed.type === NI_ERROR || parsed.rc !== 0) {
          result.success = false;
          result.error = dec.decode(parsed.payload).replace(/\0/g, '').trim() || `NI error: rc=${parsed.rc}`;
        } else if (parsed.type === NI_CONNECT || parsed.type === NI_DATA) {
          // Successful connect response — payload is the X Server port (4 bytes BE)
          if (parsed.payload.length >= 4) {
            const dv = new DataView(parsed.payload.buffer, parsed.payload.byteOffset, parsed.payload.byteLength);
            const xPort = dv.getUint32(0, false);
            if (xPort > 0 && xPort < 65536) {
              result.xServerPort = xPort;
              result.note = `MaxDB X Server is listening on port ${xPort}. Use this port for database-level connections.`;
            }
          }
          // Any text in payload
          const payloadText = dec.decode(parsed.payload).replace(/\0/g, '').trim();
          if (payloadText) result.serverInfo = payloadText.slice(0, 256);
        } else if (parsed.type === NI_INFO) {
          const info = dec.decode(parsed.payload).replace(/\0/g, '').trim();
          result.serverInfo = info.slice(0, 256);
        }

        return new Response(JSON.stringify(result), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });

      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { socket.close(); } catch { /* ignore */ }
      }

    } catch (error) {
      try { socket.close(); } catch { /* ignore */ }
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
      latencyMs: Date.now() - start,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * MaxDB info probe: enumerate available databases via NI_INFO request,
 * then optionally probe the X Server directly to get version info.
 *
 * NI_INFO (type 0xFF) sent to the global listener returns a list of
 * registered databases with their X Server ports and status.
 *
 * POST /api/maxdb/info
 * Body: { host, port=7210, timeout=10000 }
 * Returns: { success, host, port, databases?, rawInfo?, rtt }
 */
export async function handleMaxDBInfo(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await request.json() as MaxDBRequest;
    const { host, port = 7210, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
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

    const socket = connect(`${host}:${port}`);
    const tp = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, tp]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // NI INFO (0xFF) — request service list from the NI listener
        const infoPkt = buildNIPacket(NI_INFO, new Uint8Array(0));
        await writer.write(infoPkt);

        const respData = await Promise.race([readNIResponse(reader, Math.min(timeout, 6000)), tp]);
        const rtt = Date.now() - start;

        if (respData.length === 0) {
          return new Response(JSON.stringify({
            success: false, host, port,
            error: 'No response to NI_INFO (MaxDB may require NI_CONNECT first)',
            rtt,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        const parsed = parseNIPacket(respData);
        const rawText = parsed
          ? dec.decode(parsed.payload).replace(/\0/g, '\n').trim()
          : dec.decode(respData).replace(/\0/g, '\n').trim();

        // Parse database listing: lines like "DBNAME  <xserver-port>  <status>"
        const databases: Array<{ name: string; xServerPort?: number; info?: string }> = [];
        for (const line of rawText.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 1 && /^[A-Z][A-Z0-9_]{0,17}$/i.test(parts[0])) {
            const entry: { name: string; xServerPort?: number; info?: string } = { name: parts[0] };
            if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
              entry.xServerPort = parseInt(parts[1], 10);
            }
            if (parts.length >= 3) {
              entry.info = parts.slice(2).join(' ');
            }
            databases.push(entry);
          }
        }

        return new Response(JSON.stringify({
          success: true,
          host, port,
          niVersion: parsed?.version,
          messageType: parsed?.typeName,
          returnCode: parsed?.rc,
          databases: databases.length > 0 ? databases : undefined,
          rawInfo: rawText.slice(0, 1024) || undefined,
          rtt,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });

      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { socket.close(); } catch { /* ignore */ }
      }

    } catch (error) {
      try { socket.close(); } catch { /* ignore */ }
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
      latencyMs: Date.now() - start,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * MaxDB database session — NI_CONNECT to global listener to discover X Server port,
 * then connect directly to that X Server and initiate a database-level session.
 *
 * Demonstrates reaching the actual database process (X Server) rather than just
 * the NI router. The X Server sends an initial session greeting/challenge.
 *
 * POST /api/maxdb/session
 * Body: { host, port?, database?, timeout? }
 * Returns: { success, host, port, database, xServerPort, xServerResponse,
 *            niVersion, xServerConnected, sessionBytes, sessionHex, rtt }
 */
export async function handleMaxDBSession(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await request.json() as MaxDBRequest;
    const { host, port = 7210, database = 'MAXDB', timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip),
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const toHex = (arr: Uint8Array) =>
      Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(' ');

    let xServerPort: number | undefined;
    let niVersion: number | undefined;
    let niRc: number | undefined;

    // -----------------------------------------------------------------------
    // Step 1: NI_CONNECT to global listener → discover X Server port
    // -----------------------------------------------------------------------
    {
      const tp = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('NI connect timeout')), Math.min(timeout / 2, 8000)));
      const socket = connect(`${host}:${port}`);
      try {
        await Promise.race([socket.opened, tp]);
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        // Service descriptor: "D=<database>\n\n\r\0"
        const svcDesc = enc.encode(`D=${database}\n\n\r\0`);
        const connectPkt = buildNIPacket(NI_CONNECT, svcDesc);
        await writer.write(connectPkt);

        const respData = await Promise.race([readNIResponse(reader, 5000), tp]);
        const parsed = parseNIPacket(respData);
        if (parsed) {
          niVersion = parsed.version;
          niRc      = parsed.rc;
          // X Server port is in the first 4 bytes of the payload (big-endian)
          if (parsed.rc === 0 && parsed.payload.length >= 4) {
            const dv = new DataView(parsed.payload.buffer, parsed.payload.byteOffset);
            xServerPort = dv.getUint32(0, false);
          }
        }

        try { reader.releaseLock(); } catch { /* ok */ }
        try { writer.releaseLock(); } catch { /* ok */ }
      } finally {
        try { socket.close(); } catch { /* ok */ }
      }
    }

    const rtt1 = Date.now() - start;

    if (!xServerPort || xServerPort === 0 || xServerPort > 65535) {
      return new Response(JSON.stringify({
        success: false,
        host, port, database,
        niVersion,
        niRc,
        xServerPort,
        rtt: rtt1,
        error: xServerPort
          ? `NI listener returned X Server port ${xServerPort} (out of range or invalid)`
          : niRc !== undefined
            ? `NI listener returned rc=${niRc} (database "${database}" not found or unavailable)`
            : 'NI listener did not return an X Server port',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // -----------------------------------------------------------------------
    // Step 2: Connect directly to X Server and send NI_CONNECT for session
    // -----------------------------------------------------------------------
    let xServerConnected = false;
    let sessionBytes = 0;
    let sessionHex: string | undefined;
    let xServerResponse: string | undefined;

    {
      const remaining = timeout - (Date.now() - start);
      if (remaining > 1000) {
        const tp = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('X Server timeout')), remaining));
        const socket = connect(`${host}:${xServerPort}`);
        try {
          await Promise.race([socket.opened, tp]);
          xServerConnected = true;

          const writer = socket.writable.getWriter();
          const reader = socket.readable.getReader();

          // Send another NI_CONNECT to the X Server with the database name
          const svcDesc2 = enc.encode(`D=${database}\n\n\r\0`);
          const connectPkt2 = buildNIPacket(NI_CONNECT, svcDesc2);
          await writer.write(connectPkt2);

          try {
            const respData2 = await Promise.race([readNIResponse(reader, Math.min(remaining - 500, 5000)), tp]);
            sessionBytes = respData2.length;
            sessionHex = toHex(respData2.slice(0, 32)) + (respData2.length > 32 ? '...' : '');

            const parsed2 = parseNIPacket(respData2);
            if (parsed2) {
              xServerResponse = `NI type=${parsed2.typeName} rc=${parsed2.rc} ` +
                `payloadLen=${parsed2.payload.length}` +
                (parsed2.payload.length > 0
                  ? ` payload=${dec.decode(parsed2.payload.slice(0, 64)).replace(/[^\x20-\x7E]/g, '.').slice(0, 64)}`
                  : '');
            } else if (respData2.length > 0) {
              xServerResponse = `Raw: ${toHex(respData2.slice(0, 16))} (${respData2.length} bytes)`;
            }
          } catch {
            // No response from X Server
          }

          try { reader.releaseLock(); } catch { /* ok */ }
          try { writer.releaseLock(); } catch { /* ok */ }
        } finally {
          try { socket.close(); } catch { /* ok */ }
        }
      }
    }

    const rtt = Date.now() - start;

    return new Response(JSON.stringify({
      success: xServerConnected,
      host, port, database,
      niVersion,
      niRc,
      xServerPort,
      xServerConnected,
      xServerResponse,
      sessionBytes,
      sessionHex,
      rtt,
      note: xServerConnected
        ? `Connected to MaxDB X Server on port ${xServerPort} for database "${database}". ` +
          'Full SQL execution requires SQLDBC binary protocol (proprietary).'
        : `NI listener redirected to X Server port ${xServerPort} but connection failed.`,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
      latencyMs: Date.now() - start,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
