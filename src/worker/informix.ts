/**
 * Informix Protocol Implementation
 *
 * IBM Informix Dynamic Server (IDS) uses the SQLI (SQL Interface) wire protocol.
 * This is a binary protocol with a 4-byte length-prefixed message format.
 *
 * Connection Flow:
 * 1. Client → Server: SQLI connect packet (with username, database, client info)
 * 2. Server → Client: Server banner (version, capabilities)
 * 3. Client → Server: Authentication credentials
 * 4. Server → Client: Authentication result (accept/reject)
 * 5. Client → Server: SQL query
 * 6. Server → Client: Result set rows
 *
 * Common Ports:
 * - 1526: sqlexec service (default)
 * - 9088: onsoctcp service
 * - 9090: alternative service
 */

import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const dec = new TextDecoder();

interface InformixRequest {
  host: string;
  port?: number;
  timeout?: number;
  username?: string;
  password?: string;
  database?: string;
}

interface InformixResponse {
  success: boolean;
  host: string;
  port: number;
  serverInfo?: string;
  version?: string;
  isInformix?: boolean;
  dataLength?: number;
  rtt?: number;
  rows?: string[][];
  error?: string;
}

/**
 * Build an Informix SQLI connect packet.
 *
 * Structure (simplified SQLI connect):
 *   [2 bytes: packet length BE][1 byte: type=0x01][username\0][database\0][client\0]
 */
function buildSQLIConnect(username: string, database: string): Uint8Array {
  const userBytes = enc.encode(username + '\0');
  const dbBytes   = enc.encode(database + '\0');
  const appBytes  = enc.encode('portofcall\0');
  // Informix SQLI header: type=0x01 (connect), followed by null-terminated fields
  const header = new Uint8Array([0x00, 0x01]); // type field

  const payloadLen = header.length + userBytes.length + dbBytes.length + appBytes.length;
  // Packet: [uint16BE length][payload]
  const pkt = new Uint8Array(2 + payloadLen);
  const dv  = new DataView(pkt.buffer);
  dv.setUint16(0, payloadLen, false); // big-endian length

  let off = 2;
  pkt.set(header,   off); off += header.length;
  pkt.set(userBytes, off); off += userBytes.length;
  pkt.set(dbBytes,  off); off += dbBytes.length;
  pkt.set(appBytes, off);
  return pkt;
}

/**
 * Parse the Informix server response for banner/version info.
 */
function parseInformixResponse(data: Uint8Array): {
  hasResponse: boolean;
  isInformix: boolean;
  serverInfo?: string;
  version?: string;
} {
  if (data.length === 0) {
    return { hasResponse: false, isInformix: false };
  }

  // Try to decode printable portion for banner strings
  const printable = dec.decode(data.subarray(0, Math.min(512, data.length)));

  // Informix servers include recognisable strings in their banners
  const isInformix =
    printable.includes('Informix') ||
    printable.includes('IDS') ||
    printable.includes('sqlexec') ||
    printable.includes('onsoc') ||
    printable.includes('IBM');

  // Try to extract a version string, e.g. "IBM Informix Dynamic Server 14.10"
  const versionMatch = printable.match(/(?:Informix.*?|IDS)\s+(\d+\.\d+)/i);

  // Heuristic for binary Informix protocol responses
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const binaryHeuristic =
    !isInformix &&
    data.length >= 8 &&
    (() => {
      const len = dv.getUint16(0, false); // big-endian length field
      return len > 0 && len < 4096 && data.some(b => b === 0);
    })();

  return {
    hasResponse: true,
    isInformix: isInformix || binaryHeuristic,
    serverInfo: isInformix ? printable.slice(0, 256).trim() : undefined,
    version: versionMatch ? versionMatch[1] : undefined,
  };
}

/**
 * Read all available data from a socket reader with a per-read timeout.
 */
async function readAll(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const timeoutErr = new Error('read timeout');

  while (true) {
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>(resolve =>
        setTimeout(() => resolve({ done: true, value: undefined }), timeoutMs),
      ),
    ]);
    if (result.done || !result.value || result.value.length === 0) break;
    chunks.push(result.value);
    // Stop after first chunk if we have data — server sends banner then waits
    if (chunks.length >= 1) break;
  }

  if (chunks.length === 0) throw timeoutErr;
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Probe an Informix server.  Sends an SQLI connect packet and checks
 * the response for Informix-specific signatures.
 */
export async function handleInformixProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as InformixRequest;
    const { host, port = 1526, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false, host: '', port,
        error: 'Host is required',
      } satisfies InformixResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false, host, port,
        error: 'Port must be between 1 and 65535',
      } satisfies InformixResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const start  = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      await writer.write(buildSQLIConnect('probe', 'sysmaster'));
      writer.releaseLock();

      const reader = socket.readable.getReader();
      let data: Uint8Array;
      try {
        data = await Promise.race([readAll(reader, 4000), timeoutPromise]);
      } catch {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false, host, port,
          error: 'No response from server',
        } satisfies InformixResponse), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      reader.releaseLock();
      socket.close();

      const rtt    = Date.now() - start;
      const parsed = parseInformixResponse(data);

      return new Response(JSON.stringify({
        success:    parsed.isInformix,
        host, port,
        isInformix: parsed.isInformix,
        serverInfo: parsed.serverInfo,
        version:    parsed.version,
        dataLength: data.length,
        rtt,
        ...(parsed.isInformix ? {} : { error: 'Server does not appear to be Informix' }),
      } satisfies InformixResponse), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, host: '', port: 1526,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies InformixResponse), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Get Informix server version information (alias for probe).
 */
