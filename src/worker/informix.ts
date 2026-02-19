/**
 * Informix Protocol Implementation
 *
 * IBM Informix Dynamic Server (IDS) uses the SQLI (SQL Interface) wire protocol
 * for client-server communication.  SQLI is a proprietary binary protocol that
 * predates DRDA; modern Informix also supports DRDA on a separate port, but
 * native clients (dbaccess, ESQL/C, Informix JDBC type-4) speak SQLI.
 *
 * Wire format:
 *   Every SQLI message is framed as:
 *     [4 bytes: payload length, big-endian][payload]
 *   The first message from the client is a connection string — a sequence of
 *   null-terminated key=value pairs identifying the client, user, database,
 *   protocol version, etc.
 *
 * Connection Flow (SQLI over onsoctcp):
 *   1. TCP connect to the onsoctcp listener (default port 9088)
 *   2. Client -> Server: connection parameters (null-delimited key-value pairs)
 *      wrapped in a 4-byte length-prefixed frame
 *   3. Server -> Client: server identification / challenge
 *   4. Client -> Server: authentication response (password or challenge-response)
 *   5. Server -> Client: authentication result (SQ_EOT on success, SQ_ERR on failure)
 *   6. Client -> Server: SQ_PREPARE / SQ_EXECUTE / SQ_COMMAND / etc.
 *   7. Server -> Client: SQ_DESCRIBE, row data, SQ_EOT
 *
 * Well-known Ports:
 *   - 9088: onsoctcp  — standard TCP listener (SQLI protocol)
 *   - 9089: onsoctcp_ssl — TLS-wrapped SQLI
 *   - 1526: sqlexec   — legacy listener (Informix < 7.x, rarely used today)
 *
 * SQ_PROTOCOLS Negotiation:
 *   During the initial handshake the client advertises its supported SQLI
 *   protocol version (e.g. "SQLI 7.31") and the server responds with the
 *   version it will use.  The protocol version controls available message
 *   types, data-type encodings, and features like scrollable cursors.
 *
 * Note: This implementation is a *probe*-level client.  It constructs a
 * connection packet that is close enough to trigger an Informix server response,
 * then fingerprints the reply.  It does not implement the full SQLI state machine
 * required for robust query execution — use DRDA (drda.ts) or a proper JDBC/ODBC
 * driver for production workloads.
 */

import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Default port for Informix onsoctcp (SQLI) listener */
const INFORMIX_DEFAULT_PORT = 9088;

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
 * Build an Informix SQLI connection packet.
 *
 * The SQLI handshake begins with a length-prefixed block of null-terminated
 * key-value fields.  The server uses these to identify the client, locate the
 * requested database, and determine the protocol level.
 *
 * Observed field order (from JDBC driver traces and Wireshark captures):
 *   "ol_<servername>\0"      — service name hint (can be blank)
 *   "<username>\0"           — OS/database user
 *   "<password_placeholder>\0" — placeholder (actual auth is a later exchange)
 *   "<database>\0"           — database name (e.g. "sysmaster")
 *   "SQLI\0"                 — protocol identifier
 *   "7.31\0"                 — protocol version (client-advertised)
 *   "<client_app>\0"         — client application name
 *
 * The entire payload is prefixed by a 4-byte big-endian length (of just the
 * payload, not including the 4-byte length field itself).
 */
function buildSQLIConnect(username: string, database: string): Uint8Array {
  // Build null-terminated fields in the order Informix expects
  const fields = [
    'ol_portofcall',   // service name hint (arbitrary; server ignores if unknown)
    username,          // user
    '',                // password placeholder (empty for initial connect)
    database,          // database to open
    'SQLI',            // protocol identifier
    '7.31',            // advertised SQLI protocol version
    'portofcall',      // client application name
  ];

  // Each field is null-terminated
  const fieldBytes = fields.map(f => enc.encode(f + '\0'));
  const payloadLen = fieldBytes.reduce((sum, b) => sum + b.length, 0);

  // Frame: [uint32BE payload length][payload]
  const pkt = new Uint8Array(4 + payloadLen);
  const dv = new DataView(pkt.buffer);
  dv.setUint32(0, payloadLen, false); // big-endian 4-byte length

  let off = 4;
  for (const fb of fieldBytes) {
    pkt.set(fb, off);
    off += fb.length;
  }
  return pkt;
}

