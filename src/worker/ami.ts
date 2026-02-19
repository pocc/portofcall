/**
 * Asterisk Manager Interface (AMI) Protocol Implementation
 *
 * AMI is a text-based TCP protocol for monitoring and controlling Asterisk
 * PBX systems, running on port 5038 by default. It uses a request-response
 * model with key-value pairs separated by \r\n, similar to HTTP headers.
 *
 * Protocol Flow:
 * 1. Client connects → Server sends banner: "Asterisk Call Manager/X.X.X\r\n"
 * 2. Client sends actions as key-value blocks terminated by \r\n\r\n
 * 3. Server responds with Response blocks, also terminated by \r\n\r\n
 * 4. Client sends "Action: Logoff\r\n\r\n" to disconnect
 *
 * Action Format:
 *   Action: <ActionName>\r\n
 *   ActionID: <unique-id>\r\n
 *   Key: Value\r\n
 *   \r\n
 *
 * Response Format:
 *   Response: Success|Error\r\n
 *   ActionID: <unique-id>\r\n
 *   Message: <text>\r\n
 *   \r\n
 *
 * Key Actions:
 * - Login: Authenticate with username/secret
 * - Ping: Server keepalive check
 * - CoreShowChannels: List active channels
 * - SIPpeers: List SIP endpoints
 * - CoreSettings: Get Asterisk configuration
 * - Command: Execute CLI command
 *
 * Use Cases:
 * - VoIP system monitoring and administration
 * - Call center dashboards
 * - IVR management
 * - CDR (Call Detail Record) collection
 */

import { connect } from 'cloudflare:sockets';

interface AMIProbeRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface AMIProbeResponse {
  success: boolean;
  host: string;
  port: number;
  banner?: string;
  version?: string;
  rtt?: number;
  error?: string;
}

interface AMICommandRequest {
  host: string;
  port?: number;
  username: string;
  secret: string;
  action: string;
  params?: Record<string, string>;
  timeout?: number;
}

interface AMICommandResponse {
  success: boolean;
  host: string;
  port: number;
  action?: string;
  response?: Record<string, string>;
  events?: Record<string, string>[];
  transcript: string[];
  rtt?: number;
  error?: string;
}

const DEFAULT_PORT = 5038;

// Safe read-only actions that don't modify the PBX
const SAFE_ACTIONS = new Set([
  'ping', 'coresettings', 'corestatus', 'coreshowchannels',
  'sippeers', 'sipshowpeer', 'sipshowregistry',
  'iaxpeers', 'iaxpeerlist',
  'pjsipshowcontacts', 'pjsipshowregistrationinboundcontactstatus',
  'status', 'showdialplan', 'listcommands',
  'extensionstate', 'mailboxcount', 'mailboxstatus',
  'queuestatus', 'queuesummary',
  'parkedcalls', 'bridgelist',
  'presencestate', 'devicestatelist',
]);

/**
 * Buffered AMI stream reader. Maintains leftover data between reads so that
 * multi-message TCP segments are not lost.
 */
class AMIReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = '';

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader;
  }

  /**
   * Read raw data from the stream until the buffer satisfies `predicate`.
   * Returns the portion of the buffer up to and including the matched
   * delimiter; leftover bytes remain in the internal buffer for the next call.
   */
  private async readUntil(
    predicate: (buf: string) => number,
    timeoutMs: number,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;

    // Check if the buffer already contains a complete message
    const idx = predicate(this.buffer);
    if (idx !== -1) {
      const block = this.buffer.substring(0, idx);
      this.buffer = this.buffer.substring(idx);
      return block;
    }

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Read timeout');

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Read timeout')), remaining);
      });

      const { value, done } = await Promise.race([
        this.reader.read(),
        timeoutPromise,
      ]);

      if (done) {
        if (this.buffer.length > 0) {
          const block = this.buffer;
          this.buffer = '';
          return block;
        }
        throw new Error('Connection closed by server');
      }

      if (value) {
        this.buffer += this.decoder.decode(value, { stream: true });

        const splitIdx = predicate(this.buffer);
        if (splitIdx !== -1) {
          const block = this.buffer.substring(0, splitIdx);
          this.buffer = this.buffer.substring(splitIdx);
          return block;
        }
      }
    }
  }

  /**
   * Read the initial AMI banner line. The banner is a single line terminated
   * by \r\n (e.g. "Asterisk Call Manager/X.X.X\r\n"), NOT a full \r\n\r\n
   * block. Some servers may follow it with an extra \r\n, so we consume
   * everything up to and including the first \r\n.
   */
  async readBanner(timeoutMs: number): Promise<string> {
    const block = await this.readUntil((buf) => {
      const idx = buf.indexOf('\r\n');
      if (idx === -1) return -1;
      return idx + 2; // consume through the \r\n
    }, timeoutMs);
    return block;
  }

  /**
   * Read a complete AMI response/event block terminated by \r\n\r\n.
   */
  async readBlock(timeoutMs: number): Promise<string> {
    const block = await this.readUntil((buf) => {
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return -1;
      return idx + 4; // consume through the \r\n\r\n
    }, timeoutMs);
    return block;
  }

  /**
   * Read raw data until a specific sentinel string is found (used by the
   * Command action which terminates with --END COMMAND--).
   */
  async readUntilSentinel(sentinel: string, timeoutMs: number): Promise<string> {
    const block = await this.readUntil((buf) => {
      const idx = buf.indexOf(sentinel);
      if (idx === -1) return -1;
      // Find the end of the line containing the sentinel
      const endIdx = buf.indexOf('\r\n', idx);
      if (endIdx === -1) return -1;
      return endIdx + 2;
    }, timeoutMs);
    return block;
  }

  /**
   * Read a block that matches a specific ActionID, skipping over any
   * unsolicited events (e.g. FullyBooted after login).
   */
  async readBlockByActionID(actionID: string, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Read timeout waiting for ActionID: ' + actionID);
      const block = await this.readBlock(remaining);
      const parsed = parseAMIBlock(block);
      // Accept blocks that match our ActionID, or blocks without an ActionID
      // (some responses omit it), or Response blocks (which are replies)
      if (parsed['ActionID'] === actionID || parsed['Response'] || !parsed['Event']) {
        return block;
      }
      // Otherwise it's an unsolicited event; skip it and keep reading
    }
  }

  releaseLock(): void {
    this.reader.releaseLock();
  }
}

/**
 * Send an AMI action to the server.
 */
async function sendAMIAction(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  action: string,
  params: Record<string, string> = {},
): Promise<void> {
  const encoder = new TextEncoder();
  let msg = `Action: ${action}\r\n`;
  for (const [key, value] of Object.entries(params)) {
    msg += `${key}: ${value}\r\n`;
  }
  msg += '\r\n';
  await writer.write(encoder.encode(msg));
}

/**
 * Parse an AMI response block into key-value pairs.
 */
function parseAMIBlock(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = block.split('\r\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim();
      result[key] = value;
    }
  }
  return result;
}

/**
 * Parse the AMI banner to extract version.
 * Banner format: "Asterisk Call Manager/X.X.X\r\n"
 */
function parseAMIVersion(banner: string): string | undefined {
  const match = banner.match(/Asterisk Call Manager\/([\d.]+)/);
  return match ? match[1] : undefined;
}

/**
 * Probe an AMI server - connect and read the banner.
 */
