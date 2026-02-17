/**
 * MMS (Microsoft Media Server) Protocol Implementation — MMST over TCP
 *
 * MMST (MMS over TCP) is the streaming variant of Microsoft's Network
 * Streaming Protocol (NSP) used by Windows Media Services and legacy players.
 *
 * Port: 1755 (TCP) — MMST
 *
 * MMST packet format:
 *   Preheader (8 bytes):
 *     [0-3]  B: bandwidth/session ID (uint32 LE, usually 0)
 *     [4-5]  chunk_count (uint16 LE, usually 0)
 *     [6-7]  flags (uint16 LE, 0x0003)
 *   Header (12 bytes):
 *     [8-11] timestamp_low (uint32 LE)
 *     [12-15] timestamp_high (uint32 LE)
 *     [16-19] packet_id_type (uint32 LE)
 *     [20-21] command (uint16 LE)
 *     [22-23] direction/reserved (uint16 LE)
 *   Body: command-specific payload
 *
 * Commands (client→server):
 *   0x0001: CONNECT — initial link request with client GUID and player info
 *   0x0005: MEDIA_HEADER — request media stream header
 *   0x0007: STOP — stop streaming
 *   0x001E: DESCRIBE — request stream description / metadata
 *
 * Commands (server→client):
 *   0x0001: CONNECT_RESPONSE — server version + capabilities
 *   0x0004: CONNECTED       — transport notification
 *   0x0005: MEDIA_HEADER    — media header data
 *   0x001E: DESCRIBE_RESPONSE — stream metadata
 *
 * References:
 *   https://wiki.multimedia.cx/index.php/MMS_Protocol
 *   VLC/FFmpeg mmst.c implementations
 *
 * Endpoints:
 *   POST /api/mms/probe     — connect + get server version info
 *   POST /api/mms/describe  — connect + get stream metadata
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

interface MMSRequest {
  host: string;
  port?: number;
  timeout?: number;
  url?: string;
}

interface MMSResponse {
  success: boolean;
  host: string;
  port: number;
  serverVersion?: string;
  serverInfo?: string;
  commandCode?: number;
  commandName?: string;
  dataLength?: number;
  rtt?: number;
  error?: string;
}

// MMST Command codes
const MMS_CMD_CONNECT          = 0x0001;
const MMS_CMD_CONNECTED        = 0x0004;
const MMS_CMD_MEDIA_HEADER     = 0x0005;
const MMS_CMD_DESCRIBE         = 0x001E;

function cmdName(cmd: number): string {
  switch (cmd) {
    case MMS_CMD_CONNECT:      return 'Connect';
    case MMS_CMD_CONNECTED:    return 'Connected';
    case MMS_CMD_MEDIA_HEADER: return 'MediaHeader';
    case MMS_CMD_DESCRIBE:     return 'Describe';
    default: return `Unknown(0x${cmd.toString(16).padStart(4, '0')})`;
  }
}

/**
 * Build an MMST packet.
 * preheader(8) + header(12) + body
 */
function buildMMSTPacket(command: number, body: Uint8Array, seqno = 0): Uint8Array {
  const headerLen = 20; // 8 preheader + 12 header (without preheader's 8 bytes)
  const total = 8 + 12 + body.length;
  const pkt = new Uint8Array(total);
  const dv = new DataView(pkt.buffer);

  // Preheader
  dv.setUint32(0, 0, true);         // bandwidth (LE)
  dv.setUint16(4, 0, true);         // chunk_count (LE)
  dv.setUint16(6, 0x0003, true);    // flags = 3 (LE)

  // Header
  dv.setUint32(8, seqno, true);     // timestamp_low (LE)
  dv.setUint32(12, 0, true);        // timestamp_high (LE)
  dv.setUint32(16, headerLen + body.length, true); // packet_id_type = length
  dv.setUint16(20, command, true);  // command (LE)
  dv.setUint16(22, 0x0000, true);   // direction

  pkt.set(body, 24);
  return pkt;
}

/**
 * Build MMST CONNECT body.
 * Contains a null-terminated transport string and player GUID.
 */
function buildConnectBody(streamUrl: string): Uint8Array {
  // Transport string in Unicode (UTF-16LE) with null terminator
  // Format: "\0\0" then UTF-16LE encoded transport string + "\0\0"
  const playerGuid = '{00000000-0000-0000-0000-000000000000}';
  const transport = `\\\\.\\${streamUrl}`;

  // Build as UTF-16LE
  function toUTF16LE(s: string): Uint8Array {
    const buf = new Uint8Array(s.length * 2 + 2);
    const dv = new DataView(buf.buffer);
    for (let i = 0; i < s.length; i++) {
      dv.setUint16(i * 2, s.charCodeAt(i), true);
    }
    // null terminator already zero
    return buf;
  }

  const guidBytes = enc.encode(playerGuid + '\0');
  const transportBytes = toUTF16LE(transport);
  const reserved = new Uint8Array(8);

  // Body: [4 bytes reserved][4 bytes protocol version=0x00020000][guid][transport]
  const body = new Uint8Array(4 + 4 + guidBytes.length + transportBytes.length + reserved.length);
  const dv = new DataView(body.buffer);
  dv.setUint32(0, 0, true);         // reserved
  dv.setUint32(4, 0x00020000, true); // protocol version
  let off = 8;
  body.set(guidBytes, off); off += guidBytes.length;
  body.set(transportBytes, off); off += transportBytes.length;
  body.set(reserved, off);

  return body;
}

