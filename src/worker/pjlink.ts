/**
 * PJLink Protocol Implementation
 *
 * PJLink is a unified standard for projector/display control defined by
 * JBMiA (Japan Business Machine and Information System Industries Association).
 * Default port is 4352. Text-based, line-oriented protocol over TCP.
 *
 * Protocol Flow:
 * 1. Client connects to port 4352
 * 2. Server sends greeting: "PJLINK 0\r" (no auth) or "PJLINK 1 <random>\r" (MD5 auth)
 * 3. Client sends command: "%1<CMD> <param>\r" (Class 1) or "%2<CMD> <param>\r" (Class 2)
 * 4. Server responds: "%1<CMD>=<result>\r"
 *
 * Commands (Class 1):
 *   POWR - Power control/query (0=off, 1=on, 2=cooling, 3=warmup)
 *   INPT - Input switch/query
 *   AVMT - AV mute control/query
 *   ERST - Error status query (6 chars: fan/lamp/temp/cover/filter/other)
 *   LAMP - Lamp hours query
 *   INST - Input list query
 *   NAME - Projector name query
 *   INF1 - Manufacturer name query
 *   INF2 - Product name query
 *   INFO - Other information query
 *   CLSS - Class information query
 *
 * Error Responses:
 *   ERR1 - Undefined command
 *   ERR2 - Out of parameter
 *   ERR3 - Unavailable time
 *   ERR4 - Projector/display failure
 *   ERRA - Authorization error
 *
 * Use Cases:
 * - AV system projector discovery and identification
 * - Digital signage display management
 * - Conference room projector status monitoring
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface PJLinkRequest {
  host: string;
  port?: number;
  timeout?: number;
  password?: string;
}

interface ProjectorInfo {
  name?: string;
  manufacturer?: string;
  productName?: string;
  otherInfo?: string;
  class?: string;
  powerStatus?: string;
  lampHours?: { hours: number; on: boolean }[];
  errorStatus?: {
    fan: string;
    lamp: string;
    temperature: string;
    coverOpen: string;
    filter: string;
    other: string;
  };
  inputs?: string[];
  currentInput?: string;
  avMute?: string;
}

interface PJLinkResponse {
  success: boolean;
  host: string;
  port: number;
  rtt: number;
  authRequired: boolean;
  authenticated: boolean;
  projectorInfo?: ProjectorInfo;
  error?: string;
}

const POWER_STATES: Record<string, string> = {
  '0': 'Standby',
  '1': 'Power On',
  '2': 'Cooling Down',
  '3': 'Warming Up',
};

const ERROR_LEVELS: Record<string, string> = {
  '0': 'OK',
  '1': 'Warning',
  '2': 'Error',
};

const AVMUTE_STATES: Record<string, string> = {
  '11': 'Video mute on',
  '21': 'Audio mute on',
  '31': 'Video & audio mute on',
  '10': 'Video mute off',
  '20': 'Audio mute off',
  '30': 'Video & audio mute off',
};

/**
 * Read a line (terminated by \r) from the socket
 */
async function readLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxBytes: number = 4096,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < maxBytes) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) break;
    chunks.push(value);
    total += value.length;

    // Check for \r terminator
    if (value.includes(0x0D)) break;
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Strip trailing \r or \r\n
  let end = combined.length;
  while (end > 0 && (combined[end - 1] === 0x0D || combined[end - 1] === 0x0A)) {
    end--;
  }

  return new TextDecoder().decode(combined.slice(0, end));
}

/**
 * Send a PJLink command and read the response
 */
async function sendCommand(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  command: string,
): Promise<string> {
  const data = new TextEncoder().encode(command + '\r');
  await writer.write(data);
  return readLine(reader, timeoutPromise);
}

/**
 * Compute MD5 hash for PJLink authentication
 * PJLink auth: MD5(random + password)
 */