export async function handleAMIProbe(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as AMIProbeRequest;
    const { host, port = DEFAULT_PORT, timeout = 10000 } = body;

    if (!host) {
      return new Response(
        JSON.stringify({
          success: false,
          host: '',
          port,
          error: 'Host is required',
        } satisfies AMIProbeResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          error: 'Port must be between 1 and 65535',
        } satisfies AMIProbeResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid host format',
        } satisfies AMIProbeResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const amiReader = new AMIReader(socket.readable.getReader());
      const writer = socket.writable.getWriter();

      // Read the AMI banner (single \r\n-terminated line)
      const bannerRaw = await amiReader.readBanner(timeout);
      const banner = bannerRaw.trim();
      const version = parseAMIVersion(banner);

      // Send Logoff to be polite
      await sendAMIAction(writer, 'Logoff');

      const rtt = Date.now() - start;

      writer.releaseLock();
      amiReader.releaseLock();
      socket.close();

      const isAMI = banner.includes('Asterisk Call Manager');

      return new Response(
        JSON.stringify({
          success: isAMI,
          host,
          port,
          banner,
          version,
          rtt,
          error: isAMI ? undefined : `Not an AMI server: ${banner.substring(0, 100)}`,
        } satisfies AMIProbeResponse),
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
        host: '',
        port: DEFAULT_PORT,
        error: error instanceof Error ? error.message : 'Unknown error',
      } satisfies AMIProbeResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Execute an AMI action - login, run action, logoff.
 */
export async function handleAMICommand(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as AMICommandRequest;
    const {
      host,
      port = DEFAULT_PORT,
      username,
      secret,
      action,
      params = {},
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(
        JSON.stringify({
          success: false,
          host: '',
          port,
          transcript: [],
          error: 'Host is required',
        } satisfies AMICommandResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!username) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          transcript: [],
          error: 'Username is required',
        } satisfies AMICommandResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!secret) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          transcript: [],
          error: 'Secret is required',
        } satisfies AMICommandResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!action) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          transcript: [],
          error: 'Action is required',
        } satisfies AMICommandResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Safety check - only allow read-only actions
    const actionLower = action.toLowerCase();
    if (!SAFE_ACTIONS.has(actionLower)) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          transcript: [],
          error: `Action "${action}" is not allowed. Only read-only actions are permitted.`,
        } satisfies AMICommandResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          transcript: [],
          error: 'Port must be between 1 and 65535',
        } satisfies AMICommandResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!/^[a-zA-Z0-9._:-]+$/.test(host)) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          transcript: [],
          error: 'Invalid host format',
        } satisfies AMICommandResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);
    const transcript: string[] = [];

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const amiReader = new AMIReader(socket.readable.getReader());
      const writer = socket.writable.getWriter();

      // Read banner (single \r\n-terminated line)
      const bannerRaw = await amiReader.readBanner(timeout);
      const banner = bannerRaw.trim();
      transcript.push(`S: ${banner}`);

      if (!banner.includes('Asterisk Call Manager')) {
        writer.releaseLock();
        amiReader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            host,
            port,
            transcript,
            error: `Not an AMI server: ${banner.substring(0, 100)}`,
          } satisfies AMICommandResponse),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Login
      transcript.push(`C: Action: Login`);
      transcript.push(`C: Username: ${username}`);
      transcript.push(`C: Secret: ****`);
      await sendAMIAction(writer, 'Login', {
        Username: username,
        Secret: secret,
        ActionID: 'login-1',
      });

      // Read login response, skipping unsolicited events (e.g. FullyBooted)
      const loginBlock = await amiReader.readBlockByActionID('login-1', timeout);
      const loginResponse = parseAMIBlock(loginBlock);
      transcript.push(`S: Response: ${loginResponse['Response'] || 'Unknown'}`);
      if (loginResponse['Message']) {
        transcript.push(`S: Message: ${loginResponse['Message']}`);
      }

      if (loginResponse['Response'] !== 'Success') {
        // Logoff and close
        await sendAMIAction(writer, 'Logoff');
        writer.releaseLock();
        amiReader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            host,
            port,
            transcript,
            error: `Login failed: ${loginResponse['Message'] || 'Authentication rejected'}`,
          } satisfies AMICommandResponse),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Send the requested action
      const actionParams = { ...params, ActionID: 'action-1' };
      transcript.push(`C: Action: ${action}`);
      for (const [key, value] of Object.entries(actionParams)) {
        transcript.push(`C: ${key}: ${value}`);
      }
      await sendAMIAction(writer, action, actionParams);

      // Read response, skipping unsolicited events
      const responseBlock = await amiReader.readBlockByActionID('action-1', timeout);
      const response = parseAMIBlock(responseBlock);

      for (const [key, value] of Object.entries(response)) {
        transcript.push(`S: ${key}: ${value}`);
      }

      // Some actions return events followed by a "complete" event
      // Try to read additional events
      const events: Record<string, string>[] = [];
      const eventFields = response['EventList'];
      if (eventFields === 'start') {
        // Read events until EventList: Complete
        let maxEvents = 50;
        while (maxEvents-- > 0) {
          try {
            const eventBlock = await amiReader.readBlock(5000);
            const event = parseAMIBlock(eventBlock);
            events.push(event);
            transcript.push(`S: Event: ${event['Event'] || 'data'}`);

            if (event['EventList'] === 'Complete' || event['Event']?.includes('Complete')) {
              break;
            }
          } catch {
            break; // Timeout reading events is OK
          }
        }
      }

      // Logoff
      transcript.push(`C: Action: Logoff`);
      await sendAMIAction(writer, 'Logoff');
      try {
        const logoffBlock = await amiReader.readBlock(3000);
        const logoffResponse = parseAMIBlock(logoffBlock);
        transcript.push(`S: Response: ${logoffResponse['Response'] || 'OK'}`);
      } catch {
        // Server may close immediately
      }

      const rtt = Date.now() - start;

      writer.releaseLock();
      amiReader.releaseLock();
      socket.close();

      const actionSuccess = response['Response'] === 'Success' || response['Response'] === 'Follows';

      return new Response(
        JSON.stringify({
          success: actionSuccess,
          host,
          port,
          action,
          response,
          events: events.length > 0 ? events : undefined,
          transcript,
          rtt,
          error: actionSuccess ? undefined : `Action failed: ${response['Message'] || response['Response']}`,
        } satisfies AMICommandResponse),
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
        host: '',
        port: DEFAULT_PORT,
        transcript: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      } satisfies AMICommandResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}


