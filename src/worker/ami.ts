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
  'loggerrotate',
]);

/**
 * Read a complete AMI response block (terminated by \r\n\r\n).
 */
async function readAMIBlock(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Read timeout');

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Read timeout')), remaining);
    });

    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);

    if (done) {
      if (buffer.length > 0) return buffer;
      throw new Error('Connection closed by server');
    }

    if (value) {
      buffer += decoder.decode(value, { stream: true });

      // AMI blocks are terminated by \r\n\r\n
      if (buffer.includes('\r\n\r\n')) {
        return buffer;
      }
    }
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

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      // Read the AMI banner
      const bannerBlock = await readAMIBlock(reader, timeout);
      const banner = bannerBlock.trim();
      const version = parseAMIVersion(banner);

      // Send Logoff to be polite
      await sendAMIAction(writer, 'Logoff');

      const rtt = Date.now() - start;

      writer.releaseLock();
      reader.releaseLock();
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

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      // Read banner
      const bannerBlock = await readAMIBlock(reader, timeout);
      const banner = bannerBlock.trim();
      transcript.push(`S: ${banner}`);

      if (!banner.includes('Asterisk Call Manager')) {
        writer.releaseLock();
        reader.releaseLock();
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

      const loginBlock = await readAMIBlock(reader, timeout);
      const loginResponse = parseAMIBlock(loginBlock);
      transcript.push(`S: Response: ${loginResponse['Response'] || 'Unknown'}`);
      if (loginResponse['Message']) {
        transcript.push(`S: Message: ${loginResponse['Message']}`);
      }

      if (loginResponse['Response'] !== 'Success') {
        // Logoff and close
        await sendAMIAction(writer, 'Logoff');
        writer.releaseLock();
        reader.releaseLock();
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

      // Read response (may include multiple event blocks)
      const responseBlock = await readAMIBlock(reader, timeout);
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
            const eventBlock = await readAMIBlock(reader, 5000);
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
        const logoffBlock = await readAMIBlock(reader, 3000);
        const logoffResponse = parseAMIBlock(logoffBlock);
        transcript.push(`S: Response: ${logoffResponse['Response'] || 'OK'}`);
      } catch {
        // Server may close immediately
      }

      const rtt = Date.now() - start;

      writer.releaseLock();
      reader.releaseLock();
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
