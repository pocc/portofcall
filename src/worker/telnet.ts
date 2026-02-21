/**
 * Telnet Protocol Support for Cloudflare Workers
 * Simple text-based terminal protocol
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface TelnetConnectionOptions {
  host: string;
  port?: number;
  timeout?: number;
}

// Telnet IAC (Interpret As Command) constants
const IAC = 255;  // Interpret as command
const DONT = 254; // Don't perform option
const DO = 253;   // Perform option
const WONT = 252; // Won't perform option
const WILL = 251; // Will perform option
const SB = 250;   // Subnegotiation begin
const SE = 240;   // Subnegotiation end

// Telnet option codes
const ECHO = 1;
const SUPPRESS_GO_AHEAD = 3;
const TERMINAL_TYPE = 24;
const NAWS = 31;  // Negotiate About Window Size

/**
 * Handle Telnet connection test (HTTP mode)
 */
export async function handleTelnetConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<TelnetConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<TelnetConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '23'),
        timeout: parseInt(url.searchParams.get('timeout') || '30000'),
      };
    }

    // Validate required fields
    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 23;

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Set timeout for entire connection attempt
    const timeoutMs = options.timeout || 30000;

    // Wrap entire connection in timeout
    const connectionPromise = (async () => {
      // Test connection
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      // Read initial banner/prompt
      const reader = socket.readable.getReader();
      const readPromise = reader.read();
      const readTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Read timeout')), 5000) // 5s for banner
      );

      try {
        const { value } = await Promise.race([readPromise, readTimeoutPromise]);
        const banner = value ? new TextDecoder().decode(value) : '';

        await socket.close();

        return {
          success: true,
          message: 'Telnet server reachable',
          host,
          port,
          banner: banner.trim(),
          note: 'This is a connectivity test. For interactive sessions, use WebSocket mode.',
        };
      } catch (error) {
        await socket.close();

        // If read timeout, server is reachable but not responding
        return {
          success: true,
          message: 'Telnet server reachable (no banner)',
          host,
          port,
          banner: '',
          note: 'Server connected but did not send initial banner.',
        };
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      // Connection timed out
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Telnet WebSocket connection (interactive mode)
 */
export async function handleTelnetWebSocket(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    const host = url.searchParams.get('host');
    const port = parseInt(url.searchParams.get('port') || '23');

    if (!host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket
    server.accept();

    // Connect to Telnet server
    const socket = connect(`${host}:${port}`);
    await socket.opened;

    // Send connection info to client
    server.send(JSON.stringify({
      type: 'telnet-connected',
      host,
      port,
      message: 'Connected to Telnet server',
    }));

    // Acquire a single writer for the socket's writable side.
    // Both pipe functions share this writer so only one lock is held.
    const socketWriter = socket.writable.getWriter();

    // Pipe data bidirectionally with Telnet protocol handling
    pipeWebSocketToTelnet(server, socketWriter);
    pipeTelnetToWebSocket(socket, socketWriter, server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Pipe WebSocket messages to Telnet server.
 * Accepts a pre-acquired writer so the writable lock is not duplicated.
 */
function pipeWebSocketToTelnet(ws: WebSocket, writer: WritableStreamDefaultWriter<Uint8Array>): void {
  ws.addEventListener('message', async (event) => {
    try {
      if (typeof event.data === 'string') {
        await writer.write(new TextEncoder().encode(event.data));
      } else if (event.data instanceof ArrayBuffer) {
        await writer.write(new Uint8Array(event.data));
      }
    } catch (error) {
      console.error('Error writing to Telnet socket:', error);
      ws.close();
    }
  });

  ws.addEventListener('close', () => {
    writer.close().catch(() => {});
  });
}

/**
 * Process IAC (Interpret As Command) sequences from raw Telnet data.
 *
 * Implements the RFC 854 IAC state machine:
 *   - WILL (0xFB) / DO (0xFD)     → refuse with WONT/DONT for all options
 *   - WONT (0xFC) / DONT (0xFE)   → no response required, skip option byte
 *   - SB   (0xFA) subnegotiation  → skip until IAC SE (0xFF 0xF0)
 *   - All other bytes              → pass through as displayable text
 *
 * Returns the cleaned text and any IAC response bytes to send back to
 * the server.
 */
function processIACData(data: Uint8Array): { text: string; responses: Uint8Array[] } {
  const responses: Uint8Array[] = [];
  let i = 0;
  const textBytes: number[] = [];

  while (i < data.length) {
    if (data[i] !== IAC) {
      // Normal data byte — pass through
      textBytes.push(data[i++]);
      continue;
    }

    // IAC byte — need at least one more byte
    i++;
    if (i >= data.length) break;

    const cmd = data[i];

    if (cmd === WILL || cmd === DO) {
      // Server sent WILL X or DO X — refuse with WONT X / DONT X
      i++;
      if (i >= data.length) break;
      const opt = data[i++];
      const reply = cmd === WILL ? DONT : WONT;
      responses.push(new Uint8Array([IAC, reply, opt]));

    } else if (cmd === WONT || cmd === DONT) {
      // Server sent WONT X or DONT X — no response needed, just skip option
      i++;
      if (i < data.length) i++; // skip option byte

    } else if (cmd === SB) {
      // Subnegotiation — skip until IAC SE
      i++;
      while (i < data.length) {
        if (data[i] === IAC && i + 1 < data.length && data[i + 1] === SE) {
          i += 2; // skip IAC SE
          break;
        }
        i++;
      }

    } else {
      // Other single-byte IAC command (NOP, DM, BRK, etc.) — skip
      i++;
    }
  }

  return {
    text: new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(textBytes)),
    responses,
  };
}

/**
 * Pipe Telnet server data to WebSocket.
 * IAC command sequences are filtered out of the output stream and
 * appropriate responses are sent back to the Telnet server per RFC 854.
 *
 * Accepts the shared writer so the writable lock is not duplicated.
 */
async function pipeTelnetToWebSocket(
  socket: Socket,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  ws: WebSocket,
): Promise<void> {
  const reader = socket.readable.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        ws.close();
        break;
      }

      // Process IAC negotiation sequences per RFC 854
      const { text, responses } = processIACData(value);

      // Send negotiation responses back to the Telnet server
      if (responses.length > 0) {
        const combined = new Uint8Array(responses.reduce((sum, r) => sum + r.length, 0));
        let off = 0;
        for (const r of responses) { combined.set(r, off); off += r.length; }
        writer.write(combined).catch(() => {});
      }

      // Forward cleaned text to the WebSocket client
      if (text.length > 0) {
        ws.send(text);
      }
    }
  } catch (error) {
    console.error('Error reading from Telnet socket:', error);
    ws.close();
  }
}

/**
 * Human-readable names for common Telnet option codes
 */
const TELNET_OPTION_NAMES: Record<number, string> = {
  1: 'ECHO',
  3: 'SUPPRESS-GO-AHEAD',
  5: 'STATUS',
  6: 'TIMING-MARK',
  24: 'TERMINAL-TYPE',
  31: 'NAWS',
  32: 'TERMINAL-SPEED',
  33: 'REMOTE-FLOW-CONTROL',
  34: 'LINEMODE',
  35: 'X-DISPLAY-LOCATION',
  36: 'ENVIRONMENT',
  37: 'AUTHENTICATION',
  38: 'ENCRYPTION',
  39: 'NEW-ENVIRON',
};

interface TelnetNegotiation {
  direction: 'server-will' | 'server-do' | 'server-wont' | 'server-dont';
  option: number;
  optionName: string;
  ourResponse: string;
}

/**
 * Handle Telnet IAC option negotiation (HTTP mode)
 * Connects, parses all server IAC sequences, responds appropriately, and
 * returns the negotiated options alongside the banner text.
 */
export async function handleTelnetNegotiate(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port || 23;
    const timeoutMs = body.timeout || 15000;

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();

    const negotiatePromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      const negotiations: TelnetNegotiation[] = [];
      const negotiatedOptions: string[] = [];

      // Collect initial data from server (up to 3 read iterations or 3s)
      const rawChunks: Uint8Array[] = [];
      const collectDeadline = Date.now() + 3000;

      let collectionDone = false;
      while (!collectionDone && Date.now() < collectDeadline) {
        const remaining = collectDeadline - Date.now();
        const readResult = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((resolve) =>
            setTimeout(() => resolve({ value: undefined, done: true }), remaining)
          ),
        ]);

        if (readResult.done || !readResult.value) {
          collectionDone = true;
          break;
        }

        rawChunks.push(readResult.value);

        // Stop collecting once we have some data and a brief pause
        if (rawChunks.length >= 3) collectionDone = true;
      }

      // Concatenate all raw bytes
      const totalLen = rawChunks.reduce((s, c) => s + c.length, 0);
      const raw = new Uint8Array(totalLen);
      let off = 0;
      for (const chunk of rawChunks) {
        raw.set(chunk, off);
        off += chunk.length;
      }

      // Parse IAC sequences, building responses
      const responseBytes: number[] = [];
      const cleanedBytes: number[] = [];

      let i = 0;
      while (i < raw.length) {
        if (raw[i] !== IAC) {
          cleanedBytes.push(raw[i]);
          i++;
          continue;
        }

        // IAC byte — need at least two more bytes for a command
        i++;
        if (i >= raw.length) break;

        const cmd = raw[i];
        i++;

        if (cmd === SB) {
          // Subnegotiation: consume until IAC SE
          while (i < raw.length) {
            if (raw[i] === IAC && i + 1 < raw.length && raw[i + 1] === SE) {
              i += 2;
              break;
            }
            i++;
          }
          continue;
        }

        if (cmd !== WILL && cmd !== WONT && cmd !== DO && cmd !== DONT) {
          // Some other IAC command (NOP, DM, etc.) — skip
          continue;
        }

        if (i >= raw.length) break;
        const option = raw[i];
        i++;

        const optionName = TELNET_OPTION_NAMES[option] ?? `OPTION-${option}`;

        if (cmd === WILL) {
          // Server says it WILL perform option X
          let response: number;
          let responseLabel: string;
          let accepted = false;

          if (option === SUPPRESS_GO_AHEAD || option === ECHO) {
            // Accept these two
            response = DO;
            responseLabel = `DO ${optionName}`;
            accepted = true;
          } else {
            response = DONT;
            responseLabel = `DONT ${optionName}`;
          }

          responseBytes.push(IAC, response, option);
          negotiations.push({
            direction: 'server-will',
            option,
            optionName,
            ourResponse: responseLabel,
          });
          if (accepted) negotiatedOptions.push(optionName);

        } else if (cmd === DO) {
          // Server asks us to DO option X
          let response: number;
          let responseLabel: string;
          let accepted = false;

          if (option === TERMINAL_TYPE) {
            // Agree to send terminal type, then send SB TERMINAL-TYPE IS "VT100" SE
            response = WILL;
            responseLabel = `WILL ${optionName}`;
            accepted = true;
            responseBytes.push(IAC, WILL, option);
            // SB TERMINAL-TYPE IS "VT100" SE
            // IS = 0x00
            const ttBytes = new TextEncoder().encode('VT100');
            responseBytes.push(IAC, SB, TERMINAL_TYPE, 0x00, ...ttBytes, IAC, SE);
          } else if (option === NAWS) {
            // Agree to send window size: 80 columns x 24 rows
            response = WILL;
            responseLabel = `WILL ${optionName}`;
            accepted = true;
            responseBytes.push(IAC, WILL, option);
            // SB NAWS 0 80 0 24 SE
            responseBytes.push(IAC, SB, NAWS, 0, 80, 0, 24, IAC, SE);
          } else {
            response = WONT;
            responseLabel = `WONT ${optionName}`;
            responseBytes.push(IAC, response, option);
          }

          negotiations.push({
            direction: 'server-do',
            option,
            optionName,
            ourResponse: responseLabel,
          });
          if (accepted) negotiatedOptions.push(optionName);

        } else if (cmd === WONT) {
          // Server says it WONT — just record, no response needed
          negotiations.push({
            direction: 'server-wont',
            option,
            optionName,
            ourResponse: '(no response required)',
          });
        } else if (cmd === DONT) {
          // Server says DONT — just record, no response needed
          negotiations.push({
            direction: 'server-dont',
            option,
            optionName,
            ourResponse: '(no response required)',
          });
        }
      }

      // Send all negotiation responses at once
      if (responseBytes.length > 0) {
        await writer.write(new Uint8Array(responseBytes));
      }

      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      await socket.close();

      const banner = new TextDecoder().decode(new Uint8Array(cleanedBytes)).trim();

      return { banner, negotiations, negotiatedOptions, rtt };
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    const result = await Promise.race([negotiatePromise, timeoutPromise]);

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      ...result,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Telnet negotiation failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Parse Telnet IAC commands from buffer
 * Returns { data: cleaned data, commands: IAC commands }
 */