// ---------------------------------------------------------------------------
// Write actions
// ---------------------------------------------------------------------------

interface AMIOriginateRequest {
  host: string;
  port?: number;
  username: string;
  secret: string;
  channel: string;
  context: string;
  exten: string;
  priority: string | number;
  callerID?: string;
  timeout?: number;
}

interface AMIHangupRequest {
  host: string;
  port?: number;
  username: string;
  secret: string;
  channel: string;
  timeout?: number;
}

interface AMICliCommandRequest {
  host: string;
  port?: number;
  username: string;
  secret: string;
  command: string;
  timeout?: number;
}

interface AMISendTextRequest {
  host: string;
  port?: number;
  username: string;
  secret: string;
  channel: string;
  message: string;
  timeout?: number;
}

/**
 * Helper: Login to AMI, run a callback, then logoff.
 */
async function withAMISession<T>(
  host: string,
  port: number,
  username: string,
  secret: string,
  timeoutMs: number,
  fn: (
    amiReader: AMIReader,
    writer: WritableStreamDefaultWriter<Uint8Array>,
    transcript: string[],
  ) => Promise<T>,
): Promise<T> {
  if (!host) throw new Error('Host is required');
  if (!username) throw new Error('Username is required');
  if (!secret) throw new Error('Secret is required');
  if (port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) throw new Error('Invalid host format');

  const socket = connect(`${host}:${port}`);
  const transcript: string[] = [];

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeoutMs);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const amiReader = new AMIReader(socket.readable.getReader());
  const writer = socket.writable.getWriter();

  try {
    // Read banner (single \r\n-terminated line)
    const bannerRaw = await amiReader.readBanner(timeoutMs);
    const banner = bannerRaw.trim();
    transcript.push(`S: ${banner}`);

    if (!banner.includes('Asterisk Call Manager')) {
      writer.releaseLock();
      amiReader.releaseLock();
      socket.close();
      throw new Error(`Not an AMI server: ${banner.substring(0, 100)}`);
    }

    transcript.push('C: Action: Login');
    transcript.push(`C: Username: ${username}`);
    transcript.push('C: Secret: ****');
    await sendAMIAction(writer, 'Login', {
      Username: username,
      Secret: secret,
      ActionID: 'login-1',
    });

    // Read login response, skipping unsolicited events
    const loginBlock = await amiReader.readBlockByActionID('login-1', timeoutMs);
    const loginResponse = parseAMIBlock(loginBlock);
    transcript.push(`S: Response: ${loginResponse['Response'] || 'Unknown'}`);
    if (loginResponse['Message']) {
      transcript.push(`S: Message: ${loginResponse['Message']}`);
    }

    if (loginResponse['Response'] !== 'Success') {
      await sendAMIAction(writer, 'Logoff');
      writer.releaseLock();
      amiReader.releaseLock();
      socket.close();
      throw new Error(`Login failed: ${loginResponse['Message'] || 'Authentication rejected'}`);
    }

    const result = await fn(amiReader, writer, transcript);

    transcript.push('C: Action: Logoff');
    await sendAMIAction(writer, 'Logoff');
    try {
      const logoffBlock = await amiReader.readBlock(3000);
      const logoffResponse = parseAMIBlock(logoffBlock);
      transcript.push(`S: Response: ${logoffResponse['Response'] || 'OK'}`);
    } catch {
      // Server may close immediately
    }

    writer.releaseLock();
    amiReader.releaseLock();
    socket.close();

    return result;
  } catch (error) {
    try { writer.releaseLock(); } catch { /* already released */ }
    try { amiReader.releaseLock(); } catch { /* already released */ }
    socket.close();
    throw error;
  }
}

