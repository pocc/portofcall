/**
 * MySQL Protocol Support for Cloudflare Workers
 * Full mysql_native_password auth + query execution via Web Crypto API
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ---------------------------------------------------------------------------
// Capability flags
// ---------------------------------------------------------------------------
const CLIENT_LONG_PASSWORD    = 0x00000001;
const CLIENT_LONG_FLAG        = 0x00000004;
const CLIENT_CONNECT_WITH_DB  = 0x00000008;
const CLIENT_PROTOCOL_41      = 0x00000200;
const CLIENT_SECURE_CONNECTION = 0x00008000;
const CLIENT_PLUGIN_AUTH      = 0x00080000;

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------
export interface MySQLConnectionOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  timeout?: number;
}

export interface MySQLQueryOptions extends MySQLConnectionOptions {
  query: string;
}

export interface MySQLHandshake {
  protocolVersion: number;
  serverVersion: string;
  connectionId: number;
  scramble: Uint8Array;
  capabilities: number;
  charset: number;
  statusFlags: number;
  authPluginName: string;
}

export interface MySQLColumn {
  name: string;
  type: number;
}

export interface MySQLResultSet {
  columns: MySQLColumn[];
  rows: (string | null)[][];
  rowCount: number;
}

// ---------------------------------------------------------------------------
// Packet framing helpers
// ---------------------------------------------------------------------------

/**
 * Read a complete MySQL packet from a stream reader.
 * MySQL packet format: [length 3B LE][sequence 1B][payload...]
 * This accumulates chunks until a full packet payload is available.
 */
async function readPacket(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buffer: { data: Uint8Array }
): Promise<{ payload: Uint8Array; sequence: number }> {
  // Ensure we have at least 4 bytes for the header
  while (buffer.data.length < 4) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed while reading packet header');
    const merged = new Uint8Array(buffer.data.length + value.length);
    merged.set(buffer.data);
    merged.set(value, buffer.data.length);
    buffer.data = merged;
  }

  // Decode header
  const length = buffer.data[0] | (buffer.data[1] << 8) | (buffer.data[2] << 16);
  const sequence = buffer.data[3];
  const needed = 4 + length;

  // Accumulate until we have the full packet
  while (buffer.data.length < needed) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed while reading packet body');
    const merged = new Uint8Array(buffer.data.length + value.length);
    merged.set(buffer.data);
    merged.set(value, buffer.data.length);
    buffer.data = merged;
  }

  const payload = buffer.data.slice(4, needed);
  buffer.data = buffer.data.slice(needed);

  return { payload, sequence };
}

/**
 * Build a MySQL packet: [length 3B LE][sequence 1B][payload]
 */
function buildPacket(payload: Uint8Array, sequence: number): Uint8Array {
  const length = payload.length;
  const packet = new Uint8Array(4 + length);
  packet[0] = length & 0xff;
  packet[1] = (length >> 8) & 0xff;
  packet[2] = (length >> 16) & 0xff;
  packet[3] = sequence;
  packet.set(payload, 4);
  return packet;
}

// ---------------------------------------------------------------------------
// Length-encoded integer / string helpers
// ---------------------------------------------------------------------------

interface LenEncResult {
  value: number;
  bytesRead: number;
}

function readLengthEncodedInt(data: Uint8Array, offset: number): LenEncResult {
  const first = data[offset];
  if (first < 0xfb) {
    return { value: first, bytesRead: 1 };
  } else if (first === 0xfc) {
    return { value: data[offset + 1] | (data[offset + 2] << 8), bytesRead: 3 };
  } else if (first === 0xfd) {
    return {
      value: data[offset + 1] | (data[offset + 2] << 8) | (data[offset + 3] << 16),
      bytesRead: 4,
    };
  } else if (first === 0xfe) {
    // 8-byte integer — truncate to 32 bits for JS safety
    const lo = data[offset + 1] | (data[offset + 2] << 8) | (data[offset + 3] << 16) | (data[offset + 4] << 24);
    return { value: lo >>> 0, bytesRead: 9 };
  }
  // 0xfb = NULL (not valid here as an integer)
  return { value: 0, bytesRead: 1 };
}