export function parseTelnetIAC(buffer: Uint8Array): { data: Uint8Array; commands: number[][] } {
  const commands: number[][] = [];
  const cleaned: number[] = [];

  let i = 0;
  while (i < buffer.length) {
    if (buffer[i] === IAC) {
      // IAC command sequence
      const command: number[] = [IAC];
      i++;

      if (i >= buffer.length) break;

      const cmd = buffer[i];
      command.push(cmd);
      i++;

      // Commands that take an option byte
      if (cmd === DO || cmd === DONT || cmd === WILL || cmd === WONT) {
        if (i < buffer.length) {
          command.push(buffer[i]);
          i++;
        }
      } else if (cmd === SB) {
        // Subnegotiation - read until SE
        while (i < buffer.length) {
          command.push(buffer[i]);
          if (buffer[i] === IAC && i + 1 < buffer.length && buffer[i + 1] === SE) {
            command.push(buffer[i + 1]);
            i += 2;
            break;
          }
          i++;
        }
      }

      commands.push(command);
    } else {
      // Regular data
      cleaned.push(buffer[i]);
      i++;
    }
  }

  return {
    data: new Uint8Array(cleaned),
    commands,
  };
}

/**
 * Handle Telnet login (send credentials, collect shell prompt)
 *
 * POST /api/telnet/login
 * Body: { host, port?, username, password, timeout? }
 *
 * Connects to a Telnet server, responds to IAC negotiation,
 * detects the login/password prompts, submits credentials,
 * and returns whether authentication appeared to succeed along
 * with the collected banner text.
 */
