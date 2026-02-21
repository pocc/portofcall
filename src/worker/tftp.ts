/**
 * TFTP-over-TCP Implementation (NON-STANDARD / EXPERIMENTAL)
 *
 * RFC 1350 TFTP is a UDP-only protocol. This implementation uses TCP because
 * Cloudflare Workers Sockets API does not support UDP connections.
 *
 * IMPORTANT LIMITATIONS:
 * - Will NOT work with standard TFTP servers (tftpd, atftpd, etc.)
 * - NOT RFC 1350 compliant (requires UDP/port 69)
 * - Requires a custom TCP-based TFTP server or UDP-to-TCP proxy
 *
 * Standard TFTP (RFC 1350):
 * - Port: 69/UDP
 * - Used for: Network booting (PXE), firmware updates, config transfers
 *
 * TFTP Packet Formats (RFC 1350):
 *   RRQ/WRQ: opcode(2) + filename + NUL + mode + NUL
 *            mode = "netascii" | "octet" | "mail"
 *   DATA:    opcode(2) + block(uint16 BE) + data(0-512 bytes)
 *   ACK:     opcode(2) + block(uint16 BE)
 *   ERROR:   opcode(2) + error_code(uint16 BE) + errmsg + NUL
 *
 * Error codes:
 *   0=Not defined        1=File not found     2=Access violation
 *   3=Disk full          4=Illegal operation  5=Unknown TID
 *   6=File already exists  7=No such user
 */

import { connect } from 'cloudflare:sockets';

// TFTP Opcodes
const TFTP_OPCODE = {
  RRQ: 1,
  WRQ: 2,
  DATA: 3,
  ACK: 4,
  ERROR: 5,
} as const;

// TFTP Error Code descriptions
const TFTP_ERROR_NAMES: Record<number, string> = {
  0: 'Not defined',
  1: 'File not found',
  2: 'Access violation',
  3: 'Disk full or allocation exceeded',
  4: 'Illegal TFTP operation',
  5: 'Unknown transfer ID',
  6: 'File already exists',
  7: 'No such user',
};

type TFTPMode = 'netascii' | 'octet' | 'mail';

/** Default maximum block size per RFC 1350 */
const TFTP_BLOCK_SIZE = 512;

// =============================================================================
// Packet Builders
// =============================================================================

/**
 * Build an RRQ (opcode=1) or WRQ (opcode=2) packet.
 * Format: opcode(2) + filename + NUL + mode + NUL
 */
function buildRequestPacket(opcode: 1 | 2, filename: string, mode: TFTPMode = 'octet'): Uint8Array {
  const enc = new TextEncoder();
  const fn = enc.encode(filename);
  const mo = enc.encode(mode);
  const pkt = new Uint8Array(2 + fn.length + 1 + mo.length + 1);
  pkt[0] = 0;
  pkt[1] = opcode;
  pkt.set(fn, 2);
  pkt[2 + fn.length] = 0;
  pkt.set(mo, 2 + fn.length + 1);
  pkt[2 + fn.length + 1 + mo.length] = 0;
  return pkt;
}

/** Build ACK packet: opcode(2=0x0004) + block(uint16 BE) */
function buildACKPacket(blockNumber: number): Uint8Array {
  return new Uint8Array([0, TFTP_OPCODE.ACK, (blockNumber >> 8) & 0xff, blockNumber & 0xff]);
}

/** Build DATA packet: opcode(2=0x0003) + block(uint16 BE) + data bytes */
function buildDATAPacket(blockNumber: number, data: Uint8Array): Uint8Array {
  const pkt = new Uint8Array(4 + data.length);
  pkt[0] = 0;
  pkt[1] = TFTP_OPCODE.DATA;
  pkt[2] = (blockNumber >> 8) & 0xff;
  pkt[3] = blockNumber & 0xff;
  pkt.set(data, 4);
  return pkt;
}

// =============================================================================
// Packet Parsers
// =============================================================================

function getOpcode(data: Uint8Array): number {
  return data.length >= 2 ? (data[0] << 8) | data[1] : 0;
}

function parseDataPacket(data: Uint8Array): { blockNumber: number; payload: Uint8Array } | null {
  if (data.length < 4 || getOpcode(data) !== TFTP_OPCODE.DATA) return null;
  return { blockNumber: (data[2] << 8) | data[3], payload: data.slice(4) };
}