// ---------------------------------------------------------------------------
// mysql_native_password auth token
// token = SHA1(password) XOR SHA1(scramble || SHA1(SHA1(password)))
// ---------------------------------------------------------------------------
async function computeAuthToken(password: string, scramble: Uint8Array): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const passwordBytes = enc.encode(password);

  // SHA1(password)
  const sha1Pass = new Uint8Array(await crypto.subtle.digest('SHA-1', passwordBytes));

  // SHA1(SHA1(password))
  const sha1sha1Pass = new Uint8Array(await crypto.subtle.digest('SHA-1', sha1Pass));

  // SHA1(scramble || SHA1(SHA1(password)))
  const combined = new Uint8Array(scramble.length + sha1sha1Pass.length);
  combined.set(scramble);
  combined.set(sha1sha1Pass, scramble.length);
  const sha1Combined = new Uint8Array(await crypto.subtle.digest('SHA-1', combined));

  // XOR
  const token = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    token[i] = sha1Pass[i] ^ sha1Combined[i];
  }
  return token;
}


// ---------------------------------------------------------------------------
// caching_sha2_password auth token
// scramble = XOR(SHA256(password), SHA256(SHA256(SHA256(password)), nonce))
// ---------------------------------------------------------------------------
async function computeSHA2AuthToken(password: string, nonce: Uint8Array): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const passwordBytes = enc.encode(password);

  // SHA256(password)
  const sha256Pass = new Uint8Array(await crypto.subtle.digest('SHA-256', passwordBytes));

  // SHA256(SHA256(password))
  const sha256sha256Pass = new Uint8Array(await crypto.subtle.digest('SHA-256', sha256Pass));

  // SHA256(SHA256(SHA256(password)) || nonce)
  const combined = new Uint8Array(sha256sha256Pass.length + nonce.length);
  combined.set(sha256sha256Pass);
  combined.set(nonce, sha256sha256Pass.length);
  const sha256Combined = new Uint8Array(await crypto.subtle.digest('SHA-256', combined));

  // XOR(SHA256(password), SHA256(SHA256(SHA256(password)) || nonce))
  const token = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    token[i] = sha256Pass[i] ^ sha256Combined[i];
  }
  return token;
}

// ---------------------------------------------------------------------------
// Handshake parsing (Protocol v10)
// ---------------------------------------------------------------------------

/**
 * Parse a MySQL Protocol v10 Initial Handshake Packet.
 * Layout:
 *   1B  protocol version (must be 10)
 *   NB  server version (null-terminated)
 *   4B  connection id
 *   8B  auth-plugin-data part 1
 *   1B  filler (0x00)
 *   2B  capability flags (lower 2 bytes)
 *   1B  character set
 *   2B  status flags
 *   2B  capability flags (upper 2 bytes)
 *   1B  auth-plugin-data length (or 0)
 *   10B reserved
 *   NB  auth-plugin-data part 2 (max(13, auth_plugin_data_len - 8))
 *   NB  auth-plugin-name (null-terminated, if CLIENT_PLUGIN_AUTH)
 */
function parseHandshake(payload: Uint8Array): MySQLHandshake {
  let pos = 0;

  const protocolVersion = payload[pos++];
  if (protocolVersion !== 10) {
    throw new Error(`Unsupported MySQL protocol version: ${protocolVersion}`);
  }

  // Server version (null-terminated)
  let serverVersion = '';
  while (pos < payload.length && payload[pos] !== 0) {
    serverVersion += String.fromCharCode(payload[pos++]);
  }
  pos++; // skip null terminator

  // Connection ID (4 bytes LE)
  const connectionId =
    payload[pos] |
    (payload[pos + 1] << 8) |
    (payload[pos + 2] << 16) |
    (payload[pos + 3] << 24);
  pos += 4;

  // Auth-plugin-data part 1 (8 bytes)
  const scramblePart1 = payload.slice(pos, pos + 8);
  pos += 8;

  pos++; // filler

  // Capability flags lower 2 bytes
  const capLow = payload[pos] | (payload[pos + 1] << 8);
  pos += 2;

  // Character set
  const charset = payload[pos++];

  // Status flags
  const statusFlags = payload[pos] | (payload[pos + 1] << 8);
  pos += 2;

  // Capability flags upper 2 bytes
  const capHigh = payload[pos] | (payload[pos + 1] << 8);
  pos += 2;

  const capabilities = capLow | (capHigh << 16);

  // Auth-plugin-data length
  const authPluginDataLen = payload[pos++];

  // Reserved (10 bytes)
  pos += 10;

  // Auth-plugin-data part 2: max(13, authPluginDataLen - 8)
  const part2Len = Math.max(13, authPluginDataLen - 8);
  const scramblePart2 = payload.slice(pos, pos + part2Len - 1); // -1 to strip null terminator
  pos += part2Len;

  // Auth-plugin-name (null-terminated)
  let authPluginName = '';
  while (pos < payload.length && payload[pos] !== 0) {
    authPluginName += String.fromCharCode(payload[pos++]);
  }

  // Full scramble = part1 (8B) || part2 (12B) = 20 bytes
  const scramble = new Uint8Array(scramblePart1.length + scramblePart2.length);
  scramble.set(scramblePart1);
  scramble.set(scramblePart2, scramblePart1.length);

  return {
    protocolVersion,
    serverVersion,
    connectionId,
    scramble,
    capabilities,
    charset,
    statusFlags,
    authPluginName: authPluginName || 'mysql_native_password',
  };
}

