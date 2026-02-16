/**
 * Sonic Search Backend Protocol Implementation
 *
 * Sonic is a lightweight, fast search backend that runs over TCP
 * on port 1491 with a simple text-based protocol.
 *
 * Protocol Flow:
 * 1. Client connects to port 1491
 * 2. Server sends: "CONNECTED <instance_id>\r\n"
 * 3. Client sends: "START <mode> [<password>]\r\n"
 *    - Modes: search, ingest, control
 * 4. Server sends: "STARTED <mode> protocol(<version>) buffer(<size>)\r\n"
 * 5. Commands vary by mode:
 *    - All modes: PING → PONG, QUIT → ENDED quit
 *    - Control mode: INFO → multi-line key(value) stats
 *    - Search mode: QUERY <collection> <bucket> "<query>" → PENDING/EVENT
 *    - Ingest mode: PUSH <collection> <bucket> <key> "<text>"
 *
 * Error Responses:
 *   ERR <message>
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface SonicRequest {
  host: string;
  port?: number;
  timeout?: number;
  password?: string;
}

interface SonicProbeResponse {
  success: boolean;
  host: string;
  port: number;
  rtt: number;
  instanceId?: string;
  protocol?: number;
  bufferSize?: number;
  modes?: {
    search: boolean;
    ingest: boolean;
    control: boolean;
  };
  stats?: Record<string, string>;
  error?: string;
}

/**
 * Read a line (terminated by \r\n or \n) from the socket
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

    // Check for \n terminator
    if (value.includes(0x0A)) break;
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Strip trailing \r\n or \n
  let end = combined.length;
  while (end > 0 && (combined[end - 1] === 0x0D || combined[end - 1] === 0x0A)) {
    end--;
  }

  return new TextDecoder().decode(combined.slice(0, end));
}

/**
 * Send a command and read the response line
 */
async function sendCommand(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  command: string,
): Promise<string> {
  const data = new TextEncoder().encode(command + '\r\n');
  await writer.write(data);
  return readLine(reader, timeoutPromise);
}

/**
 * Try to start a Sonic session in the given mode
 * Returns the STARTED response or null if failed
 */
async function tryStartMode(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  mode: string,
  password?: string,
): Promise<{ protocol: number; bufferSize: number } | null> {
  const cmd = password ? `START ${mode} ${password}` : `START ${mode}`;
  const response = await sendCommand(writer, reader, timeoutPromise, cmd);

  // Parse: "STARTED <mode> protocol(<version>) buffer(<size>)"
  const match = response.match(/^STARTED\s+\w+\s+protocol\((\d+)\)\s+buffer\((\d+)\)/);
  if (match) {
    return {
      protocol: parseInt(match[1], 10),
      bufferSize: parseInt(match[2], 10),
    };
  }

  return null;
}

/**
 * Parse Sonic INFO response lines into key-value pairs
 * Format: "key(value) key(value) ..."
 */
function parseInfoLine(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /(\w[\w.]+)\(([^)]*)\)/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
}

/**
 * Probe a Sonic search backend instance
 * POST /api/sonic/probe
 */
export async function handleSonicProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SonicRequest;
    const { host, port = 1491, timeout = 10000, password } = body;

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
        // Step 1: Read the CONNECTED banner
        const banner = await readLine(reader, timeoutPromise);

        if (!banner.startsWith('CONNECTED')) {
          throw new Error(`Unexpected banner: ${banner.substring(0, 100)}`);
        }

        // Parse instance ID from "CONNECTED <instance_id>"
        const instanceId = banner.substring(10).trim() || undefined;

        // Step 2: Try to start in control mode (most info)
        const controlResult = await tryStartMode(writer, reader, timeoutPromise, 'control', password);

        let protocol: number | undefined;
        let bufferSize: number | undefined;
        let stats: Record<string, string> | undefined;

        if (controlResult) {
          protocol = controlResult.protocol;
          bufferSize = controlResult.bufferSize;

          // Step 3: Get server info via INFO command
          const infoResponse = await sendCommand(writer, reader, timeoutPromise, 'INFO');
          if (infoResponse.startsWith('RESULT')) {
            stats = parseInfoLine(infoResponse);
          }

          // Step 4: Verify with PING
          const pingResponse = await sendCommand(writer, reader, timeoutPromise, 'PING');
          if (pingResponse !== 'PONG') {
            // Not critical, just note it
          }

          // Step 5: Clean quit
          await sendCommand(writer, reader, timeoutPromise, 'QUIT');
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const result: SonicProbeResponse = {
          success: true,
          host,
          port,
          rtt: Date.now() - startTime,
          instanceId,
          protocol,
          bufferSize,
          stats,
        };

        return result;

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
 * Send a PING to a Sonic instance
 * POST /api/sonic/ping
 */
export async function handleSonicPing(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SonicRequest;
    const { host, port = 1491, timeout = 10000, password } = body;

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
        // Read CONNECTED banner
        const banner = await readLine(reader, timeoutPromise);
        if (!banner.startsWith('CONNECTED')) {
          throw new Error(`Not a Sonic server: ${banner.substring(0, 100)}`);
        }

        // Start in search mode (lightest)
        const startResult = await tryStartMode(writer, reader, timeoutPromise, 'search', password);
        if (!startResult) {
          throw new Error('Failed to start Sonic session');
        }

        // Send PING
        const pingResponse = await sendCommand(writer, reader, timeoutPromise, 'PING');
        const alive = pingResponse === 'PONG';

        // Clean quit
        await sendCommand(writer, reader, timeoutPromise, 'QUIT');

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          rtt: Date.now() - startTime,
          alive,
          response: pingResponse,
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