/**
 * Parse an MMST response packet.
 */
function parseMMSTResponse(data: Uint8Array): {
  command: number;
  commandName: string;
  bodyLength: number;
  body: Uint8Array;
} | null {
  if (data.length < 24) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const command = dv.getUint16(20, true);
  const bodyLength = Math.max(0, dv.getUint32(16, true) - 12);
  const body = data.slice(24, 24 + bodyLength);
  return { command, commandName: cmdName(command), bodyLength, body };
}

/**
 * Read until at least minBytes are available, with timeout.
 */
async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
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
    // Return after getting at least one chunk
    break;
  }

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Probe an MMS server: connect and get server version information.
 *
 * POST /api/mms/probe
 * Body: { host, port?, timeout?, url? }
 */
export async function handleMMSProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MMSRequest;
    const { host, port = 1755, timeout = 15000 } = body;
    const streamUrl = body.url || `mms://${host}/`;

    if (!host) {
      return new Response(JSON.stringify({
        success: false, host: '', port,
        error: 'Host is required',
      } satisfies MMSResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false, host, port,
        error: 'Port must be between 1 and 65535',
      } satisfies MMSResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, host, port,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);
    const tp = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, tp]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send MMST CONNECT command
      const connectBody = buildConnectBody(streamUrl);
      const connectPkt = buildMMSTPacket(MMS_CMD_CONNECT, connectBody, 1);
      await writer.write(connectPkt);
      writer.releaseLock();

      // Read server response
      const respData = await Promise.race([readWithTimeout(reader, Math.min(timeout, 8000)), tp]);
      reader.releaseLock();
      socket.close();

      const rtt = Date.now() - start;

      if (respData.length === 0) {
        return new Response(JSON.stringify({
          success: false, host, port,
          error: 'No response from MMS server (port open but no MMST response)',
          rtt,
        } satisfies MMSResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const parsed = parseMMSTResponse(respData);
      const rawText = dec.decode(respData.slice(0, Math.min(256, respData.length)));

      // Try to extract server version string from response body
      let serverVersion: string | undefined;
      if (parsed?.body) {
        const bodyText = dec.decode(parsed.body);
        const verMatch = bodyText.match(/(?:Windows Media Services?|WMS|MSFT)\s+([\d.]+)/i);
        if (verMatch) serverVersion = verMatch[1];
      }

      return new Response(JSON.stringify({
        success: true,
        host, port,
        commandCode: parsed?.command,
        commandName: parsed?.commandName,
        serverVersion,
        serverInfo: rawText.replace(/\0/g, '').trim().slice(0, 256) || undefined,
        dataLength: respData.length,
        rtt,
      } satisfies MMSResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false, host: '', port: 1755,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies MMSResponse), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Request stream description from MMS server.
 * Sends CONNECT then DESCRIBE (0x001E) to get stream metadata.
 *
 * POST /api/mms/describe
 * Body: { host, port?, timeout?, url? }
 */
export async function handleMMSDescribe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MMSRequest;
    const { host, port = 1755, timeout = 15000 } = body;
    const streamUrl = body.url || `mms://${host}/`;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);
    const tp = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, tp]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Phase 1: CONNECT
      const connectBody = buildConnectBody(streamUrl);
      await writer.write(buildMMSTPacket(MMS_CMD_CONNECT, connectBody, 1));

      // Read CONNECT response
      let connectResp: Uint8Array;
      try {
        connectResp = await Promise.race([readWithTimeout(reader, 5000), tp]);
      } catch {
        connectResp = new Uint8Array(0);
      }

      if (connectResp.length === 0) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false, host, port,
          error: 'No CONNECT response from MMS server',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Phase 2: DESCRIBE
      const urlBytes = enc.encode(streamUrl + '\0');
      await writer.write(buildMMSTPacket(MMS_CMD_DESCRIBE, urlBytes, 2));
      writer.releaseLock();

      // Collect DESCRIBE response(s)
      const descChunks: Uint8Array[] = [];
      let totalBytes = 0;
      const descDeadline = Date.now() + Math.min(timeout - (Date.now() - start), 8000);

      while (Date.now() < descDeadline && totalBytes < 32768) {
        let chunk: Uint8Array;
        try {
          chunk = await Promise.race([
            readWithTimeout(reader, descDeadline - Date.now()),
            tp,
          ]);
        } catch {
          break;
        }
        if (chunk.length === 0) break;
        descChunks.push(chunk);
        totalBytes += chunk.length;
        if (descChunks.length >= 3) break;
      }

      reader.releaseLock();
      socket.close();

      const rtt = Date.now() - start;

      // Parse what we got
      const connectParsed = parseMMSTResponse(connectResp);
      const allDescData = new Uint8Array(totalBytes);
      let off = 0;
      for (const c of descChunks) { allDescData.set(c, off); off += c.length; }

      const descParsed = allDescData.length >= 24 ? parseMMSTResponse(allDescData) : null;

      return new Response(JSON.stringify({
        success: descChunks.length > 0 || connectResp.length > 0,
        host, port, streamUrl,
        connectCommand: connectParsed?.commandName,
        describeCommand: descParsed?.commandName,
        dataLength: totalBytes,
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
