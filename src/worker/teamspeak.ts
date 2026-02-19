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
 * Escape a value for use in TeamSpeak ServerQuery commands
 */
function tsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/ /g, '\\s')
    .replace(/\|/g, '\\p')
    .replace(/\//g, '\\/')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Unescape TeamSpeak ServerQuery value
 */
function tsUnescape(s: string): string {
  return s
    .replace(/\\s/g, ' ')
    .replace(/\\p/g, '|')
    .replace(/\\\//g, '/')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\'); // Must be last to avoid false matches
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

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Read timeout')), remaining);
    });

    try {
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

        // TS3 responses end with "error id=..." followed by \r\n
        if (/error id=\d+ msg=.+\r\n$/.test(fullText)) {
          break;
        }
      }
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }

  return fullText;
}

/**
 * Read the initial TS3 banner (TS3\r\n + welcome text ending with \r\n)
 */
async function readTSBanner(
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

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Read timeout')), remaining);
    });

    try {
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

        // Banner is: "TS3" + welcome text ending with \r\n
        // Look for at least one \r\n after "TS3" prefix
        if (fullText.startsWith('TS3') && /\r\n$/.test(fullText)) {
          break;
        }
      }
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
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

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeoutMs);
  });

  try {
    await Promise.race([socket.opened, timeoutPromise]);
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

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
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
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

    if (timeout < 1 || timeout > 300000) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Timeout must be between 1 and 300000 ms',
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

    if (timeout < 1 || timeout > 300000) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Timeout must be between 1 and 300000 ms',
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

// ─── Channel types ────────────────────────────────────────────────────────

interface TSChannelRequest {
  host: string;
  port?: number;
  timeout?: number;
  serverAdminToken?: string;
  channelName?: string;
  channelTopic?: string;
}

interface TSChannelEntry {
  cid: string;
  name: string;
  topic: string;
  clientsOnline: string;
  maxClients: string;
}

interface TSChannelResponse {
  success: boolean;
  server: string;
  channels?: TSChannelEntry[];
  newChannelId?: string;
  errorId?: number;
  errorMsg?: string;
  error?: string;
}

/**
 * Handle TeamSpeak channel list and optional channel creation.
 *
 * Connects to the ServerQuery port, optionally authenticates with a server
 * admin token, selects virtual server 1, retrieves the full channel list,
 * and (if channelName is provided and a token was supplied) creates a new
 * permanent channel.
 *
 * Request body:
 *   { host, port?, timeout?, serverAdminToken?, channelName?, channelTopic? }
 */
export async function handleTeamSpeakChannel(request: Request): Promise<Response> {
  try {
    const body = await request.json() as TSChannelRequest;
    const {
      host,
      port = DEFAULT_PORT,
      timeout = 10000,
      serverAdminToken,
      channelName,
      channelTopic,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Host is required',
      } satisfies TSChannelResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Port must be between 1 and 65535',
      } satisfies TSChannelResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Invalid host format',
      } satisfies TSChannelResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (timeout < 1 || timeout > 300000) {
      return new Response(JSON.stringify({
        success: false,
        server: '',
        error: 'Timeout must be between 1 and 300000 ms',
      } satisfies TSChannelResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build command list — login and virtual-server selection are done
    // before the data commands so all subsequent responses are consistent.
    const commands: string[] = [];

    if (serverAdminToken) {
      commands.push(`login serveradmin ${tsEscape(serverAdminToken)}`);
    }

    // Select virtual server 1
    commands.push('use sid=1');

    // Get channel list with extended fields
    commands.push('channellist -topic -flags -voice -limits');

    // Optionally create a new permanent channel (admin token required)
    let createChannelCmdIndex = -1;
    if (channelName && serverAdminToken) {
      let createCmd = `channelcreate channel_name=${tsEscape(channelName)} channel_flag_permanent=1`;
      if (channelTopic) {
        createCmd += ` channel_topic=${tsEscape(channelTopic)}`;
      }
      createChannelCmdIndex = commands.length;
      commands.push(createCmd);
    }

    const socket = connect(`${host}:${port}`);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Read banner
      const banner = await readTSBanner(reader, timeout);
      if (!banner.startsWith('TS3')) {
        throw new Error(`Not a TeamSpeak server: ${banner.substring(0, 100)}`);
      }

      // Run all commands sequentially
      const responses: string[] = [];
      for (const cmd of commands) {
        await writer.write(new TextEncoder().encode(`${cmd}\n`));
        const resp = await readTSResponse(reader, timeout);
        responses.push(resp);
      }

      // Quit
      await writer.write(new TextEncoder().encode('quit\n'));
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Check for login errors (first response if token supplied)
      let responseOffset = 0;
      if (serverAdminToken) {
        const loginResp = responses[responseOffset++];
        const loginErrLine = loginResp.split('\n').find(l => l.startsWith('error'));
        if (loginErrLine) {
          const parsed = parseTSError(loginErrLine);
          if (parsed && parsed.id !== 0) {
            return new Response(JSON.stringify({
              success: false,
              server: `${host}:${port}`,
              errorId: parsed.id,
              errorMsg: parsed.msg,
              error: `Login failed: ${parsed.msg}`,
            } satisfies TSChannelResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
      }

      // use sid=1 response (skip — just check for hard error)
      responseOffset++;

      // channellist response
      const channelListResp = responses[responseOffset++];
      const channelLines = channelListResp.split('\n').filter(l => l.trim());

      let channelListErrorId: number | undefined;
      let channelListErrorMsg: string | undefined;
      const channelDataLines: string[] = [];

      for (const line of channelLines) {
        const errParsed = parseTSError(line);
        if (errParsed) {
          channelListErrorId = errParsed.id;
          channelListErrorMsg = errParsed.msg;
        } else {
          channelDataLines.push(line);
        }
      }

      const channels: TSChannelEntry[] = [];
      if (channelDataLines.length > 0) {
        const rawItems = channelDataLines.join('\n');
        // parseTSResponse splits on | to get per-channel items
        const parsed = parseTSResponse(rawItems);
        for (const item of parsed) {
          const kv: Record<string, string> = {};
          for (const pair of item) {
            kv[pair.key] = pair.value;
          }
          channels.push({
            cid: kv['cid'] || '',
            name: kv['channel_name'] || '',
            topic: kv['channel_topic'] || '',
            clientsOnline: kv['total_clients'] || kv['channel_total_clients'] || '0',
            maxClients: kv['channel_maxclients'] || '-1',
          });
        }
      }

      // Optional channelcreate response
      let newChannelId: string | undefined;
      if (createChannelCmdIndex >= 0 && responseOffset < responses.length) {
        const createResp = responses[responseOffset++];
        const createLines = createResp.split('\n').filter(l => l.trim());
        for (const line of createLines) {
          // Success response contains "cid=X" before the error line
          if (line.startsWith('cid=') || line.includes(' cid=')) {
            const cidMatch = line.match(/cid=(\d+)/);
            if (cidMatch) {
              newChannelId = cidMatch[1];
            }
          }
        }
      }

      if (channelListErrorId !== undefined && channelListErrorId !== 0) {
        return new Response(JSON.stringify({
          success: false,
          server: `${host}:${port}`,
          channels,
          errorId: channelListErrorId,
          errorMsg: channelListErrorMsg,
          error: `channellist error ${channelListErrorId}: ${channelListErrorMsg}`,
        } satisfies TSChannelResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        server: `${host}:${port}`,
        channels,
        newChannelId,
        errorId: channelListErrorId,
        errorMsg: channelListErrorMsg,
      } satisfies TSChannelResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      server: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies TSChannelResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── Text message / admin write commands ──────────────────────────────────

interface TSMessageRequest {
  host: string;
  port?: number;
  timeout?: number;
  serverAdminToken?: string;
  /** targetmode: 1=client, 2=channel, 3=server */
  targetmode?: 1 | 2 | 3;
  /** target: clid for client, cid for channel, ignored for server (targetmode=3) */
  target?: number;
  message: string;
}

interface TSMessageResponse {
  success: boolean;
  server: string;
  errorId?: number;
  errorMsg?: string;
  error?: string;
}

interface TSKickRequest {
  host: string;
  port?: number;
  timeout?: number;
  serverAdminToken: string;
  /** clid to kick */
  clid: number;
  /** reasonid: 4=channel, 5=server */
  reasonid?: 4 | 5;
  reasonmsg?: string;
}

interface TSBanRequest {
  host: string;
  port?: number;
  timeout?: number;
  serverAdminToken: string;
  /** Client ID to ban */
  clid: number;
  /** Ban duration in seconds; 0 = permanent */
  time?: number;
  banreason?: string;
}

interface TSBanResponse {
  success: boolean;
  server: string;
  banid?: string;
  errorId?: number;
  errorMsg?: string;
  error?: string;
}

/**
 * Send a text message via TeamSpeak ServerQuery.
 *
 * Supports server-wide (targetmode=3), channel (targetmode=2), and
 * direct client (targetmode=1) messages. Requires a server admin token
 * for server and channel messages; client messages may work without one.
 *
 * POST /api/teamspeak/message
 */
export async function handleTeamSpeakMessage(request: Request): Promise<Response> {
  try {
    const body = await request.json() as TSMessageRequest;
    const {
      host,
      port = DEFAULT_PORT,
      timeout = 10000,
      serverAdminToken,
      targetmode = 3,
      target = 0,
      message,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'Host is required' } satisfies TSMessageResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!message) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'Message is required' } satisfies TSMessageResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'Invalid host format' } satisfies TSMessageResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'Port must be between 1 and 65535' } satisfies TSMessageResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (timeout < 1 || timeout > 300000) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'Timeout must be between 1 and 300000 ms' } satisfies TSMessageResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const commands: string[] = [];
    if (serverAdminToken) {
      commands.push(`login serveradmin ${tsEscape(serverAdminToken)}`);
    }
    commands.push('use sid=1');
    // sendtextmessage targetmode=<1|2|3> target=<id> msg=<text>
    commands.push(`sendtextmessage targetmode=${targetmode} target=${target} msg=${tsEscape(message)}`);

    const socket = connect(`${host}:${port}`);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      const banner = await readTSBanner(reader, timeout);
      if (!banner.startsWith('TS3')) throw new Error(`Not a TeamSpeak server`);

      const responses: string[] = [];
      for (const cmd of commands) {
        await writer.write(new TextEncoder().encode(`${cmd}\n`));
        responses.push(await readTSResponse(reader, timeout));
      }

      await writer.write(new TextEncoder().encode('quit\n'));
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Check login error if token provided
      let responseIdx = 0;
      if (serverAdminToken) {
        const loginErrLine = responses[responseIdx++].split('\n').find(l => l.startsWith('error'));
        if (loginErrLine) {
          const parsed = parseTSError(loginErrLine);
          if (parsed && parsed.id !== 0) {
            return new Response(JSON.stringify({
              success: false,
              server: `${host}:${port}`,
              errorId: parsed.id,
              errorMsg: parsed.msg,
              error: `Login failed: ${parsed.msg}`,
            } satisfies TSMessageResponse), { headers: { 'Content-Type': 'application/json' } });
          }
        }
      }

      // Skip 'use sid=1' response
      responseIdx++;

      // Check sendtextmessage response
      const msgResp = responses[responseIdx];
      const errLine = msgResp.split('\n').find(l => l.startsWith('error'));
      const parsed = errLine ? parseTSError(errLine) : null;
      const success = !parsed || parsed.id === 0;

      return new Response(JSON.stringify({
        success,
        server: `${host}:${port}`,
        errorId: parsed?.id,
        errorMsg: parsed?.msg,
        error: parsed && parsed.id !== 0 ? `ServerQuery error ${parsed.id}: ${parsed.msg}` : undefined,
      } satisfies TSMessageResponse), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      server: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies TSMessageResponse), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Kick a client from the server or channel via TeamSpeak ServerQuery.
 *
 * POST /api/teamspeak/kick
 */
export async function handleTeamSpeakKick(request: Request): Promise<Response> {
  try {
    const body = await request.json() as TSKickRequest;
    const {
      host,
      port = DEFAULT_PORT,
      timeout = 10000,
      serverAdminToken,
      clid,
      reasonid = 5,
      reasonmsg,
    } = body;

    if (!host || !/^[a-zA-Z0-9._:-]+$/.test(host)) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'Valid host is required' } satisfies TSMessageResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!serverAdminToken) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'serverAdminToken is required' } satisfies TSMessageResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!clid) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'clid is required' } satisfies TSMessageResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'Port must be between 1 and 65535' } satisfies TSMessageResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (timeout < 1 || timeout > 300000) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'Timeout must be between 1 and 300000 ms' } satisfies TSMessageResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    let kickCmd = `clientkick reasonid=${reasonid} clid=${clid}`;
    if (reasonmsg) kickCmd += ` reasonmsg=${tsEscape(reasonmsg)}`;

    const commands = [
      `login serveradmin ${tsEscape(serverAdminToken)}`,
      'use sid=1',
      kickCmd,
    ];

    const socket = connect(`${host}:${port}`);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      const banner = await readTSBanner(reader, timeout);
      if (!banner.startsWith('TS3')) throw new Error('Not a TeamSpeak server');

      const responses: string[] = [];
      for (const cmd of commands) {
        await writer.write(new TextEncoder().encode(`${cmd}\n`));
        responses.push(await readTSResponse(reader, timeout));
      }
      await writer.write(new TextEncoder().encode('quit\n'));
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Parse kick result
      const kickResp = responses[2];
      const errLine = kickResp.split('\n').find(l => l.startsWith('error'));
      const parsed = errLine ? parseTSError(errLine) : null;
      const success = !parsed || parsed.id === 0;

      return new Response(JSON.stringify({
        success,
        server: `${host}:${port}`,
        errorId: parsed?.id,
        errorMsg: parsed?.msg,
        error: parsed && parsed.id !== 0 ? `ServerQuery error ${parsed.id}: ${parsed.msg}` : undefined,
      } satisfies TSMessageResponse), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      server: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies TSMessageResponse), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Ban a client by client ID via TeamSpeak ServerQuery.
 * Returns the ban ID on success.
 *
 * POST /api/teamspeak/ban
 */
export async function handleTeamSpeakBan(request: Request): Promise<Response> {
  try {
    const body = await request.json() as TSBanRequest;
    const {
      host,
      port = DEFAULT_PORT,
      timeout = 10000,
      serverAdminToken,
      clid,
      time = 0,
      banreason,
    } = body;

    if (!host || !/^[a-zA-Z0-9._:-]+$/.test(host)) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'Valid host is required' } satisfies TSBanResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!serverAdminToken) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'serverAdminToken is required' } satisfies TSBanResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!clid) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'clid is required' } satisfies TSBanResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'Port must be between 1 and 65535' } satisfies TSBanResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (timeout < 1 || timeout > 300000) {
      return new Response(JSON.stringify({ success: false, server: '', error: 'Timeout must be between 1 and 300000 ms' } satisfies TSBanResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    let banCmd = `banclient clid=${clid} time=${time}`;
    if (banreason) banCmd += ` banreason=${tsEscape(banreason)}`;

    const commands = [
      `login serveradmin ${tsEscape(serverAdminToken)}`,
      'use sid=1',
      banCmd,
    ];

    const socket = connect(`${host}:${port}`);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      const banner = await readTSBanner(reader, timeout);
      if (!banner.startsWith('TS3')) throw new Error('Not a TeamSpeak server');

      const responses: string[] = [];
      for (const cmd of commands) {
        await writer.write(new TextEncoder().encode(`${cmd}\n`));
        responses.push(await readTSResponse(reader, timeout));
      }
      await writer.write(new TextEncoder().encode('quit\n'));
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Parse ban result — success response contains 'banid=<N>'
      const banResp = responses[2];
      const lines = banResp.split('\n').filter(l => l.trim());
      let banid: string | undefined;
      let errorId: number | undefined;
      let errorMsg: string | undefined;

      for (const line of lines) {
        const errParsed = parseTSError(line);
        if (errParsed) {
          errorId = errParsed.id;
          errorMsg = errParsed.msg;
        } else {
          const m = line.match(/banid=(\d+)/);
          if (m) banid = m[1];
        }
      }

      const success = !errorId || errorId === 0;

      return new Response(JSON.stringify({
        success,
        server: `${host}:${port}`,
        banid,
        errorId,
        errorMsg,
        error: errorId && errorId !== 0 ? `ServerQuery error ${errorId}: ${errorMsg}` : undefined,
      } satisfies TSBanResponse), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      server: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies TSBanResponse), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
