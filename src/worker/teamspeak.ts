/**
 * TeamSpeak ServerQuery Protocol Implementation
 *
 * TeamSpeak 3 ServerQuery is a text-based administration interface for
 * TeamSpeak servers, running on port 10011 by default.
 *
 * Protocol Flow:
 * 1. Client connects → Server sends "TS3\n\r\n" followed by welcome text
 * 2. Client sends text commands (one per line)
 * 3. Server responds with key=value data, then "error id=X msg=...\n\r\n"
 * 4. Multiple items in a response are separated by "|"
 * 5. Client sends "quit\n" to disconnect
 *
 * Key Commands:
 * - version: Server version info
 * - whoami: Current connection info
 * - serverinfo: Virtual server details (requires login for full info)
 * - clientlist: Connected clients
 * - channellist: Channel hierarchy
 * - hostinfo: Host machine info
 * - instanceinfo: Server instance info
 *
 * Escaping Rules:
 * - \s = space, \p = pipe, \/ = forward slash, \\ = backslash
 * - \n = newline, \r = carriage return, \t = tab
 *
 * Use Cases:
 * - TeamSpeak server administration and monitoring
 * - Player/channel enumeration
 * - Server health checking
 * - Bot development and automation
 */

import { connect } from 'cloudflare:sockets';

interface TSConnectRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface TSCommandRequest {
  host: string;
  port?: number;
  command: string;
  timeout?: number;
}

interface TSKeyValue {
  key: string;
  value: string;
}

interface TSConnectResponse {
  success: boolean;
  server: string;
  banner?: string;
  version?: TSKeyValue[];
  whoami?: TSKeyValue[];
  error?: string;
}

interface TSCommandResponse {
  success: boolean;
  server: string;
  command?: string;
  items?: TSKeyValue[][];
  errorId?: number;
  errorMsg?: string;
  raw?: string;
  error?: string;
}

const DEFAULT_PORT = 10011;
const MAX_RESPONSE_SIZE = 100000;

// Safe read-only commands
const SAFE_COMMANDS = new Set([
  'version', 'whoami', 'serverinfo', 'clientlist', 'channellist',
  'hostinfo', 'instanceinfo', 'serverlist', 'servergrouplist',
  'channelgrouplist', 'servergroupclientlist', 'channelgroupclientlist',
  'permissionlist', 'serversnapshotcreate', 'logview',
  'clientinfo', 'channelinfo', 'clientfind', 'channelfind',
  'help',
]);

/**
 * Unescape TeamSpeak ServerQuery value
 */
function tsUnescape(s: string): string {
  return s
    .replace(/\\s/g, ' ')
    .replace(/\\p/g, '|')
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

/**
 * Parse a TeamSpeak ServerQuery response line into items
 * Items are separated by |, key=value pairs separated by spaces
 */
function parseTSResponse(line: string): TSKeyValue[][] {
  if (!line.trim()) return [];

  const items = line.split('|');
  return items.map(item => {
    const pairs: TSKeyValue[] = [];
    const parts = item.trim().split(' ');
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx > 0) {
        pairs.push({
          key: part.substring(0, eqIdx),
          value: tsUnescape(part.substring(eqIdx + 1)),
        });
      } else if (part.trim()) {
        pairs.push({ key: part, value: '' });
      }
    }
    return pairs;
  });
}

/**
 * Parse the error line: "error id=0 msg=ok"
 */
function parseTSError(line: string): { id: number; msg: string } | null {
  const match = line.match(/^error\s+id=(\d+)\s+msg=(.+)/);
  if (!match) return null;
  return {
    id: parseInt(match[1]),
    msg: tsUnescape(match[2]),
  };
}

/**
 * Read TS3 ServerQuery response from socket
 * Reads until "error id=..." line is found
 */
async function readTSResponse(
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

      // TS3 responses end with "error id=..." followed by \n\r\n
      if (/error id=\d+ msg=.+\n\r\n$/.test(fullText)) {
        break;
      }
    }
  }

  return fullText;
}

/**
 * Read the initial TS3 banner (TS3\n\r\n + welcome text ending with \n\r\n)
 */
async function readTSBanner(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let fullText = '';

  const deadline = Date.now() + timeoutMs;
  let bannerLines = 0;

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

      // Banner is: "TS3\n\r\n" + "Welcome to the..." + "\n\r\n"
      // Count the \n\r\n sequences - we need at least 2
      bannerLines = (fullText.match(/\n\r\n/g) || []).length;
      if (bannerLines >= 2) {
        break;
      }
    }
  }

  return fullText;
}