export async function handleTelnetLogin(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  interface TelnetLoginRequest {
    host: string;
    port?: number;
    username: string;
    password: string;
    timeout?: number;
  }

  let body: TelnetLoginRequest;
  try {
    body = await request.json() as TelnetLoginRequest;
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 23, username, password, timeout = 15000 } = body;

  if (!host) {
    return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!username || !password) {
    return new Response(JSON.stringify({ success: false, error: 'username and password are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const startTime = Date.now();
  const messages: string[] = [];

  // Strip IAC sequences from raw Telnet data, respond to DO/WILL with WONT/DONT
  function processIAC(data: Uint8Array, writer: WritableStreamDefaultWriter<Uint8Array>): string {
    const text: number[] = [];
    const responses: Uint8Array[] = [];
    let i = 0;
    while (i < data.length) {
      if (data[i] === IAC) {
        const cmd = data[i + 1];
        if (cmd === DO || cmd === WILL) {
          // Respond WONT/DONT to all options to keep it simple
          const reply = cmd === DO ? DONT : WONT;
          responses.push(new Uint8Array([IAC, reply, data[i + 2]]));
          i += 3;
        } else if (cmd === DONT || cmd === WONT) {
          i += 3;
        } else if (cmd === SB) {
          // Skip subnegotiation until IAC SE
          i += 2;
          while (i < data.length - 1 && !(data[i] === IAC && data[i + 1] === SE)) i++;
          i += 2;
        } else {
          i += 2;
        }
      } else {
        text.push(data[i]);
        i++;
      }
    }
    // Send IAC responses asynchronously
    if (responses.length > 0) {
      const combined = new Uint8Array(responses.reduce((sum, r) => sum + r.length, 0));
      let off = 0;
      for (const r of responses) { combined.set(r, off); off += r.length; }
      writer.write(combined).catch(() => {});
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(text));
  }

  // Read until we see any of the given prompts (case-insensitive), with timeout
  async function readUntilPrompt(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    writer: WritableStreamDefaultWriter<Uint8Array>,
    prompts: string[],
    timeoutMs: number,
  ): Promise<string> {
    let accumulated = '';
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: boolean; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), remaining)
        ),
      ]);
      if (result.done || !result.value) break;
      accumulated += processIAC(result.value, writer);
      const lower = accumulated.toLowerCase();
      if (prompts.some((p) => lower.includes(p))) break;
    }
    return accumulated;
  }

  try {
    const socket = connect({ hostname: host, port }, { secureTransport: 'off' as const, allowHalfOpen: false });
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
    ]);

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    try {
      // Step 1: Read initial banner + login prompt
      const banner = await readUntilPrompt(reader, writer, ['login:', 'username:', 'user:'], Math.min(8000, timeout));
      messages.push(`Banner/prompt received (${banner.length} chars)`);

      // Step 2: Send username
      await writer.write(new TextEncoder().encode(username + '\r\n'));
      messages.push(`Sent username: ${username}`);

      // Step 3: Wait for password prompt
      await readUntilPrompt(reader, writer, ['password:', 'passwd:'], Math.min(6000, timeout));
      messages.push(`Password prompt received`);

      // Step 4: Send password
      await writer.write(new TextEncoder().encode(password + '\r\n'));
      messages.push('Sent password');

      // Step 5: Read post-auth response (shell prompt or error)
      const postAuth = await readUntilPrompt(
        reader,
        writer,
        ['$', '#', '>', 'incorrect', 'invalid', 'failed', 'denied', 'error'],
        Math.min(6000, timeout),
      );
      messages.push(`Post-auth response received (${postAuth.length} chars)`);

      const lower = postAuth.toLowerCase();
      const authenticated =
        (postAuth.includes('$') || postAuth.includes('#') || postAuth.includes('>')) &&
        !lower.includes('incorrect') &&
        !lower.includes('invalid') &&
        !lower.includes('failed') &&
        !lower.includes('denied');

      const rtt = Date.now() - startTime;
      return new Response(JSON.stringify({
        success: true,
        authenticated,
        host,
        port,
        banner: banner.trim().substring(0, 500),
        postAuthResponse: postAuth.trim().substring(0, 500),
        messages,
        rtt,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });

    } finally {
      reader.releaseLock();
      writer.releaseLock();
      await socket.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host,
      port,
      error: error instanceof Error ? error.message : 'Telnet login failed',
      messages,
      rtt: Date.now() - startTime,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