/**
 * Build an SQLI authentication packet.
 *
 * After the server responds to the connection string, the client sends the
 * actual password in a 4-byte length-prefixed frame.  For native (non-PAM,
 * non-challenge-response) auth this is simply the cleartext password followed
 * by a null terminator.
 */
function buildSQLIAuthPacket(password: string): Uint8Array {
  const pwBytes = enc.encode(password + '\0');
  const pkt = new Uint8Array(4 + pwBytes.length);
  const dv = new DataView(pkt.buffer);
  dv.setUint32(0, pwBytes.length, false);
  pkt.set(pwBytes, 4);
  return pkt;
}

/**
 * Build an SQLI command packet.
 *
 * SQLI command messages (SQ_COMMAND / SQ_PREPARE) carry a 2-byte command type
 * after the 4-byte length prefix, followed by the SQL text (null-terminated).
 *
 * Known command type codes:
 *   0x01: SQ_COMMAND  — immediate execution (like a "direct" statement)
 *   0x02: SQ_PREPARE  — prepare a statement
 *   0x03: SQ_EXECUTE  — execute a prepared statement
 *   0x04: SQ_DESCRIBE — describe columns
 *   0x05: SQ_FETCH    — fetch next row
 */
function buildSQLICommandPacket(sql: string, cmdType: number = 0x01): Uint8Array {
  const sqlBytes = enc.encode(sql + '\0');
  const payloadLen = 2 + sqlBytes.length; // 2 bytes cmd type + sql
  const pkt = new Uint8Array(4 + payloadLen);
  const dv = new DataView(pkt.buffer);
  dv.setUint32(0, payloadLen, false);
  dv.setUint16(4, cmdType, false); // command type
  pkt.set(sqlBytes, 6);
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

  // Informix servers include recognisable strings in their responses
  const isInformix =
    printable.includes('Informix') ||
    printable.includes('IDS') ||
    printable.includes('sqlexec') ||
    printable.includes('onsoc') ||
    printable.includes('IBM') ||
    printable.includes('SQLI');

  // Try to extract a version string, e.g. "IBM Informix Dynamic Server 14.10"
  // Also match "Version 14.10" or standalone "IDS/14.10"
  const versionMatch = printable.match(
    /(?:Informix.*?|IDS[/ ])\s*(\d+\.\d+(?:\.\w+)?)/i
  );

  // Heuristic for binary SQLI responses: check for valid 4-byte length prefix
  // that is consistent with the total response size.  SQLI uses big-endian
  // uint32 length headers, so we check that the declared length is plausible.
  const binaryHeuristic =
    !isInformix &&
    data.length >= 8 &&
    (() => {
      try {
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const declaredLen = dv.getUint32(0, false);
        // The declared payload length should be close to (total - 4) and > 0
        return (
          declaredLen > 0 &&
          declaredLen <= data.length &&
          declaredLen < 65536
        );
      } catch {
        return false;
      }
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
 *
 * Reads a single chunk and returns immediately — SQLI servers send their
 * response in one go and then wait for the next client message, so waiting
 * for more data would just stall until the read times out.
 */
async function readAll(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  while (true) {
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('read timeout')), timeoutMs),
      ),
    ]);
    if (result.done || !result.value || result.value.length === 0) break;
    chunks.push(result.value);
    // SQLI servers send a complete message and then block; grab the first
    // chunk and return rather than waiting for a read timeout.
    break;
  }

  if (chunks.length === 0) throw new Error('read timeout');
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
    const { host, port = INFORMIX_DEFAULT_PORT, timeout = 15000 } = body;

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
      success: false, host: '', port: INFORMIX_DEFAULT_PORT,
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
 * Sends an SQLI connection packet, authenticates, then sends a command packet
 * and collects the result.  This is a best-effort implementation — full SQLI
 * query execution requires handling SQ_DESCRIBE, FDOCA row descriptors, and
 * proper cursor management.  For production use, prefer DRDA (drda.ts) or
 * a proper Informix JDBC/ODBC driver.
 *
 * Body: { host, port?, username, password, database?, query?, timeout? }
 */