// ---------------------------------------------------------------------------
// Build Handshake Response (CLIENT_PROTOCOL_41)
// ---------------------------------------------------------------------------

async function buildHandshakeResponse(
  username: string,
  password: string,
  database: string | undefined,
  scramble: Uint8Array,
  charset: number,
  authPluginName = 'mysql_native_password',
): Promise<Uint8Array> {
  // Capability flags
  let capabilities =
    CLIENT_LONG_PASSWORD |
    CLIENT_LONG_FLAG |
    CLIENT_PROTOCOL_41 |
    CLIENT_SECURE_CONNECTION |
    CLIENT_PLUGIN_AUTH;

  if (database) {
    capabilities |= CLIENT_CONNECT_WITH_DB;
  }

  // Auth token
  let authToken: Uint8Array;
  if (password) {
    if (authPluginName === 'caching_sha2_password') {
      authToken = await computeSHA2AuthToken(password, scramble);
    } else {
      authToken = await computeAuthToken(password, scramble);
    }
  } else {
    authToken = new Uint8Array(0);
  }

  const enc = new TextEncoder();
  const usernameBytes = enc.encode(username);
  const pluginName = enc.encode(authPluginName);
  const dbBytes = database ? enc.encode(database) : null;

  // Payload layout (Protocol 4.1):
  //  4B  client capability flags
  //  4B  max packet size
  //  1B  character set
  // 23B  reserved (zeros)
  //  NB  username (null-terminated)
  //  1B  auth response length
  // 20B  auth response
  //  NB  database (null-terminated, if CLIENT_CONNECT_WITH_DB)
  //  NB  auth plugin name (null-terminated, if CLIENT_PLUGIN_AUTH)

  const parts: Uint8Array[] = [];

  // Capabilities (4B LE)
  parts.push(new Uint8Array([
    capabilities & 0xff,
    (capabilities >> 8) & 0xff,
    (capabilities >> 16) & 0xff,
    (capabilities >> 24) & 0xff,
  ]));

  // Max packet size = 16MB (4B LE)
  parts.push(new Uint8Array([0x00, 0x00, 0x00, 0x01]));

  // Character set
  parts.push(new Uint8Array([charset]));

  // Reserved 23 bytes
  parts.push(new Uint8Array(23));

  // Username + null
  parts.push(usernameBytes);
  parts.push(new Uint8Array([0x00]));

  // Auth response: length-prefixed (1 byte)
  parts.push(new Uint8Array([authToken.length]));
  if (authToken.length > 0) {
    parts.push(authToken);
  }

  // Database (if specified)
  if (dbBytes) {
    parts.push(dbBytes);
    parts.push(new Uint8Array([0x00]));
  }

  // Plugin name + null
  parts.push(pluginName);
  parts.push(new Uint8Array([0x00]));

  // Concatenate all parts
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const payload = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    payload.set(part, offset);
    offset += part.length;
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Result set parsing
// ---------------------------------------------------------------------------

/**
 * Parse a length-encoded string from a result set row field.
 * Returns { value: string | null, nextOffset: number }
 */
function parseLenEncString(
  data: Uint8Array,
  offset: number
): { value: string | null; nextOffset: number } {
  if (offset >= data.length) return { value: null, nextOffset: offset };

  const first = data[offset];

  // NULL marker
  if (first === 0xfb) {
    return { value: null, nextOffset: offset + 1 };
  }

  const { value: len, bytesRead } = readLengthEncodedInt(data, offset);
  const start = offset + bytesRead;
  const end = start + len;
  const str = new TextDecoder().decode(data.slice(start, end));
  return { value: str, nextOffset: end };
}

/**
 * Parse column definition packet.
 * The column name (org_name alias: "name") is the 5th length-encoded string:
 *   0: catalog
 *   1: schema (db)
 *   2: table alias
 *   3: org_table
 *   4: name (column alias) ← this is the one we want
 *   5: org_name
 */
function parseColumnDef(payload: Uint8Array): MySQLColumn {
  let pos = 0;

  // Skip first 4 length-encoded strings (catalog, schema, table, org_table)
  for (let i = 0; i < 4; i++) {
    const { value: len, bytesRead } = readLengthEncodedInt(payload, pos);
    pos += bytesRead + len;
  }

  // 5th: column name
  const { value: nameLen, bytesRead: nameLenBytes } = readLengthEncodedInt(payload, pos);
  pos += nameLenBytes;
  const name = new TextDecoder().decode(payload.slice(pos, pos + nameLen));
  pos += nameLen;

  // Skip org_name
  const { value: orgNameLen, bytesRead: orgNameLenBytes } = readLengthEncodedInt(payload, pos);
  pos += orgNameLenBytes + orgNameLen;

  // 1 byte filler
  pos++;

  // 2 bytes charset
  pos += 2;

  // 4 bytes column length
  pos += 4;

  // 1 byte column type
  const type = payload[pos];

  return { name, type };
}

/**
 * Read a full MySQL result set from an authenticated connection.
 * Sequence: columnCount → N colDef packets → EOF → rows... → EOF
 *
 * Returns the parsed MySQLResultSet, or throws on error packet.
 */
async function readResultSet(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buffer: { data: Uint8Array }
): Promise<MySQLResultSet> {
  // First packet: column count (or error / OK)
  const { payload: countPayload } = await readPacket(reader, buffer);

  // Error packet: first byte = 0xff
  if (countPayload[0] === 0xff) {
    const errCode = countPayload[1] | (countPayload[2] << 8);
    const message = new TextDecoder().decode(countPayload.slice(9));
    throw new Error(`MySQL error ${errCode}: ${message}`);
  }

  // OK packet: first byte = 0x00
  if (countPayload[0] === 0x00) {
    return { columns: [], rows: [], rowCount: 0 };
  }

  const { value: columnCount } = readLengthEncodedInt(countPayload, 0);

  // Read N column definition packets
  const columns: MySQLColumn[] = [];
  for (let i = 0; i < columnCount; i++) {
    const { payload } = await readPacket(reader, buffer);
    columns.push(parseColumnDef(payload));
  }

  // Read EOF after column defs (first byte = 0xfe, length < 9)
  {
    const { payload } = await readPacket(reader, buffer);
    if (payload[0] !== 0xfe) {
      throw new Error(`Expected EOF after column definitions, got 0x${payload[0].toString(16)}`);
    }
  }

  // Read row packets until EOF
  const rows: (string | null)[][] = [];
  while (true) {
    const { payload } = await readPacket(reader, buffer);

    // EOF packet
    if (payload[0] === 0xfe && payload.length < 9) {
      break;
    }

    // Error packet
    if (payload[0] === 0xff) {
      const errCode = payload[1] | (payload[2] << 8);
      const message = new TextDecoder().decode(payload.slice(9));
      throw new Error(`MySQL error ${errCode}: ${message}`);
    }

    // Parse row: each field is a length-encoded string
    const row: (string | null)[] = [];
    let pos = 0;
    for (let c = 0; c < columnCount; c++) {
      const { value, nextOffset } = parseLenEncString(payload, pos);
      row.push(value);
      pos = nextOffset;
    }
    rows.push(row);
  }

  return { columns, rows, rowCount: rows.length };
}

// ---------------------------------------------------------------------------
// Core connection helper: authenticate and optionally send a query
// ---------------------------------------------------------------------------

interface ConnectResult {
  handshake: MySQLHandshake;
  resultSet?: MySQLResultSet;
}

async function mysqlConnect(
  host: string,
  port: number,
  username: string,
  password: string,
  database: string | undefined,
  query: string | undefined
): Promise<ConnectResult> {
  const socket = connect(`${host}:${port}`);
  await socket.opened;

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  // Shared buffer for partial reads
  const buffer: { data: Uint8Array } = { data: new Uint8Array(0) };

  try {
    // --- Step 1: Read server Initial Handshake ---
    const { payload: handshakePayload } = await readPacket(reader, buffer);
    const handshake = parseHandshake(handshakePayload);

    // --- Step 2: Send Handshake Response ---
    const responsePayload = await buildHandshakeResponse(
      username,
      password,
      database,
      handshake.scramble,
      handshake.charset,
      handshake.authPluginName,
    );
    await writer.write(buildPacket(responsePayload, 1));

    // --- Step 3: Read auth result ---
    const { payload: authPayload } = await readPacket(reader, buffer);

    if (authPayload[0] === 0xff) {
      // Error
      const errCode = authPayload[1] | (authPayload[2] << 8);
      const message = new TextDecoder().decode(authPayload.slice(9));
      throw new Error(`MySQL auth error ${errCode}: ${message}`);
    }

    // Handle caching_sha2_password auth-more-data (0x01 prefix)
    if (authPayload[0] === 0x01 && handshake.authPluginName === 'caching_sha2_password') {
      const statusByte = authPayload[1];
      if (statusByte === 0x03) {
        // Fast auth succeeded (password was cached) — read the final OK packet
        const { payload: okPayload } = await readPacket(reader, buffer);
        if (okPayload[0] === 0xff) {
          const errCode = okPayload[1] | (okPayload[2] << 8);
          const message = new TextDecoder().decode(okPayload.slice(9));
          throw new Error(`MySQL auth error ${errCode}: ${message}`);
        }
        // 0x00 = OK, proceed
      } else if (statusByte === 0x04) {
        // Full auth required — server wants RSA-encrypted password
        // Request server public key by sending 0x02
        await writer.write(buildPacket(new Uint8Array([0x02]), 3));
        // Read the PEM public key packet (type 0x01 with key data)
        await readPacket(reader, buffer);
        // RSA-OAEP encryption not supported without Node crypto; return error
        throw new Error('caching_sha2_password full RSA auth required — use SSL/TLS connection');
      }
    } else if (authPayload[0] !== 0x00) {
      // Could be auth switch request or other — for probe mode this is fine
      // We don't handle auth plugin switch here; just note success reaching auth step
    }

    // Auth OK (0x00) — proceed
    if (!query) {
      await socket.close();
      return { handshake };
    }

    // --- Step 4: Send COM_QUERY (0x03) ---
    const queryBytes = new TextEncoder().encode(query);
    const comQueryPayload = new Uint8Array(1 + queryBytes.length);
    comQueryPayload[0] = 0x03; // COM_QUERY
    comQueryPayload.set(queryBytes, 1);
    await writer.write(buildPacket(comQueryPayload, 0));

    // --- Step 5: Read result set ---
    const resultSet = await readResultSet(reader, buffer);

    await socket.close();
    return { handshake, resultSet };
  } catch (err) {
    try { await socket.close(); } catch { /* ignore */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// HTTP handler: handleMySQLConnect
// ---------------------------------------------------------------------------

/**
 * Probe OR full auth+connect to a MySQL server.
 * Accepts GET (query params) or POST (JSON body).
 * If credentials are provided, performs full auth. Otherwise does a bare
 * handshake probe to extract server version.
 */
export async function handleMySQLConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<MySQLConnectionOptions>;

    if (request.method === 'POST') {
      options = (await request.json()) as Partial<MySQLConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '3306'),
        username: url.searchParams.get('username') || undefined,
        password: url.searchParams.get('password') || undefined,
        database: url.searchParams.get('database') || undefined,
        timeout: parseInt(url.searchParams.get('timeout') || '30000'),
      };
    }

    if (!options.host) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: host' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = options.host;
    const port = options.port || 3306;
    const timeoutMs = options.timeout || 30000;
    const username = options.username || 'root';
    const password = options.password || '';
    const database = options.database;

    // Cloudflare check
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Determine mode: if no credentials, do bare handshake probe
    const hasCredentials = options.username != null || options.password != null;

    const connectionPromise: Promise<Response> = (async () => {
      if (!hasCredentials) {
        // --- Probe mode: just parse the Initial Handshake ---
        const socket = connect(`${host}:${port}`);
        await socket.opened;
        const reader = socket.readable.getReader();
        const buffer: { data: Uint8Array } = { data: new Uint8Array(0) };
        try {
          const { payload } = await readPacket(reader, buffer);
          const hs = parseHandshake(payload);
          await socket.close();
          return new Response(
            JSON.stringify({
              success: true,
              message: 'MySQL server reachable',
              host,
              port,
              protocolVersion: hs.protocolVersion,
              serverVersion: hs.serverVersion,
              connectionId: hs.connectionId,
              authPlugin: hs.authPluginName,
              note: 'Probe mode (no credentials). Use credentials for full auth.',
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        } catch (err) {
          try { await socket.close(); } catch { /* ignore */ }
          throw err;
        }
      } else {
        // --- Full auth mode ---
        const { handshake } = await mysqlConnect(
          host, port, username, password, database, undefined
        );
        return new Response(
          JSON.stringify({
            success: true,
            message: 'MySQL authentication successful',
            host,
            port,
            protocolVersion: handshake.protocolVersion,
            serverVersion: handshake.serverVersion,
            connectionId: handshake.connectionId,
            authPlugin: handshake.authPluginName,
            database: database || null,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      return await Promise.race([connectionPromise, timeoutPromise]);
    } catch (err) {
      return new Response(
        JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : 'Connection failed',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ---------------------------------------------------------------------------
// HTTP handler: handleMySQLQuery
// ---------------------------------------------------------------------------

/**
 * Full auth + COM_QUERY + result set parsing.
 * Accepts POST only. Requires host and query fields.
 */
export async function handleMySQLQuery(request: Request): Promise<Response> {
  // Check method
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'Method not allowed'
    }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const options = (await request.json()) as Partial<MySQLQueryOptions>;

    // Validate required parameters
    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host'
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (!options.query) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: query'
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Cloudflare check
    const cfCheck = await checkIfCloudflare(options.host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(options.host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const host = options.host;
    const port = options.port || 3306;
    const username = options.username || 'root';
    const password = options.password || '';
    const database = options.database;
    const query = options.query;
    const timeoutMs = options.timeout || 30000;

    const queryPromise: Promise<Response> = (async () => {
      const { handshake, resultSet } = await mysqlConnect(
        host, port, username, password, database, query
      );

      if (!resultSet) {
        return new Response(
          JSON.stringify({ success: false, error: 'No result set returned' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          database: database || null,
          serverVersion: handshake.serverVersion,
          query,
          fields: resultSet.columns,
          rows: resultSet.rows,
          rowCount: resultSet.rowCount,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
    );

    try {
      return await Promise.race([queryPromise, timeoutPromise]);
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Query failed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Request failed',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// ---------------------------------------------------------------------------
// HTTP handler: handleMySQLShowDatabases
// ---------------------------------------------------------------------------

/**
 * Connect to MySQL and run SHOW DATABASES.
 * POST /api/mysql/databases
 * Body: { host, port?, username?, password?, timeout? }
 */
export async function handleMySQLShowDatabases(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const options = (await request.json()) as Partial<MySQLConnectionOptions>;

    if (!options.host) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: host' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = options.host;
    const port = options.port || 3306;
    const username = options.username || 'root';
    const password = options.password || '';
    const timeoutMs = options.timeout || 30000;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const queryPromise: Promise<Response> = (async () => {
      const { handshake, resultSet } = await mysqlConnect(
        host, port, username, password, undefined, 'SHOW DATABASES'
      );

      if (!resultSet) {
        return new Response(
          JSON.stringify({ success: false, error: 'No result set returned' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const databases = resultSet.rows.map((row) => row[0] ?? '').filter(Boolean);

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          serverVersion: handshake.serverVersion,
          databases,
          count: databases.length,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
    );

    try {
      return await Promise.race([queryPromise, timeoutPromise]);
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Query failed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Query failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ---------------------------------------------------------------------------
// HTTP handler: handleMySQLShowTables
// ---------------------------------------------------------------------------

/**
 * Connect to MySQL, select a database, and run SHOW TABLES.
 * POST /api/mysql/tables
 * Body: { host, port?, username?, password?, database, timeout? }
 */
export async function handleMySQLShowTables(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const options = (await request.json()) as Partial<MySQLConnectionOptions>;

    if (!options.host) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: host' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!options.database) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: database' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = options.host;
    const port = options.port || 3306;
    const username = options.username || 'root';
    const password = options.password || '';
    const database = options.database;
    const timeoutMs = options.timeout || 30000;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const queryPromise: Promise<Response> = (async () => {
      // Connect with the database selected, then SHOW TABLES
      const { handshake, resultSet } = await mysqlConnect(
        host, port, username, password, database, 'SHOW TABLES'
      );

      if (!resultSet) {
        return new Response(
          JSON.stringify({ success: false, error: 'No result set returned' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const tables = resultSet.rows.map((row) => row[0] ?? '').filter(Boolean);

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          database,
          serverVersion: handshake.serverVersion,
          tables,
          count: tables.length,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
    );

    try {
      return await Promise.race([queryPromise, timeoutPromise]);
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Query failed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Query failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