/**
 * Run a TeamSpeak ServerQuery session
 */
async function tsSession(
  host: string,
  port: number,
  commands: string[],
  timeoutMs: number
): Promise<{ banner: string; responses: string[] }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeoutMs);
  });

  try {
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Read banner
    const banner = await readTSBanner(reader, timeoutMs);
    if (!banner.startsWith('TS3')) {
      throw new Error(`Not a TeamSpeak server: ${banner.substring(0, 100)}`);
    }

    // Run each command
    const responses: string[] = [];
    for (const cmd of commands) {
      await writer.write(new TextEncoder().encode(`${cmd}\n`));
      const resp = await readTSResponse(reader, timeoutMs);
      responses.push(resp);
    }

    // Quit gracefully
    await writer.write(new TextEncoder().encode('quit\n'));
    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return { banner, responses };
  } catch (error) {
    socket.close();
    throw error;
  }
}

/**
 * Handle TeamSpeak connect - get server banner, version, and whoami
 */
export async function handleTeamSpeakConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as TSConnectRequest;
    const {
      host,
      port = DEFAULT_PORT,
      timeout = 10000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Host is required',
      } satisfies TSConnectResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Port must be between 1 and 65535',
      } satisfies TSConnectResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Invalid host format',
      } satisfies TSConnectResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { banner, responses } = await tsSession(
      host, port,
      ['version', 'whoami'],
      timeout
    );

    // Parse version response
    const versionLines = responses[0].split('\n').filter(l => l.trim() && !l.startsWith('error'));
    const versionData = versionLines.length > 0 ? parseTSResponse(versionLines[0]) : [];
    const version = versionData.length > 0 ? versionData[0] : [];

    // Parse whoami response
    const whoamiLines = responses[1].split('\n').filter(l => l.trim() && !l.startsWith('error'));
    const whoamiData = whoamiLines.length > 0 ? parseTSResponse(whoamiLines[0]) : [];
    const whoami = whoamiData.length > 0 ? whoamiData[0] : [];

    return new Response(JSON.stringify({
      success: true,
      server: `${host}:${port}`,
      banner: banner.trim(),
      version: version.length > 0 ? version : undefined,
      whoami: whoami.length > 0 ? whoami : undefined,
    } satisfies TSConnectResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      server: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies TSConnectResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle TeamSpeak command - run a single read-only ServerQuery command
 */
export async function handleTeamSpeakCommand(request: Request): Promise<Response> {
  try {
    const body = await request.json() as TSCommandRequest;
    const {
      host,
      port = DEFAULT_PORT,
      command,
      timeout = 10000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Host is required',
      } satisfies TSCommandResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!command) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Command is required',
      } satisfies TSCommandResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Port must be between 1 and 65535',
      } satisfies TSCommandResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Invalid host format',
      } satisfies TSCommandResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Extract base command for safety check
    const baseCommand = command.trim().split(/\s+/)[0].toLowerCase();
    if (!SAFE_COMMANDS.has(baseCommand)) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: `Command "${baseCommand}" is not allowed. Only read-only commands are permitted.`,
      } satisfies TSCommandResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate no newlines in command
    if (/[\r\n]/.test(command)) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Command must not contain newlines',
      } satisfies TSCommandResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { responses } = await tsSession(
      host, port,
      [command],
      timeout
    );

    const responseText = responses[0];
    const lines = responseText.split('\n').filter(l => l.trim());

    // Find the error line
    let errorId: number | undefined;
    let errorMsg: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      const errParsed = parseTSError(line);
      if (errParsed) {
        errorId = errParsed.id;
        errorMsg = errParsed.msg;
      } else {
        dataLines.push(line);
      }
    }

    // Parse data lines
    const items = dataLines.length > 0 ? parseTSResponse(dataLines.join('\n')) : [];

    if (errorId !== undefined && errorId !== 0) {
      return new Response(JSON.stringify({
        success: false,
        server: `${host}:${port}`,
        command,
        errorId,
        errorMsg,
        raw: responseText.substring(0, 5000),
        error: `ServerQuery error ${errorId}: ${errorMsg}`,
      } satisfies TSCommandResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      server: `${host}:${port}`,
      command,
      items: items.length > 0 ? items : undefined,
      errorId,
      errorMsg,
      raw: responseText.substring(0, 5000),
    } satisfies TSCommandResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      server: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies TSCommandResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