export async function handleInformixQuery(request: Request): Promise<Response> {
  try {
    const body = await request.json() as InformixRequest & { query?: string };
    const {
      host, port = INFORMIX_DEFAULT_PORT, timeout = 20000,
      username = 'informix', password = '',
      database = 'sysmaster',
    } = body;
    const query = body.query ?? 'SELECT tabname FROM systables WHERE tabid < 10';

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

      // Step 1: Send SQLI connection packet (key-value pairs)
      await writer.write(buildSQLIConnect(username, database));

      // Step 2: Read server banner / challenge
      const reader = socket.readable.getReader();
      let banner: Uint8Array;
      try {
        banner = await Promise.race([readAll(reader, 5000), timeoutPromise]);
      } catch {
        reader.releaseLock();
        writer.releaseLock();
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
        writer.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false, host, port,
          error: 'Server does not appear to be Informix',
          dataLength: banner.length,
        } satisfies InformixResponse), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // Step 3: Send SQLI authentication packet (password in 4-byte-length frame)
      await writer.write(buildSQLIAuthPacket(password));

      // Step 4: Read auth response
      // SQLI sends SQ_EOT (0x00) on success, SQ_ERR with error code on failure.
      // The first byte after the 4-byte length header indicates message type.
      let authResp: Uint8Array | null = null;
      try {
        authResp = await Promise.race([readAll(reader, 5000), timeoutPromise]);
      } catch {
        // Some servers close connection on bad auth; treat as auth failure
      }

      // Check for SQ_ERR message type (0x02) or connection close
      const authFailed =
        !authResp ||
        authResp.length === 0 ||
        (authResp.length >= 5 && authResp[4] === 0x02);

      if (authFailed) {
        reader.releaseLock();
        writer.releaseLock();
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

      // Step 5: Send SQLI command packet (SQ_COMMAND = 0x01)
      await writer.write(buildSQLICommandPacket(query, 0x01));

      // Step 6: Collect result messages
      // SQLI query results are a sequence of messages:
      //   SQ_DESCRIBE (column metadata), SQ_DATA (row data), SQ_EOT (end of transaction)
      // Full parsing requires FDOCA/SQLDA decoding which is complex; we collect
      // raw responses for basic connectivity validation.
      const resultChunks: Uint8Array[] = [];
      const maxChunks = 10;  // Limit to prevent runaway memory usage
      const readDeadline = Date.now() + 8000;

      while (Date.now() < readDeadline && resultChunks.length < maxChunks) {
        try {
          const chunk = await Promise.race([
            readAll(reader, 2000),
            timeoutPromise,
          ]);
          resultChunks.push(chunk);
          // Check for SQ_EOT (0x00) or SQ_ERR (0x02) message type
          if (chunk.length >= 5 && (chunk[4] === 0x00 || chunk[4] === 0x02)) {
            break;
          }
        } catch {
          break;
        }
      }

      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      // Parse results: extract printable ASCII strings from response chunks.
      // NOTE: This is a best-effort heuristic. Proper SQLI result decoding
      // requires FDOCA descriptor parsing (SQ_DESCRIBE message) and typed
      // column extraction. For production use, prefer DRDA (drda.ts) or a
      // real Informix JDBC/ODBC driver.
      const rows: string[][] = [];
      for (const chunk of resultChunks) {
        // Skip 4-byte length header; check message type
        if (chunk.length < 5) continue;
        const msgType = chunk[4];
        // SQ_ERR (0x02) indicates query error
        if (msgType === 0x02) {
          const errText = dec.decode(chunk.subarray(5, Math.min(chunk.length, 256)));
          rows.push([`ERROR: ${errText.replace(/\0/g, ' ').trim()}`]);
          break;
        }
        // Extract printable content from data messages
        const text = dec.decode(chunk.subarray(5));
        const parts = text
          .split('\0')
          .map(s => s.trim())
          .filter(s => s.length > 0 && /^[\x20-\x7E]+$/.test(s)); // printable ASCII
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
      success: false, host: '', port: INFORMIX_DEFAULT_PORT,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies InformixResponse), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