export async function handleInformixVersion(request: Request): Promise<Response> {
  return handleInformixProbe(request);
}

/**
 * Execute a query against an Informix server.
 *
 * Sends a minimal SQLI connect + authentication packet, then sends a
 * SQLI query packet and collects the result rows.
 *
 * Body: { host, port?, username, password, database?, timeout? }
 * Body: { host, port?, username, password, database?, query?, timeout? }
 */
export async function handleInformixQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as InformixRequest & { query?: string };
    const {
      host, port = 1526, timeout = 20000,
      username = 'informix', password = '',
      database = 'sysmaster',
    } = body;
    const query = (body as { query?: string }).query ?? 'SELECT tabname FROM systables WHERE tabid < 10';

    if (!host) {
      return new Response(JSON.stringify({
        success: false, host: '', port,
        error: 'Host is required',
      } satisfies InformixResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const start  = Date.now();
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();

      // Step 1: Send connect packet
      await writer.write(buildSQLIConnect(username, database));

      // Step 2: Read server banner / challenge
      const reader = socket.readable.getReader();
      let banner: Uint8Array;
      try {
        banner = await Promise.race([readAll(reader, 5000), timeoutPromise]);
      } catch {
        reader.releaseLock();
        writer.close();
        socket.close();
        return new Response(JSON.stringify({
          success: false, host, port,
          error: 'Server did not respond to connect packet',
        } satisfies InformixResponse), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parseInformixResponse(banner);
      if (!parsed.isInformix) {
        reader.releaseLock();
        writer.close();
        socket.close();
        return new Response(JSON.stringify({
          success: false, host, port,
          error: 'Server does not appear to be Informix',
          dataLength: banner.length,
        } satisfies InformixResponse), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // Step 3: Send a SQLI password/auth packet
      // Type 0x02 = password packet: [uint16BE len][0x00 0x02][password\0]
      const pwBytes  = enc.encode(password + '\0');
      const authPkt  = new Uint8Array(2 + 2 + pwBytes.length);
      const authDv   = new DataView(authPkt.buffer);
      authDv.setUint16(0, 2 + pwBytes.length, false);
      authPkt[2] = 0x00;
      authPkt[3] = 0x02;
      authPkt.set(pwBytes, 4);
      await writer.write(authPkt);

      // Step 4: Read auth response
      let authResp: Uint8Array | null = null;
      try {
        authResp = await Promise.race([readAll(reader, 5000), timeoutPromise]);
      } catch {
        // Some servers close connection on bad auth; treat as auth failure
      }

      const authStr = authResp ? dec.decode(authResp.subarray(0, 128)) : '';
      const authFailed =
        !authResp ||
        authStr.includes('error') ||
        authStr.includes('fail') ||
        authStr.includes('denied');

      if (authFailed) {
        reader.releaseLock();
        writer.close();
        socket.close();
        return new Response(JSON.stringify({
          success: false, host, port,
          isInformix: true,
          serverInfo: parsed.serverInfo,
          version: parsed.version,
          error: 'Authentication failed',
          rtt: Date.now() - start,
        } satisfies InformixResponse), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // Step 5: Send a SQLI query packet
      // Type 0x05 = execute: [uint16BE len][0x00 0x05][sql\0]
      const sqlBytes  = enc.encode(query + '\0');
      const queryPkt  = new Uint8Array(2 + 2 + sqlBytes.length);
      const queryDv   = new DataView(queryPkt.buffer);
      queryDv.setUint16(0, 2 + sqlBytes.length, false);
      queryPkt[2] = 0x00;
      queryPkt[3] = 0x05;
      queryPkt.set(sqlBytes, 4);
      await writer.write(queryPkt);

      // Step 6: Collect result rows
      const resultChunks: Uint8Array[] = [];
      const readDeadline = Date.now() + 8000;
      while (Date.now() < readDeadline) {
        try {
          const chunk = await Promise.race([
            readAll(reader, 2000),
            timeoutPromise,
          ]);
          resultChunks.push(chunk);
          if (resultChunks.length >= 8) break;
        } catch {
          break;
        }
      }

      reader.releaseLock();
      writer.close();
      socket.close();

      // Parse results: extract printable strings as rows
      const rows: string[][] = [];
      for (const chunk of resultChunks) {
        const text = dec.decode(chunk);
        // Split on null bytes and collect non-empty strings
        const parts = text.split('\0').map(s => s.trim()).filter(s => s.length > 0);
        if (parts.length > 0) rows.push(parts);
      }

      return new Response(JSON.stringify({
        success: true,
        host, port,
        isInformix: true,
        serverInfo: parsed.serverInfo,
        version: parsed.version,
        rows,
        rtt: Date.now() - start,
      } satisfies InformixResponse), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, host: '', port: 1526,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies InformixResponse), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