/**
 * Originate an outbound call via AMI Action: Originate.
 * POST /api/ami/originate
 */
export async function handleAMIOriginate(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as AMIOriginateRequest;
    const {
      host,
      port = DEFAULT_PORT,
      username,
      secret,
      channel,
      context,
      exten,
      priority,
      callerID,
      timeout = 15000,
    } = body;

    if (!channel) return new Response(JSON.stringify({ success: false, error: 'Channel is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!context) return new Response(JSON.stringify({ success: false, error: 'Context is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!exten) return new Response(JSON.stringify({ success: false, error: 'Exten is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (priority === undefined || priority === null || priority === '') return new Response(JSON.stringify({ success: false, error: 'Priority is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const start = Date.now();
    const { response, transcript } = await withAMISession(
      host, port, username, secret, timeout,
      async (amiReader, writer, transcript) => {
        const params: Record<string, string> = {
          Channel: channel,
          Context: context,
          Exten: exten,
          Priority: String(priority),
          ActionID: 'originate-1',
        };
        if (callerID) params['CallerID'] = callerID;

        transcript.push('C: Action: Originate');
        for (const [k, v] of Object.entries(params)) transcript.push(`C: ${k}: ${v}`);
        await sendAMIAction(writer, 'Originate', params);

        const responseBlock = await amiReader.readBlockByActionID('originate-1', timeout);
        const response = parseAMIBlock(responseBlock);
        for (const [k, v] of Object.entries(response)) transcript.push(`S: ${k}: ${v}`);
        return { response, transcript };
      },
    );

    const rtt = Date.now() - start;
    const success = response['Response'] === 'Success';
    return new Response(JSON.stringify({ success, host, port, action: 'Originate', response, transcript, rtt, error: success ? undefined : `Originate failed: ${response['Message'] || response['Response']}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Hang up a channel via AMI Action: Hangup.
 * POST /api/ami/hangup
 */
export async function handleAMIHangup(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as AMIHangupRequest;
    const { host, port = DEFAULT_PORT, username, secret, channel, timeout = 15000 } = body;

    if (!channel) return new Response(JSON.stringify({ success: false, error: 'Channel is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const start = Date.now();
    const { response, transcript } = await withAMISession(
      host, port, username, secret, timeout,
      async (amiReader, writer, transcript) => {
        const params: Record<string, string> = { Channel: channel, ActionID: 'hangup-1' };
        transcript.push('C: Action: Hangup');
        for (const [k, v] of Object.entries(params)) transcript.push(`C: ${k}: ${v}`);
        await sendAMIAction(writer, 'Hangup', params);

        const responseBlock = await amiReader.readBlockByActionID('hangup-1', timeout);
        const response = parseAMIBlock(responseBlock);
        for (const [k, v] of Object.entries(response)) transcript.push(`S: ${k}: ${v}`);
        return { response, transcript };
      },
    );

    const rtt = Date.now() - start;
    const success = response['Response'] === 'Success';
    return new Response(JSON.stringify({ success, host, port, action: 'Hangup', response, transcript, rtt, error: success ? undefined : `Hangup failed: ${response['Message'] || response['Response']}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Run an Asterisk CLI command via AMI Action: Command.
 * POST /api/ami/clicommand
 */
export async function handleAMICliCommand(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as AMICliCommandRequest;
    const { host, port = DEFAULT_PORT, username, secret, command, timeout = 15000 } = body;

    if (!command) return new Response(JSON.stringify({ success: false, error: 'Command is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const start = Date.now();
    const { response, output, transcript } = await withAMISession(
      host, port, username, secret, timeout,
      async (amiReader, writer, transcript) => {
        const params: Record<string, string> = { Command: command, ActionID: 'cmd-1' };
        transcript.push('C: Action: Command');
        for (const [k, v] of Object.entries(params)) transcript.push(`C: ${k}: ${v}`);
        await sendAMIAction(writer, 'Command', params);

        // The Command action is special: Asterisk responds with
        // "Response: Follows" followed by raw output lines, terminated by
        // "--END COMMAND--\r\n". On error, a normal Response: Error block
        // is returned instead. We first try reading until the sentinel;
        // if we get an error response block first, we stop there.
        let buffer: string;
        try {
          buffer = await amiReader.readUntilSentinel('--END COMMAND--', timeout);
        } catch {
          // If sentinel wasn't found, fall back to reading a normal block
          buffer = await amiReader.readBlock(timeout);
        }

        const response = parseAMIBlock(buffer);
        for (const [k, v] of Object.entries(response)) transcript.push(`S: ${k}: ${v}`);

        // Extract output lines. Asterisk 13+ uses "Output: " prefix.
        // Older versions send raw text between the header and --END COMMAND--.
        const output: string[] = [];
        const lines = buffer.split('\r\n');
        let pastHeader = false;
        for (const line of lines) {
          if (line.startsWith('Output: ')) {
            output.push(line.substring('Output: '.length));
          } else if (pastHeader && line !== '' && !line.startsWith('--END COMMAND--')) {
            // Raw output from older Asterisk versions (no "Output: " prefix)
            if (!line.includes(': ') || line.startsWith(' ')) {
              output.push(line);
            }
          }
          // The header ends after the blank line following the Response line
          if (line === '' && response['Response']) pastHeader = true;
        }
        return { response, output, transcript };
      },
    );

    const rtt = Date.now() - start;
    const success = response['Response'] === 'Follows' || response['Response'] === 'Success';
    return new Response(JSON.stringify({ success, host, port, action: 'Command', command, response, output, transcript, rtt, error: success ? undefined : `Command failed: ${response['Message'] || response['Response']}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Send a text message to a channel via AMI Action: SendText.
 * POST /api/ami/sendtext
 */
export async function handleAMISendText(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as AMISendTextRequest;
    const { host, port = DEFAULT_PORT, username, secret, channel, message, timeout = 15000 } = body;

    if (!channel) return new Response(JSON.stringify({ success: false, error: 'Channel is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!message) return new Response(JSON.stringify({ success: false, error: 'Message is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const start = Date.now();
    const { response, transcript } = await withAMISession(
      host, port, username, secret, timeout,
      async (amiReader, writer, transcript) => {
        const params: Record<string, string> = { Channel: channel, Message: message, ActionID: 'sendtext-1' };
        transcript.push('C: Action: SendText');
        for (const [k, v] of Object.entries(params)) transcript.push(`C: ${k}: ${v}`);
        await sendAMIAction(writer, 'SendText', params);

        const responseBlock = await amiReader.readBlockByActionID('sendtext-1', timeout);
        const response = parseAMIBlock(responseBlock);
        for (const [k, v] of Object.entries(response)) transcript.push(`S: ${k}: ${v}`);
        return { response, transcript };
      },
    );

    const rtt = Date.now() - start;
    const success = response['Response'] === 'Success';
    return new Response(JSON.stringify({ success, host, port, action: 'SendText', response, transcript, rtt, error: success ? undefined : `SendText failed: ${response['Message'] || response['Response']}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
