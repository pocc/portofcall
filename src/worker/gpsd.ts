/**
 * GPSD — GPS Service Daemon Protocol Implementation
 *
 * gpsd is a service daemon that monitors GPS receivers and other
 * location sensors. It provides a JSON-based text protocol over
 * TCP port 2947 for querying GPS device data.
 *
 * Protocol:
 * - Text-based JSON over TCP (default port 2947)
 * - Client sends commands prefixed with '?' terminated by ';' or newline
 * - Server responds with newline-delimited JSON objects
 * - Each JSON object has a "class" field identifying the message type
 *
 * Key Commands:
 * - ?VERSION;         Get gpsd version and supported protocol version
 * - ?DEVICES;         List connected GPS devices
 * - ?POLL;            Poll for latest GPS fix data
 * - ?WATCH={"enable":true,"json":true};  Start streaming JSON reports
 *
 * Response Classes:
 * - VERSION:  gpsd version info (release, rev, proto_major, proto_minor)
 * - DEVICES:  List of active GPS devices
 * - DEVICE:   Individual device info (path, driver, activated, flags)
 * - TPV:      Time-Position-Velocity fix (lat, lon, alt, speed, track, time)
 * - SKY:      Satellite sky view (satellites array with PRN, az, el, ss, used)
 * - POLL:     Aggregated latest fix data
 * - ERROR:    Error message
 *
 * Typical Deployments:
 * - Linux systems with USB GPS receivers (u-blox, SiRF, MTK chipsets)
 * - Raspberry Pi with GPS HATs
 * - NTP servers using GPS for precision time (PPS)
 * - Fleet tracking and vehicle telematics
 * - Maritime AIS combined with GPS
 *
 * Use Cases:
 * - Verify gpsd is running and check version
 * - List connected GPS devices and their drivers
 * - Get current GPS fix (position, speed, heading)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface GPSDRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface GPSDCommandRequest extends GPSDRequest {
  command: string;
}

/**
 * Read response lines from gpsd until we get the expected class or timeout.
 * gpsd sends a VERSION banner on connect, then responds to commands.
 */
async function readLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxBytes: number = 65536,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < maxBytes) {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
      if (done || !value) break;
      chunks.push(value);
      total += value.length;

      // Check if we have complete JSON lines (gpsd sends newline-delimited JSON)
      const current = new TextDecoder().decode(
        concatChunks(chunks, total),
      );
      const lines = current.split('\n').filter(l => l.trim());
      // If we have at least one complete line and the buffer ends with newline, we likely have full response
      if (lines.length >= 1 && current.endsWith('\n')) {
        // Give a tiny window for more data (gpsd may send multiple lines)
        try {
          const extraTimeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('extra read timeout')), 500);
          });
          const { value: extra, done: extraDone } = await Promise.race([reader.read(), extraTimeout]);
          if (!extraDone && extra) {
            chunks.push(extra);
            total += extra.length;
          }
        } catch {
          // No more data, that's fine
        }
        break;
      }
    }
  } catch {
    // Timeout or connection closed — return what we have
  }

  return new TextDecoder().decode(concatChunks(chunks, total));
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Connect to gpsd, optionally send a command, and collect the response.
 * gpsd automatically sends a VERSION line upon connection.
 */
async function sendCommand(
  host: string,
  port: number,
  timeout: number,
  command?: string,
): Promise<{ lines: string[]; rtt: number }> {
  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    throw new Error(getCloudflareErrorMessage(host, cfCheck.ip));
  }

  const startTime = Date.now();
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  try {
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // gpsd sends VERSION banner immediately on connect
    // Read the initial banner
    const banner = await readLines(reader, timeoutPromise);
    const allLines: string[] = [];

    for (const line of banner.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) allLines.push(trimmed);
    }

    // If we have a command to send, send it and read more
    if (command) {
      const encoder = new TextEncoder();
      const cmd = command.trim().endsWith(';') ? command.trim() : command.trim() + ';';
      await writer.write(encoder.encode(cmd + '\n'));

      // Read command response
      const response = await readLines(reader, timeoutPromise);
      for (const line of response.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) allLines.push(trimmed);
      }
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return { lines: allLines, rtt };
  } catch (error) {
    socket.close();
    throw error;
  }
}

/**
 * Parse JSON lines from gpsd and group by class.
 */
function parseLines(lines: string[]): { objects: Record<string, unknown>[]; errors: string[] } {
  const objects: Record<string, unknown>[] = [];
  const errors: string[] = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (typeof obj === 'object' && obj !== null) {
        objects.push(obj as Record<string, unknown>);
      }
    } catch {
      errors.push(line);
    }
  }

  return { objects, errors };
}

/**
 * Handle GPSD version probe — connect and read the VERSION banner.
 */
export async function handleGPSDVersion(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as GPSDRequest;
    const { host, port = 2947, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Just connect — gpsd sends VERSION banner automatically
    const { lines, rtt } = await sendCommand(host, port, timeout);
    const { objects, errors } = parseLines(lines);

    const version = objects.find(o => o.class === 'VERSION');

    if (version) {
      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        version: {
          release: version.release,
          rev: version.rev,
          proto_major: version.proto_major,
          proto_minor: version.proto_minor,
        },
        raw: lines,
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: errors.length > 0
          ? `Unexpected response: ${errors[0]}`
          : 'No VERSION banner received — may not be a gpsd server',
        raw: lines,
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle GPSD devices query — send ?DEVICES; to list connected GPS receivers.
 */
export async function handleGPSDDevices(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as GPSDRequest;
    const { host, port = 2947, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { lines, rtt } = await sendCommand(host, port, timeout, '?DEVICES');
    const { objects } = parseLines(lines);

    const version = objects.find(o => o.class === 'VERSION');
    const devices = objects.find(o => o.class === 'DEVICES');

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      version: version ? {
        release: version.release,
        proto_major: version.proto_major,
        proto_minor: version.proto_minor,
      } : null,
      devices: devices && Array.isArray((devices as Record<string, unknown>).devices)
        ? (devices as Record<string, unknown>).devices
        : [],
      raw: lines,
      rtt,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle GPSD poll — send ?POLL; to get the latest GPS fix.
 */
export async function handleGPSDPoll(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as GPSDRequest;
    const { host, port = 2947, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // First enable WATCH to ensure data flows, then POLL
    const { lines, rtt } = await sendCommand(host, port, timeout, '?POLL');
    const { objects } = parseLines(lines);

    const version = objects.find(o => o.class === 'VERSION');
    const poll = objects.find(o => o.class === 'POLL');
    const tpv = objects.find(o => o.class === 'TPV');
    const sky = objects.find(o => o.class === 'SKY');

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      version: version ? {
        release: version.release,
        proto_major: version.proto_major,
        proto_minor: version.proto_minor,
      } : null,
      poll: poll || null,
      tpv: tpv || null,
      sky: sky || null,
      raw: lines,
      rtt,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle custom GPSD command — send arbitrary ?COMMAND; query.
 */
export async function handleGPSDCommand(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as GPSDCommandRequest;
    const { host, port = 2947, timeout = 10000, command } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!command) {
      return new Response(JSON.stringify({ success: false, error: 'Command is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Safety: only allow read-only query commands (prefixed with ?)
    const cmd = command.trim();
    if (!cmd.startsWith('?')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Commands must start with "?" (gpsd query format)',
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const { lines, rtt } = await sendCommand(host, port, timeout, cmd);
    const { objects, errors } = parseLines(lines);

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      command: cmd,
      objects,
      errors: errors.length > 0 ? errors : undefined,
      raw: lines,
      rtt,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
