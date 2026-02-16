/**
 * MPD (Music Player Daemon) Protocol Implementation
 *
 * MPD is a server-side application for playing music. It uses a simple
 * text-based protocol over TCP (default port 6600).
 *
 * Protocol Flow:
 * 1. Client connects → Server sends "OK MPD <version>\n"
 * 2. Client sends text commands (one per line)
 * 3. Server responds with key-value pairs, ending with "OK\n"
 * 4. Errors: "ACK [error@command_listNum] {current_command} message_text\n"
 * 5. Client sends "close\n" to disconnect
 *
 * Key Commands:
 * - status: Playback state, volume, repeat, random, playlist info
 * - stats: Database stats (artists, albums, songs, uptime, playtime)
 * - currentsong: Currently playing track metadata
 * - listplaylists: Saved playlists
 * - outputs: Audio output devices
 * - commands: List available commands
 *
 * Use Cases:
 * - Music server discovery and probing
 * - MPD server health monitoring
 * - Playback status checking
 * - Audio output configuration review
 */

import { connect } from 'cloudflare:sockets';

interface MpdStatusRequest {
  host: string;
  port?: number;
  password?: string;
  timeout?: number;
}

interface MpdCommandRequest {
  host: string;
  port?: number;
  password?: string;
  command: string;
  timeout?: number;
}

interface MpdKeyValue {
  key: string;
  value: string;
}

interface MpdStatusResponse {
  success: boolean;
  server: string;
  version?: string;
  status?: MpdKeyValue[];
  stats?: MpdKeyValue[];
  currentSong?: MpdKeyValue[];
  error?: string;
}

interface MpdCommandResponse {
  success: boolean;
  server: string;
  version?: string;
  command?: string;
  response?: MpdKeyValue[];
  raw?: string;
  error?: string;
}

const DEFAULT_PORT = 6600;
const MAX_RESPONSE_SIZE = 100000;

// Safe commands that don't modify state
const SAFE_COMMANDS = new Set([
  'status', 'stats', 'currentsong', 'listplaylists', 'outputs',
  'commands', 'notcommands', 'tagtypes', 'urlhandlers', 'decoders',
  'idle', 'noidle', 'config', 'replay_gain_status',
  'list', 'find', 'search', 'count', 'listall', 'listallinfo',
  'lsinfo', 'playlistinfo', 'listplaylist', 'listplaylistinfo',
]);

/**
 * Read data from socket until OK, ACK, or timeout
 */
async function readMpdResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let fullText = '';

  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Response timeout');

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Read timeout')), remaining);
    });

    const { value, done } = await Promise.race([
      reader.read(),
      timeoutPromise,
    ]);

    if (done) break;

    if (value) {
      chunks.push(value);
      totalBytes += value.length;

      if (totalBytes > MAX_RESPONSE_SIZE) {
        throw new Error('Response too large');
      }

      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      fullText = new TextDecoder().decode(combined);

      // MPD responses end with "OK\n" or "ACK [...]\n"
      if (fullText.endsWith('OK\n') || /ACK \[.*\].*\n$/.test(fullText)) {
        break;
      }
    }
  }

  return fullText;
}

/**
 * Parse MPD key-value response lines into structured data
 */
function parseMpdLines(text: string): MpdKeyValue[] {
  const result: MpdKeyValue[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (line === 'OK' || line === '' || line.startsWith('ACK ')) continue;
    const colonIdx = line.indexOf(': ');
    if (colonIdx > 0) {
      result.push({
        key: line.substring(0, colonIdx),
        value: line.substring(colonIdx + 2),
      });
    }
  }

  return result;
}

/**
 * Check for ACK error in response
 */
function getAckError(text: string): string | null {
  const match = text.match(/ACK \[\d+@\d+\] \{[^}]*\} (.+)/);
  return match ? match[1] : null;
}

/**
 * Run an MPD session: connect, optionally authenticate, run commands, close
 */
