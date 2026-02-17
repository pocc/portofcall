/**
 * Quake 3 / ioquake3 Server Query Protocol (Port 27960/TCP)
 *
 * Quake 3 Arena and derivatives (including ioquake3, OpenArena, Wolfenstein:ET,
 * Return to Castle Wolfenstein) use the Quake engine network protocol for
 * server queries. While the game traffic is UDP, many servers also accept
 * out-of-band (OOB) status queries over TCP.
 *
 * Out-of-Band (OOB) Packet Format:
 *   \xFF\xFF\xFF\xFF{command}\n
 *
 * Common Query Commands:
 *   getstatus  — Returns server cvars + player list
 *   getinfo    — Returns condensed server information
 *   getchallenge — Returns a challenge token (for authentication)
 *
 * Server Status Response Format:
 *   \xFF\xFF\xFF\xFFstatusResponse\n
 *   \{key\value\key\value\...}\n
 *   {score ping name}\n  (one line per player)
 *
 * Server Info Response Format:
 *   \xFF\xFF\xFF\xFFinfoResponse\n
 *   \{key\value\key\value\...}
 *
 * Default Port: 27960/TCP+UDP
 *
 * Note: Most Quake 3 servers primarily use UDP. TCP query support is available
 * in ioquake3 and several derivatives but is not universal.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface Quake3QueryRequest {
  host: string;
  port?: number;
  command?: 'getstatus' | 'getinfo';
  timeout?: number;
}

interface Quake3Player {
  score: number;
  ping: number;
  name: string;
}

interface Quake3StatusResponse {
  success: boolean;
  host?: string;
  port?: number;
  tcpLatency?: number;
  command?: string;
  serverVars?: Record<string, string>;
  players?: Quake3Player[];
  playerCount?: number;
  maxPlayers?: number;
  mapName?: string;
  gameName?: string;
  error?: string;
  isCloudflare?: boolean;
  note?: string;
}

/** The 4-byte OOB header that prefixes all Quake 3 OOB packets */
const OOB_HEADER = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);

/**
 * Build a Quake 3 OOB query packet.
 */
function buildOOBPacket(command: string): Uint8Array {
  const cmdBytes = new TextEncoder().encode(command + '\n');
  const packet = new Uint8Array(OOB_HEADER.length + cmdBytes.length);
  packet.set(OOB_HEADER, 0);
  packet.set(cmdBytes, OOB_HEADER.length);
  return packet;
}

/**
 * Parse Quake 3 key-value string format: \key\value\key\value\...
 */
function parseQ3KeyValues(data: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = data.split('\\');
  // parts[0] is empty (before the first \)
  for (let i = 1; i + 1 < parts.length; i += 2) {
    result[parts[i]] = parts[i + 1] ?? '';
  }
  return result;
}

/**
 * Parse a player entry line: "{score} {ping} \"{name}\""
 */
function parseQ3Player(line: string): Quake3Player | null {
  const match = line.match(/^(-?\d+)\s+(-?\d+)\s+"(.*)"/);
  if (!match) return null;
  return {
    score: parseInt(match[1], 10),
    ping: parseInt(match[2], 10),
    name: match[3],
  };
}

/**
 * Read available data from socket with a short timeout.
 */
async function readAvailable(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  firstTimeout: number,
  continueTimeout = 500,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLen = 0;

  const firstDeadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), firstTimeout),
  );

  try {
    const { value, done } = await Promise.race([reader.read(), firstDeadline]);
    if (done || !value) return new Uint8Array(0);
    chunks.push(value);
    totalLen += value.length;
  } catch {
    return new Uint8Array(0);
  }

  // Drain any remaining data
  try {
    while (true) {
      const cont = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('cont_timeout')), continueTimeout),
      );
      const { value, done } = await Promise.race([reader.read(), cont]);
      if (done || !value) break;
      chunks.push(value);
      totalLen += value.length;
    }
  } catch {
    // Short timeout expired
  }

  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

function validateInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) return 'Host is required';
  if (!/^[a-zA-Z0-9._-]+$/.test(host)) return 'Host contains invalid characters';
  if (port < 1 || port > 65535) return 'Port must be between 1 and 65535';
  return null;
}

/**
 * Query a Quake 3 server status via OOB TCP packet.
 *
 * POST /api/quake3/status
 * Body: { host, port?, command?, timeout? }
 *
 * Returns server variables (cvars) and connected player list.
 */
export async function handleQuake3Status(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as Quake3QueryRequest;
    const {
      host,
      port = 27960,
      command = 'getstatus',
      timeout = 10000,
    } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies Quake3StatusResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        } satisfies Quake3StatusResponse),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`);

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const tcpLatency = Date.now() - startTime;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send OOB query
      const packet = buildOOBPacket(command);
      await writer.write(packet);

      // Read response
      const responseData = await readAvailable(reader, 5000);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (responseData.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            host,
            port,
            tcpLatency,
            command,
            error: 'No response received. Server may not support TCP queries — try UDP if possible.',
            note: 'Quake 3 servers primarily use UDP. TCP query support depends on the server build.',
          } satisfies Quake3StatusResponse),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const responseText = new TextDecoder('utf-8', { fatal: false }).decode(responseData);

      // Validate OOB header: \xFF\xFF\xFF\xFF
      const hasOOBHeader = responseData[0] === 0xFF && responseData[1] === 0xFF &&
        responseData[2] === 0xFF && responseData[3] === 0xFF;

      if (!hasOOBHeader) {
        return new Response(
          JSON.stringify({
            success: false,
            host,
            port,
            tcpLatency,
            command,
            error: 'Unexpected response format — not a Quake 3 server',
          } satisfies Quake3StatusResponse),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Strip the 4-byte OOB header
      const payload = responseText.slice(4);
      const lines = payload.split('\n');

      // First line: response type (e.g. "statusResponse" or "infoResponse")
      const responseType = lines[0].trim();

      const result: Quake3StatusResponse = {
        success: true,
        host,
        port,
        tcpLatency,
        command,
      };

      if (responseType === 'statusResponse' && lines.length > 1) {
        // Line 1: key\value pairs
        const kvString = lines[1];
        const serverVars = parseQ3KeyValues(kvString);
        result.serverVars = serverVars;
        result.mapName = serverVars.mapname || serverVars.map || undefined;
        result.gameName = serverVars.gamename || serverVars.game || undefined;
        result.maxPlayers = serverVars.sv_maxclients ? parseInt(serverVars.sv_maxclients, 10) : undefined;

        // Remaining lines: player entries
        const players: Quake3Player[] = [];
        for (let i = 2; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const player = parseQ3Player(line);
          if (player) players.push(player);
        }
        result.players = players;
        result.playerCount = players.length;
      } else if (responseType === 'infoResponse' && lines.length > 1) {
        const kvString = lines[1];
        const serverVars = parseQ3KeyValues(kvString);
        result.serverVars = serverVars;
        result.mapName = serverVars.mapname || undefined;
        result.gameName = serverVars.gamename || undefined;
        result.playerCount = serverVars.clients ? parseInt(serverVars.clients, 10) : undefined;
        result.maxPlayers = serverVars.sv_maxclients ? parseInt(serverVars.sv_maxclients, 10) : undefined;
      } else {
        result.serverVars = { rawResponse: payload.slice(0, 500) };
      }

      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } satisfies Quake3StatusResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Query Quake 3 server info (condensed status).
 *
 * POST /api/quake3/info
 * Body: { host, port?, timeout? }
 */
export async function handleQuake3Info(request: Request): Promise<Response> {
  // Reuse status handler with getinfo command
  const url = new URL(request.url);
  const body = await request.json() as Quake3QueryRequest;
  return handleQuake3Status(new Request(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, command: 'getinfo' }),
  }));
}
