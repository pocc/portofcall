/**
 * Apache ZooKeeper Protocol Implementation
 *
 * Implements ZooKeeper connectivity testing using "Four-Letter Words" (4LW)
 * commands - simple text commands for health checking and monitoring.
 *
 * Protocol Flow:
 * 1. Client connects to server port 2181
 * 2. Client sends a 4-letter command (ruok, srvr, stat, etc.)
 * 3. Server responds with text output
 * 4. Server closes connection
 *
 * Four-Letter Word Commands:
 * - ruok: Are you OK? Server responds "imok" if healthy
 * - srvr: Server details (version, mode, connections)
 * - stat: Server statistics and connected clients
 * - conf: Server configuration
 * - envi: Server environment
 * - mntr: Monitoring data in key=value format
 *
 * Use Cases:
 * - ZooKeeper health checking
 * - Server version detection
 * - Cluster status monitoring
 * - Connection count tracking
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Valid four-letter word commands
const VALID_COMMANDS = ['ruok', 'srvr', 'stat', 'conf', 'envi', 'mntr', 'cons', 'dump', 'wchs', 'dirs', 'isro'];

/**
 * Send a four-letter word command to a ZooKeeper server
 */
async function sendFourLetterWord(
  host: string,
  port: number,
  command: string,
  timeout: number,
): Promise<string> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  try {
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Send the four-letter command
    await writer.write(new TextEncoder().encode(command));

    // Read the response (server sends text then closes connection)
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const maxResponseSize = 64 * 1024; // 64KB max

    try {
      while (totalBytes < maxResponseSize) {
        const { value, done } = await Promise.race([
          reader.read(),
          timeoutPromise,
        ]);

        if (done || !value) break;

        chunks.push(value);
        totalBytes += value.length;
      }
    } catch {
      // Connection closed by server (expected)
      if (chunks.length === 0) {
        throw new Error('Server closed connection without responding');
      }
    }

    // Combine chunks
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new TextDecoder().decode(combined).trim();
  } catch (error) {
    socket.close();
    throw error;
  }
}

/**
 * Parse srvr command output into structured data
 */
function parseSrvrOutput(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = output.split('\n');

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
 * Parse mntr command output into structured key=value pairs
 */
function parseMntrOutput(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = output.split('\n');

  for (const line of lines) {
    const tabIdx = line.indexOf('\t');
    if (tabIdx > 0) {
      const key = line.substring(0, tabIdx).trim();
      const value = line.substring(tabIdx + 1).trim();
      result[key] = value;
    }
  }

  return result;
}

/**
 * Handle ZooKeeper connection test using 'ruok' command
 */
export async function handleZooKeeperConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 2181, timeout = 10000 } = body;

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

    // Send 'ruok' to check health
    const ruokResponse = await sendFourLetterWord(host, port, 'ruok', timeout);
    const healthy = ruokResponse === 'imok';

    // Also send 'srvr' to get server details
    let serverInfo: Record<string, string> = {};
    try {
      const srvrResponse = await sendFourLetterWord(host, port, 'srvr', timeout);
      serverInfo = parseSrvrOutput(srvrResponse);
    } catch {
      // srvr might be disabled - that's OK
    }

    const rtt = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      healthy,
      ruokResponse,
      serverInfo: {
        version: serverInfo['Zookeeper version'] || undefined,
        mode: serverInfo['Mode'] || undefined,
        connections: serverInfo['Connections'] || undefined,
        outstanding: serverInfo['Outstanding'] || undefined,
        nodeCount: serverInfo['Node count'] || undefined,
        latencyMin: serverInfo['Latency min/avg/max'] || undefined,
        received: serverInfo['Received'] || undefined,
        sent: serverInfo['Sent'] || undefined,
      },
    }), {
      status: 200,
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
 * Handle ZooKeeper four-letter word command
 * Sends any valid 4LW command and returns the raw response
 */
export async function handleZooKeeperCommand(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      command: string;
      timeout?: number;
    };

    const { host, port = 2181, command, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!command) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Command is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!VALID_COMMANDS.includes(command)) {
      return new Response(JSON.stringify({
        success: false,
        error: `Invalid command: "${command}". Valid commands: ${VALID_COMMANDS.join(', ')}`,
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

    const startTime = Date.now();
    const response = await sendFourLetterWord(host, port, command, timeout);
    const rtt = Date.now() - startTime;

    // Parse structured data for certain commands
    let parsed: Record<string, string> | undefined;
    if (command === 'srvr' || command === 'conf' || command === 'envi') {
      parsed = parseSrvrOutput(response);
    } else if (command === 'mntr') {
      parsed = parseMntrOutput(response);
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      command,
      rtt,
      response,
      parsed,
    }), {
      status: 200,
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