async function mpdSession(
  host: string,
  port: number,
  password: string | undefined,
  commands: string[],
  timeoutMs: number
): Promise<{ version: string; responses: string[] }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeoutMs);
  });

  try {
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Read banner: "OK MPD x.y.z\n"
    const banner = await readMpdResponse(reader, timeoutMs);
    const versionMatch = banner.match(/^OK MPD (.+)/);
    if (!versionMatch) {
      throw new Error(`Unexpected banner: ${banner.substring(0, 100)}`);
    }
    const version = versionMatch[1].trim();

    // Authenticate if password provided
    if (password) {
      await writer.write(new TextEncoder().encode(`password ${password}\n`));
      const authResp = await readMpdResponse(reader, timeoutMs);
      const authErr = getAckError(authResp);
      if (authErr) {
        throw new Error(`Authentication failed: ${authErr}`);
      }
    }

    // Run each command
    const responses: string[] = [];
    for (const cmd of commands) {
      await writer.write(new TextEncoder().encode(`${cmd}\n`));
      const resp = await readMpdResponse(reader, timeoutMs);
      responses.push(resp);
    }

    // Close gracefully
    await writer.write(new TextEncoder().encode('close\n'));
    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return { version, responses };
  } catch (error) {
    socket.close();
    throw error;
  }
}

/**
 * Handle MPD status request - get server version, status, stats, and current song
 */
export async function handleMpdStatus(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MpdStatusRequest;
    const {
      host,
      port = DEFAULT_PORT,
      password,
      timeout = 10000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Host is required',
      } satisfies MpdStatusResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Port must be between 1 and 65535',
      } satisfies MpdStatusResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Invalid host format',
      } satisfies MpdStatusResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { version, responses } = await mpdSession(
      host, port, password,
      ['status', 'stats', 'currentsong'],
      timeout
    );

    const status = parseMpdLines(responses[0]);
    const stats = parseMpdLines(responses[1]);
    const currentSong = parseMpdLines(responses[2]);

    // Check for errors in any response
    for (const resp of responses) {
      const err = getAckError(resp);
      if (err) {
        return new Response(JSON.stringify({
          success: false,
          server: `${host}:${port}`,
          version,
          error: err,
        } satisfies MpdStatusResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      server: `${host}:${port}`,
      version,
      status,
      stats,
      currentSong: currentSong.length > 0 ? currentSong : undefined,
    } satisfies MpdStatusResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      server: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies MpdStatusResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle MPD command request - run a single read-only command
 */
export async function handleMpdCommand(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MpdCommandRequest;
    const {
      host,
      port = DEFAULT_PORT,
      password,
      command,
      timeout = 10000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Host is required',
      } satisfies MpdCommandResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!command) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Command is required',
      } satisfies MpdCommandResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Port must be between 1 and 65535',
      } satisfies MpdCommandResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Invalid host format',
      } satisfies MpdCommandResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Extract the base command (first word) for safety check
    const baseCommand = command.trim().split(/\s+/)[0].toLowerCase();
    if (!SAFE_COMMANDS.has(baseCommand)) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: `Command "${baseCommand}" is not allowed. Only read-only commands are permitted.`,
      } satisfies MpdCommandResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate command doesn't contain control characters
    if (/[\r\n]/.test(command)) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Command must not contain newlines',
      } satisfies MpdCommandResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { version, responses } = await mpdSession(
      host, port, password,
      [command],
      timeout
    );

    const responseText = responses[0];
    const err = getAckError(responseText);

    if (err) {
      return new Response(JSON.stringify({
        success: false,
        server: `${host}:${port}`,
        version,
        command,
        error: err,
        raw: responseText.substring(0, 5000),
      } satisfies MpdCommandResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      server: `${host}:${port}`,
      version,
      command,
      response: parseMpdLines(responseText),
      raw: responseText.substring(0, 5000),
    } satisfies MpdCommandResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      server: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies MpdCommandResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
