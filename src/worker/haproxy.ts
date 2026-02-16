/**
 * HAProxy Runtime API Implementation
 *
 * HAProxy is the world's most popular open-source load balancer and
 * reverse proxy. Its Runtime API (also called the Stats Socket or
 * Management Socket) provides a text-based command interface for
 * real-time monitoring and configuration changes.
 *
 * Protocol:
 * - Text-based command/response over TCP
 * - Send a command followed by newline
 * - Read response until connection closes or empty line
 * - Some configurations use a prompt ("> ") between commands
 *
 * Key Commands:
 * - show info:           Global process info (version, uptime, connections)
 * - show stat:           CSV statistics for all frontends/backends/servers
 * - show servers state:  Backend server states (weight, status, addr)
 * - show backend:        List of backends
 * - show frontend:       (HAProxy 2.4+) List of frontends
 * - show pools:          Memory pool statistics
 * - show sess:           Current sessions
 *
 * Typical Ports:
 * - Unix socket: /var/run/haproxy/admin.sock (most common)
 * - TCP socket:  9999 or custom (when exposed via "stats socket" with "bind")
 *
 * Security Notes:
 * - The Runtime API allows configuration changes (enable/disable servers, etc.)
 * - Our implementation only uses read-only "show" commands
 * - Production deployments should restrict access via ACLs
 *
 * Use Cases:
 * - Monitor HAProxy load balancer health and version
 * - Check backend server states and weights
 * - View connection statistics and session counts
 * - Verify HAProxy configuration and capabilities
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface HAProxyRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface HAProxyCommandRequest extends HAProxyRequest {
  command: string;
}

/**
 * Read all available data from a reader until connection closes or timeout.
 */
async function readAll(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxBytes: number = 1048576,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < maxBytes) {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
  } catch {
    // Timeout or connection closed — return what we have
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}

/**
 * Send a command to the HAProxy Runtime API and return the response.
 */
async function sendCommand(
  host: string,
  port: number,
  timeout: number,
  command: string,
): Promise<{ response: string; rtt: number }> {
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

    // Send command (HAProxy expects command + newline)
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(command.trim() + '\n'));

    // Read response
    const response = await readAll(reader, timeoutPromise);
    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return { response, rtt };
  } catch (error) {
    socket.close();
    throw error;
  }
}

/**
 * Parse HAProxy "show info" output into key-value pairs.
 */
function parseInfo(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '>' || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.substring(0, colonIdx).trim();
      const value = trimmed.substring(colonIdx + 1).trim();
      result[key] = value;
    }
  }
  return result;
}

/**
 * Handle HAProxy info — send "show info" and parse the response.
 */
export async function handleHAProxyInfo(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as HAProxyRequest;
    const { host, port = 9999, timeout = 10000 } = body;

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

    const { response, rtt } = await sendCommand(host, port, timeout, 'show info');

    if (!response.trim()) {
      return new Response(JSON.stringify({
        success: false, host, port,
        error: 'Empty response — HAProxy Runtime API may not be accessible',
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const info = parseInfo(response);

    return new Response(JSON.stringify({
      success: true, host, port,
      info,
      raw: response.substring(0, 4096),
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
 * Handle HAProxy stat — send "show stat" and return CSV statistics.
 */
export async function handleHAProxyStat(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as HAProxyRequest;
    const { host, port = 9999, timeout = 10000 } = body;

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

    const { response, rtt } = await sendCommand(host, port, timeout, 'show stat');

    if (!response.trim()) {
      return new Response(JSON.stringify({
        success: false, host, port,
        error: 'Empty response — HAProxy Runtime API may not be accessible',
        rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Parse CSV stats
    const lines = response.trim().split('\n').filter(l => l.trim() && !l.startsWith('>'));
    const headers = lines[0]?.replace(/^# /, '').split(',') || [];
    const rows = lines.slice(1).map(line => {
      const values = line.split(',');
      const row: Record<string, string> = {};
      for (let i = 0; i < headers.length && i < values.length; i++) {
        row[headers[i]] = values[i];
      }
      return row;
    });

    return new Response(JSON.stringify({
      success: true, host, port,
      headers,
      stats: rows,
      count: rows.length,
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
 * Handle custom HAProxy command.
 */
export async function handleHAProxyCommand(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as HAProxyCommandRequest;
    const { host, port = 9999, timeout = 10000, command } = body;

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

    // Safety: only allow read-only commands
    const cmd = command.trim().toLowerCase();
    const readOnlyPrefixes = ['show ', 'help', 'prompt', 'quit'];
    const isReadOnly = readOnlyPrefixes.some(p => cmd.startsWith(p));
    if (!isReadOnly) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Only read-only commands (show, help) are allowed for safety',
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const { response, rtt } = await sendCommand(host, port, timeout, command);

    return new Response(JSON.stringify({
      success: true, host, port,
      command: command.trim(),
      response: response.substring(0, 65536),
      rtt,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