function parseACKBlock(data: Uint8Array): number | null {
  if (data.length < 4 || getOpcode(data) !== TFTP_OPCODE.ACK) return null;
  return (data[2] << 8) | data[3];
}

function parseErrorPacket(data: Uint8Array): { code: number; codeName: string; message: string } | null {
  if (data.length < 4 || getOpcode(data) !== TFTP_OPCODE.ERROR) return null;
  const code = (data[2] << 8) | data[3];
  const msgBytes = data.slice(4);
  const nullIdx = msgBytes.indexOf(0);
  const message = new TextDecoder().decode(nullIdx >= 0 ? msgBytes.slice(0, nullIdx) : msgBytes);
  return { code, codeName: TFTP_ERROR_NAMES[code] ?? 'Unknown', message };
}

/** Convert a Uint8Array slice to a space-separated lowercase hex string */
function toHex(data: Uint8Array, maxBytes = data.length): string {
  return Array.from(data.slice(0, maxBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * Handle TFTP Connect -- test TCP connection to the TFTP server port.
 * POST /api/tftp/connect
 * Body: { host, port?, timeout? }
 */
export async function handleTFTPConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { host, port = 69, timeout = 30000 } = await request.json<{
      host: string; port?: number; timeout?: number;
    }>();

    if (!host) {
      return new Response('Missing host parameter', { status: 400 });
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    await Promise.race([socket.opened, timeoutPromise]);
    const latencyMs = Date.now() - startTime;
    await socket.close();

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        protocol: 'TFTP (TCP)',
        latencyMs,
        message: 'TCP connection to TFTP port succeeded',
        note: 'Standard TFTP uses UDP/69. TCP confirms port is open but most TFTP servers require UDP.',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle TFTP Read Request (RRQ).
 *
 * Sends RRQ: opcode(0x0001) + filename + NUL + mode + NUL
 * Reads DATA blocks in sequence, ACKs each, assembles the file.
 * Parses ERROR responses from server.
 *
 * POST /api/tftp/read
 * Body: { host, port?, filename?, mode?, timeout? }
 *
 * Returns: {
 *   success,
 *   opcode,         -- 1 (RRQ)
 *   filename,
 *   mode,
 *   response?,      -- decoded text content (if representable as UTF-8)
 *   blocks?,        -- number of DATA blocks received
 *   dataSize?,      -- total bytes received
 *   errorCode?,     -- TFTP error code (0-7) if server sent ERROR
 *   errorMessage?,  -- human-readable error description
 *   packet,         -- hex encoding of the RRQ packet sent
 *   latencyMs
 * }
 */
export async function handleTFTPRead(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const {
      host,
      port = 69,
      filename,
      mode = 'octet' as TFTPMode,
      timeout = 30000,
    } = await request.json<{
      host: string; port?: number; filename?: string;
      mode?: TFTPMode; timeout?: number;
    }>();

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing host parameter' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!filename) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing filename parameter' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const rrqPacket = buildRequestPacket(TFTP_OPCODE.RRQ, filename, mode);
    const packetHex = toHex(rrqPacket);

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Operation timeout')), timeout)
    );

    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    await writer.write(rrqPacket);

    const dataBlocks: Uint8Array[] = [];
    let blocks = 0;
    let dataSize = 0;
    let errorCode: number | undefined;
    let errorMessage: string | undefined;
    let expectedBlock = 1;
    let transferDone = false;

    while (!transferDone) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([reader.read(), timeoutPromise]);
      } catch {
        break;
      }

      if (result.done || !result.value) break;

      const opcode = getOpcode(result.value);

      if (opcode === TFTP_OPCODE.DATA) {
        const parsed = parseDataPacket(result.value);
        if (parsed && parsed.blockNumber === expectedBlock) {
          dataBlocks.push(parsed.payload);
          dataSize += parsed.payload.length;
          blocks++;
          await writer.write(buildACKPacket(parsed.blockNumber));
          expectedBlock++;
          if (parsed.payload.length < TFTP_BLOCK_SIZE) transferDone = true;
        }
      } else if (opcode === TFTP_OPCODE.ERROR) {
        const err = parseErrorPacket(result.value);
        if (err) {
          errorCode = err.code;
          errorMessage = `${err.codeName}: ${err.message}`;
        }
        transferDone = true;
      } else {
        break;
      }
    }

    const latencyMs = Date.now() - startTime;

    try { reader.releaseLock(); } catch { /* ignore */ }
    try { writer.releaseLock(); } catch { /* ignore */ }
    await socket.close();

    let responseText: string | undefined;
    if (dataSize > 0) {
      const combined = new Uint8Array(dataSize);
      let offset = 0;
      for (const block of dataBlocks) { combined.set(block, offset); offset += block.length; }
      try {
        responseText = new TextDecoder('utf-8', { fatal: true }).decode(combined);
      } catch {
        responseText = `<binary data: ${dataSize} bytes>`;
      }
    }

    return new Response(
      JSON.stringify({
        success: errorCode === undefined,
        opcode: TFTP_OPCODE.RRQ,
        filename,
        mode,
        ...(responseText !== undefined && { response: responseText }),
        ...(blocks > 0 && { blocks }),
        ...(dataSize > 0 && { dataSize }),
        ...(errorCode !== undefined && { errorCode }),
        ...(errorMessage !== undefined && { errorMessage }),
        packet: packetHex,
        latencyMs,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Read operation failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle TFTP Write Request (WRQ) with small file content.
 *
 * Protocol flow:
 *   1. Send WRQ: opcode(0x0002) + filename + NUL + mode + NUL
 *   2. Wait for ACK(0) -- server grants write permission
 *   3. Send DATA(1, content[0:512])
 *   4. Wait for ACK(1)
 *   5. Repeat DATA/ACK for each 512-byte block until content exhausted
 *   6. Transfer ends when a DATA block < 512 bytes is ACKed
 *
 * POST /api/tftp/write
 * Body: { host, port?, filename?, content?, mode?, timeout? }
 *
 * Returns: { success, blocksAcked, latencyMs, errorCode?, errorMessage? }
 */
export async function handleTFTPWrite(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const {
      host,
      port = 69,
      filename = 'test.txt',
      content = 'Hello TFTP',
      mode = 'octet' as TFTPMode,
      timeout = 5000,
    } = await request.json<{
      host: string; port?: number; filename?: string;
      content?: string; mode?: TFTPMode; timeout?: number;
    }>();

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing host parameter' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const fileData = new TextEncoder().encode(content);
    const wrqPacket = buildRequestPacket(TFTP_OPCODE.WRQ, filename, mode);

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Operation timeout')), timeout)
    );

    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    await writer.write(wrqPacket);

    let blocksAcked = 0;
    let errorCode: number | undefined;
    let errorMessage: string | undefined;

    // Step 1: Wait for ACK(0) -- server grants write permission
    const ack0Result = await Promise.race([reader.read(), timeoutPromise]);
    if (ack0Result.done || !ack0Result.value) {
      errorMessage = 'No response to WRQ';
    } else {
      const opcode0 = getOpcode(ack0Result.value);
      if (opcode0 === TFTP_OPCODE.ERROR) {
        const err = parseErrorPacket(ack0Result.value);
        errorCode = err?.code;
        errorMessage = err ? `${err.codeName}: ${err.message}` : 'TFTP error';
      } else if (opcode0 !== TFTP_OPCODE.ACK) {
        errorMessage = `Expected ACK(0), got opcode=0x${opcode0.toString(16).padStart(4, '0')}`;
      } else if (parseACKBlock(ack0Result.value) !== 0) {
        errorMessage = `Expected ACK(0), got ACK(${parseACKBlock(ack0Result.value)})`;
      } else {
        // ACK(0) received -- send data blocks
        let blockNum = 1;
        let offset = 0;

        while (offset < fileData.length) {
          const end = Math.min(offset + TFTP_BLOCK_SIZE, fileData.length);
          const chunk = fileData.slice(offset, end);
          await writer.write(buildDATAPacket(blockNum, chunk));

          let ackResult: ReadableStreamReadResult<Uint8Array>;
          try {
            ackResult = await Promise.race([reader.read(), timeoutPromise]);
          } catch {
            errorMessage = 'Timeout waiting for ACK';
            break;
          }

          if (ackResult.done || !ackResult.value) {
            errorMessage = 'Connection closed before ACK received';
            break;
          }

          const ackOpcode = getOpcode(ackResult.value);
          if (ackOpcode === TFTP_OPCODE.ERROR) {
            const err = parseErrorPacket(ackResult.value);
            errorCode = err?.code;
            errorMessage = err ? `${err.codeName}: ${err.message}` : 'TFTP error';
            break;
          }

          const receivedAck = parseACKBlock(ackResult.value);
          if (receivedAck !== blockNum) {
            errorMessage = `Expected ACK(${blockNum}), got ACK(${receivedAck})`;
            break;
          }

          blocksAcked++;

          // A block smaller than 512 bytes marks end of transfer
          if (chunk.length < TFTP_BLOCK_SIZE) break;

          offset += TFTP_BLOCK_SIZE;
          blockNum = (blockNum + 1) & 0xFFFF;
          if (blockNum === 0) {
            errorMessage = 'File too large for TFTP (block number overflow)';
            break;
          }
        }
      }
    }

    const latencyMs = Date.now() - startTime;

    try { reader.releaseLock(); } catch { /* ignore */ }
    try { writer.releaseLock(); } catch { /* ignore */ }
    await socket.close();

    return new Response(
      JSON.stringify({
        success: errorCode === undefined && errorMessage === undefined,
        blocksAcked,
        ...(errorCode !== undefined && { errorCode }),
        ...(errorMessage !== undefined && { errorMessage }),
        latencyMs,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Write operation failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle TFTP Options Negotiation (RFC 2347/2348/2349).
 *
 * Sends an RRQ or WRQ with optional fields appended (tsize, blksize, timeout)
 * and parses the server's OACK (opcode=6) response. If the server supports
 * RFC 2347 options, it replies with an OACK containing the negotiated values.
 *
 * Options:
 *   tsize   — file size in bytes (RFC 2349; WRQ: file size, RRQ: 0 = ask server)
 *   blksize — block size in bytes 8..65464 (RFC 2348; default 512)
 *   timeout — retransmission timeout in seconds 1..255 (RFC 2349)
 *
 * POST /api/tftp/options
 * Body: { host, port?, filename?, mode?, opcode?, blksize?, timeout?, tsize?, connectionTimeout? }
 */
export async function handleTFTPOptions(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const {
      host,
      port = 69,
      filename = 'test.txt',
      mode = 'octet' as TFTPMode,
      opcode: reqOpcode = TFTP_OPCODE.RRQ as 1 | 2,
      blksize = 1468,
      timeout: tftpTimeout = 5,
      tsize,
      connectionTimeout = 8000,
    } = await request.json<{
      host: string;
      port?: number;
      filename?: string;
      mode?: TFTPMode;
      opcode?: 1 | 2;
      blksize?: number;
      timeout?: number;
      tsize?: number;
      connectionTimeout?: number;
    }>();

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing host parameter' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Clamp option values to RFC-specified ranges
    const blksizeClamped   = Math.max(8, Math.min(65464, blksize));
    const timeoutClamped   = Math.max(1, Math.min(255, tftpTimeout));

    // Build RRQ/WRQ with options:
    // opcode(2) + filename\0 + mode\0 + optname\0 + optval\0 + ...
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];

    // opcode
    parts.push(new Uint8Array([0, reqOpcode]));

    // filename + NUL
    const fn = enc.encode(filename);
    const fnNul = new Uint8Array(fn.length + 1);
    fnNul.set(fn, 0);
    parts.push(fnNul);

    // mode + NUL
    const mo = enc.encode(mode);
    const moNul = new Uint8Array(mo.length + 1);
    moNul.set(mo, 0);
    parts.push(moNul);

    // blksize option
    const blksizeOpt = enc.encode('blksize');
    const blksizeVal = enc.encode(String(blksizeClamped));
    const blksizeBuf = new Uint8Array(blksizeOpt.length + 1 + blksizeVal.length + 1);
    blksizeBuf.set(blksizeOpt, 0);
    blksizeBuf.set(blksizeVal, blksizeOpt.length + 1);
    parts.push(blksizeBuf);

    // timeout option
    const toOpt = enc.encode('timeout');
    const toVal = enc.encode(String(timeoutClamped));
    const toBuf = new Uint8Array(toOpt.length + 1 + toVal.length + 1);
    toBuf.set(toOpt, 0);
    toBuf.set(toVal, toOpt.length + 1);
    parts.push(toBuf);

    // tsize option (0 for RRQ = ask server for file size; actual value for WRQ)
    const tsizeOpt = enc.encode('tsize');
    const tsizeStr = String(tsize !== undefined ? tsize : 0);
    const tsizeVal = enc.encode(tsizeStr);
    const tsizeBuf = new Uint8Array(tsizeOpt.length + 1 + tsizeVal.length + 1);
    tsizeBuf.set(tsizeOpt, 0);
    tsizeBuf.set(tsizeVal, tsizeOpt.length + 1);
    parts.push(tsizeBuf);

    // Concatenate all parts
    let totalLen = 0;
    for (const p of parts) totalLen += p.length;
    const pkt = new Uint8Array(totalLen);
    let pos = 0;
    for (const p of parts) { pkt.set(p, pos); pos += p.length; }

    const packetHex = toHex(pkt);

    // --- Parse OACK response (opcode=6) ---
    function parseOACK(data: Uint8Array): Record<string, string> {
      if (data.length < 2 || getOpcode(data) !== 6) return {};
      const dec = new TextDecoder();
      const opts: Record<string, string> = {};
      let i = 2;
      while (i < data.length) {
        // Read null-terminated option name
        const nameStart = i;
        while (i < data.length && data[i] !== 0) i++;
        const name = dec.decode(data.slice(nameStart, i));
        if (i < data.length) i++; // skip NUL
        // Read null-terminated option value
        const valStart = i;
        while (i < data.length && data[i] !== 0) i++;
        const val = dec.decode(data.slice(valStart, i));
        if (i < data.length) i++; // skip NUL
        if (name) opts[name] = val;
      }
      return opts;
    }

    const startTime = Date.now();
    let connectionAccepted = false;
    let latencyMs = 0;
    let oackOptions: Record<string, string> | undefined;
    let serverResponse: string | undefined;
    let connError: string | undefined;
    let supportsOptions = false;

    try {
      const socket = connect(`${host}:${port}`);
      const connTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), connectionTimeout)
      );
      await Promise.race([socket.opened, connTimeout]);
      connectionAccepted = true;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(pkt);
      latencyMs = Date.now() - startTime;

      try {
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read_timeout')), 3000)
        );
        const result = await Promise.race([reader.read(), readTimeout]);
        if (!result.done && result.value && result.value.length >= 2) {
          const respOpcode = getOpcode(result.value);
          if (respOpcode === 6) {
            // OACK — server supports options negotiation
            supportsOptions = true;
            oackOptions = parseOACK(result.value);
            serverResponse = `OACK: options negotiated — ${JSON.stringify(oackOptions)}`;
          } else if (respOpcode === TFTP_OPCODE.DATA) {
            const parsed = parseDataPacket(result.value);
            serverResponse = parsed
              ? `DATA block=${parsed.blockNumber} (${parsed.payload.length} bytes) — server ignored options`
              : 'DATA packet (malformed)';
          } else if (respOpcode === TFTP_OPCODE.ERROR) {
            const err = parseErrorPacket(result.value);
            serverResponse = err
              ? `ERROR ${err.code} (${err.codeName}): "${err.message}"`
              : 'ERROR packet (malformed)';
          } else if (respOpcode === TFTP_OPCODE.ACK) {
            serverResponse = `ACK block=${parseACKBlock(result.value) ?? '?'} — unexpected during options negotiation`;
          } else {
            serverResponse = `Unknown opcode=0x${respOpcode.toString(16).padStart(4, '0')}`;
          }
        }
      } catch {
        // No response within 3s
      }

      try { reader.releaseLock(); } catch { /* ok */ }
      try { writer.releaseLock(); } catch { /* ok */ }
      socket.close();
    } catch (e) {
      latencyMs = Date.now() - startTime;
      connError = e instanceof Error ? e.message : 'Connection failed';
    }

    return new Response(
      JSON.stringify({
        success: connectionAccepted,
        connectionAccepted,
        supportsOptions,
        host, port, filename, mode,
        requestedOptions: {
          blksize: blksizeClamped,
          timeout: timeoutClamped,
          tsize: tsize !== undefined ? tsize : 0,
        },
        negotiatedOptions: oackOptions,
        packet: packetHex,
        packetBytes: pkt.length,
        ...(serverResponse !== undefined && { serverResponse }),
        ...(connError !== undefined && { error: connError }),
        latencyMs,
        note: 'RFC 2347 TFTP options negotiation. The client appends blksize/timeout/tsize to the ' +
              'RRQ/WRQ. An RFC-2347-compliant server replies with an OACK (opcode=6) confirming ' +
              'the negotiated values. Standard TFTP uses UDP/69; TCP port only confirms reachability.',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'TFTP options negotiation failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle TFTP Get -- probe TCP connectivity to the TFTP port and return
 * the packet structure that would be sent, plus any immediate server response.
 *
 * Demonstrates RFC 1350 RRQ packet encoding without a full file transfer.
 * Useful for port availability checks and protocol documentation.
 *
 * POST /api/tftp/get
 * Body: { host, port?, filename?, mode?, timeout? }
 *
 * Returns: {
 *   success,
 *   connectionAccepted,
 *   host, port, filename, mode,
 *   packet,           -- hex encoding of the RRQ packet
 *   packetBreakdown,  -- labeled field breakdown
 *   serverResponse?,  -- parsed description of any immediate server reply
 *   error?,           -- connection error if TCP failed
 *   latencyMs,
 *   note
 * }
 */
export async function handleTFTPGet(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const {
      host,
      port = 69,
      filename = 'test.txt',
      mode = 'octet' as TFTPMode,
      timeout = 5000,
    } = await request.json<{
      host: string; port?: number; filename?: string;
      mode?: TFTPMode; timeout?: number;
    }>();

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing host parameter' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const enc = new TextEncoder();
    const rrqPacket = buildRequestPacket(TFTP_OPCODE.RRQ, filename, mode);
    const fnBytes = enc.encode(filename);
    const moBytes = enc.encode(mode);

    const packetBreakdown = {
      opcode: '00 01  (0x0001 = RRQ, Read Request)',
      filename: toHex(fnBytes) + ' 00  (filename="' + filename + '" + NUL terminator)',
      mode: toHex(moBytes) + ' 00  (mode="' + mode + '" + NUL terminator)',
      totalBytes: rrqPacket.length,
    };

    const startTime = Date.now();
    let connectionAccepted = false;
    let latencyMs = 0;
    let serverResponse: string | undefined;
    let connError: string | undefined;

    try {
      const socket = connect(`${host}:${port}`);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      );

      await Promise.race([socket.opened, timeoutPromise]);
      connectionAccepted = true;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await writer.write(rrqPacket);
      latencyMs = Date.now() - startTime;

      // Attempt a 2-second read to capture any immediate server reply
      try {
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read_timeout')), 2000)
        );
        const result = await Promise.race([reader.read(), readTimeout]);
        if (!result.done && result.value && result.value.length >= 2) {
          const respOpcode = getOpcode(result.value);
          if (respOpcode === TFTP_OPCODE.DATA) {
            const parsed = parseDataPacket(result.value);
            serverResponse = parsed
              ? `DATA block=${parsed.blockNumber} dataBytes=${parsed.payload.length}`
              : 'DATA packet (malformed)';
          } else if (respOpcode === TFTP_OPCODE.ERROR) {
            const err = parseErrorPacket(result.value);
            serverResponse = err
              ? `ERROR code=${err.code} (${err.codeName}): "${err.message}"`
              : 'ERROR packet (malformed)';
          } else if (respOpcode === TFTP_OPCODE.ACK) {
            serverResponse = `ACK block=${parseACKBlock(result.value) ?? '?'}`;
          } else {
            serverResponse = `Unknown opcode=0x${respOpcode.toString(16).padStart(4, '0')} hex=${toHex(result.value, 4)}`;
          }
        }
      } catch {
        // No response within 2s -- normal for standard UDP TFTP servers on TCP
      }

      try { reader.releaseLock(); } catch { /* ignore */ }
      try { writer.releaseLock(); } catch { /* ignore */ }
      await socket.close();
    } catch (e) {
      latencyMs = Date.now() - startTime;
      connError = e instanceof Error ? e.message : 'Connection failed';
    }

    return new Response(
      JSON.stringify({
        success: connectionAccepted,
        connectionAccepted,
        host,
        port,
        filename,
        mode,
        packet: toHex(rrqPacket),
        packetBreakdown,
        ...(serverResponse !== undefined && { serverResponse }),
        ...(connError !== undefined && { error: connError }),
        latencyMs,
        note: 'RFC 1350 TFTP uses UDP/69. TCP port connectivity only confirms reachability. ' +
              'Standard TFTP servers do not respond to TCP connections.',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'TFTP get failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