async function computeMD5(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('MD5', new Uint8Array(data));
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parse a PJLink response line
 * Format: "%1<CMD>=<value>" or "%1<CMD>=ERR<n>"
 */
function parseResponse(line: string): { command: string; value: string; error?: string } | null {
  // Match: %<class><CMD>=<value>
  const match = line.match(/^%(\d)(\w{4})=(.+)$/);
  if (!match) return null;

  const command = match[2];
  const value = match[3];

  if (value.startsWith('ERR')) {
    return { command, value, error: value };
  }

  return { command, value };
}

/**
 * Parse error status string (6 characters, one per category)
 */
function parseErrorStatus(value: string): ProjectorInfo['errorStatus'] {
  if (value.length < 6) return undefined;
  return {
    fan: ERROR_LEVELS[value[0]] || `Unknown (${value[0]})`,
    lamp: ERROR_LEVELS[value[1]] || `Unknown (${value[1]})`,
    temperature: ERROR_LEVELS[value[2]] || `Unknown (${value[2]})`,
    coverOpen: ERROR_LEVELS[value[3]] || `Unknown (${value[3]})`,
    filter: ERROR_LEVELS[value[4]] || `Unknown (${value[4]})`,
    other: ERROR_LEVELS[value[5]] || `Unknown (${value[5]})`,
  };
}

/**
 * Parse lamp hours response
 * Format: "<hours1> <on1> <hours2> <on2> ..."
 */
function parseLampHours(value: string): { hours: number; on: boolean }[] {
  const parts = value.split(' ');
  const lamps: { hours: number; on: boolean }[] = [];
  for (let i = 0; i < parts.length - 1; i += 2) {
    lamps.push({
      hours: parseInt(parts[i], 10),
      on: parts[i + 1] === '1',
    });
  }
  return lamps;
}

/**
 * Probe a PJLink projector/display — reads all identification and status info
 * POST /api/pjlink/probe
 */
export async function handlePJLinkProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as PJLinkRequest;
    const { host, port = 4352, timeout = 10000, password = '' } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      );

      try {
        // Step 1: Read greeting
        const greeting = await readLine(reader, timeoutPromise);

        let authRequired = false;
        let authenticated = false;
        let authPrefix = '';

        if (greeting.startsWith('PJLINK 1')) {
          // Authentication required
          authRequired = true;
          const random = greeting.substring(9).trim(); // random string after "PJLINK 1 "

          if (password) {
            const hash = await computeMD5(random + password);
            authPrefix = hash;
            authenticated = true; // We'll know for sure after first command
          } else {
            writer.releaseLock();
            reader.releaseLock();
            socket.close();

            return {
              success: true,
              host,
              port,
              rtt: Date.now() - startTime,
              authRequired: true,
              authenticated: false,
              error: 'Authentication required but no password provided',
            } as PJLinkResponse;
          }
        } else if (greeting.startsWith('PJLINK 0')) {
          authRequired = false;
          authenticated = true;
        } else {
          throw new Error(`Unexpected greeting: ${greeting.substring(0, 100)}`);
        }

        const projectorInfo: ProjectorInfo = {};

        // Helper to send command with optional auth prefix
        const query = async (cmd: string): Promise<string | null> => {
          const fullCmd = authPrefix ? `${authPrefix}%1${cmd} ?\r` : `%1${cmd} ?`;
          const response = await sendCommand(writer, reader, timeoutPromise, fullCmd.replace(/\r$/, ''));

          if (response.includes('ERRA')) {
            authenticated = false;
            return null;
          }

          const parsed = parseResponse(response);
          if (!parsed || parsed.error) return null;
          return parsed.value;
        };

        // Step 2: Query all info commands
        // NAME - Projector name
        const name = await query('NAME');
        if (name) projectorInfo.name = name;

        // INF1 - Manufacturer
        const inf1 = await query('INF1');
        if (inf1) projectorInfo.manufacturer = inf1;

        // INF2 - Product name
        const inf2 = await query('INF2');
        if (inf2) projectorInfo.productName = inf2;

        // INFO - Other info
        const info = await query('INFO');
        if (info) projectorInfo.otherInfo = info;

        // CLSS - Class
        const clss = await query('CLSS');
        if (clss) projectorInfo.class = clss;

        // POWR - Power status
        const powr = await query('POWR');
        if (powr) projectorInfo.powerStatus = POWER_STATES[powr] || `Unknown (${powr})`;

        // ERST - Error status
        const erst = await query('ERST');
        if (erst) projectorInfo.errorStatus = parseErrorStatus(erst);

        // LAMP - Lamp hours
        const lamp = await query('LAMP');
        if (lamp) projectorInfo.lampHours = parseLampHours(lamp);

        // INST - Input list
        const inst = await query('INST');
        if (inst) projectorInfo.inputs = inst.split(' ');

        // INPT - Current input
        const inpt = await query('INPT');
        if (inpt) projectorInfo.currentInput = inpt;

        // AVMT - AV mute
        const avmt = await query('AVMT');
        if (avmt) projectorInfo.avMute = AVMUTE_STATES[avmt] || `Unknown (${avmt})`;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          rtt: Date.now() - startTime,
          authRequired,
          authenticated,
          projectorInfo,
        } as PJLinkResponse;

      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const globalTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, globalTimeout]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Send a power command to a PJLink device
 * POST /api/pjlink/power
 */
export async function handlePJLinkPower(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json() as PJLinkRequest & { action: 'on' | 'off' | 'query' };
    const { host, port = 4352, timeout = 10000, password = '', action = 'query' } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      );

      try {
        const greeting = await readLine(reader, timeoutPromise);
        let authPrefix = '';

        if (greeting.startsWith('PJLINK 1')) {
          const random = greeting.substring(9).trim();
          if (password) {
            authPrefix = await computeMD5(random + password);
          } else {
            throw new Error('Authentication required but no password provided');
          }
        }

        const param = action === 'on' ? '1' : action === 'off' ? '0' : '?';
        const cmd = authPrefix ? `${authPrefix}%1POWR ${param}` : `%1POWR ${param}`;
        const response = await sendCommand(writer, reader, timeoutPromise, cmd);

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const parsed = parseResponse(response);
        if (!parsed) {
          throw new Error(`Invalid response: ${response.substring(0, 100)}`);
        }

        if (parsed.error) {
          return {
            success: false,
            host,
            port,
            rtt: Date.now() - startTime,
            error: `PJLink error: ${parsed.error}`,
          };
        }

        return {
          success: true,
          host,
          port,
          rtt: Date.now() - startTime,
          action,
          powerStatus: POWER_STATES[parsed.value] || parsed.value,
        };

      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const globalTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, globalTimeout]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
