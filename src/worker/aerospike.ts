/**
 * Aerospike Info Protocol Support for Cloudflare Workers
 *
 * Implements the Aerospike Info protocol - a simple text-based
 * request/response protocol used for querying cluster metadata,
 * health checking, and server diagnostics.
 *
 * Protocol:
 *   Client -> Server: "<command>\n"
 *   Server -> Client: "<response>\n"
 *
 * The info protocol uses newline-delimited messages. Requests are
 * single command names. Responses are tab-separated key-value pairs
 * or semicolon-separated lists depending on the command.
 *
 * Default port: 3000
 *
 * Common info commands:
 *   - build           → Server build version
 *   - node            → Node ID
 *   - status          → Server status (ok)
 *   - namespaces      → Semicolon-separated namespace list
 *   - namespace/<ns>  → Namespace configuration details
 *   - statistics       → Server-wide statistics
 *   - cluster-name    → Cluster name
 *   - features        → Supported feature flags
 *   - edition         → Enterprise or Community edition
 *   - service         → Access endpoint addresses
 *
 * Use Cases:
 *   - Aerospike cluster health monitoring
 *   - Server version and edition detection
 *   - Namespace enumeration and configuration
 *   - Cluster topology discovery
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Valid info commands that are safe to execute (read-only)
const VALID_COMMANDS = [
  'build',
  'node',
  'status',
  'namespaces',
  'statistics',
  'cluster-name',
  'features',
  'edition',
  'service',
  'services',
  'services-alumni',
  'peers-generation',
  'partition-generation',
  'logs',
  'sets',
  'bins',
  'sindex',
  'udf-list',
  'jobs:module=query',
  'jobs:module=scan',
];

/**
 * Send an info command to an Aerospike server and read the response
 */
async function sendInfoCommand(
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

    // Aerospike info protocol: send command followed by newline
    await writer.write(new TextEncoder().encode(`${command}\n`));

    // Read the response
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const maxResponseSize = 256 * 1024; // 256KB max

    try {
      while (totalBytes < maxResponseSize) {
        const { value, done } = await Promise.race([
          reader.read(),
          timeoutPromise,
        ]);

        if (done || !value) break;

        chunks.push(value);
        totalBytes += value.length;

        // Check if response is complete (ends with newline)
        const text = new TextDecoder().decode(value);
        if (text.includes('\n')) break;
      }
    } catch {
      // Read timeout or connection closed
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
 * Parse an Aerospike info response into key-value pairs
 * Format: "key1=value1;key2=value2;..." or "tab-separated key\tvalue"
 */
function parseInfoResponse(response: string): Record<string, string> {
  const result: Record<string, string> = {};

  // Strip the command echo prefix if present (e.g., "build\t6.0.0")
  const tabIdx = response.indexOf('\t');
  const data = tabIdx >= 0 ? response.substring(tabIdx + 1) : response;

  // Try semicolon-separated key=value pairs
  const parts = data.split(';');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx > 0) {
      const key = part.substring(0, eqIdx).trim();
      const value = part.substring(eqIdx + 1).trim();
      result[key] = value;
    } else if (part.trim()) {
      // Single value without key
      result['_value'] = part.trim();
    }
  }

  return result;
}

/**
 * Handle Aerospike connection test (HTTP mode)
 * Connects and queries build, status, node, edition, cluster-name, namespaces
 */
export async function handleAerospikeConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 3000, timeout = 10000 } = body;

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

    // Query build version to verify connectivity
    const buildResponse = await sendInfoCommand(host, port, 'build', timeout);

    // Parse the build version (format: "build\t6.0.0" or just "6.0.0")
    const buildVersion = buildResponse.includes('\t')
      ? buildResponse.split('\t')[1]
      : buildResponse;

    // Query additional info
    let status = 'unknown';
    let nodeId = 'unknown';
    let edition = 'unknown';
    let clusterName = 'unknown';
    let namespaces: string[] = [];

    try {
      const statusResp = await sendInfoCommand(host, port, 'status', timeout);
      status = statusResp.includes('\t') ? statusResp.split('\t')[1] : statusResp;
    } catch { /* optional */ }

    try {
      const nodeResp = await sendInfoCommand(host, port, 'node', timeout);
      nodeId = nodeResp.includes('\t') ? nodeResp.split('\t')[1] : nodeResp;
    } catch { /* optional */ }

    try {
      const editionResp = await sendInfoCommand(host, port, 'edition', timeout);
      edition = editionResp.includes('\t') ? editionResp.split('\t')[1] : editionResp;
    } catch { /* optional */ }

    try {
      const clusterResp = await sendInfoCommand(host, port, 'cluster-name', timeout);
      clusterName = clusterResp.includes('\t') ? clusterResp.split('\t')[1] : clusterResp;
    } catch { /* optional */ }

    try {
      const nsResp = await sendInfoCommand(host, port, 'namespaces', timeout);
      const nsData = nsResp.includes('\t') ? nsResp.split('\t')[1] : nsResp;
      namespaces = nsData ? nsData.split(';').filter(Boolean) : [];
    } catch { /* optional */ }

    const rtt = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      serverInfo: {
        build: buildVersion,
        status,
        nodeId,
        edition,
        clusterName,
        namespaces,
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
 * Handle Aerospike info command execution
 * Sends any valid info command and returns the raw + parsed response
 */
export async function handleAerospikeInfo(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      command: string;
      timeout?: number;
    };

    const { host, port = 3000, command, timeout = 10000 } = body;

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

    // Validate command against allowed list (also allow namespace/<ns> pattern)
    const isNamespaceQuery = /^namespace\/[a-zA-Z0-9_-]+$/.test(command);
    if (!VALID_COMMANDS.includes(command) && !isNamespaceQuery) {
      return new Response(JSON.stringify({
        success: false,
        error: `Invalid command: "${command}". Valid commands: ${VALID_COMMANDS.join(', ')}, namespace/<name>`,
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
    const response = await sendInfoCommand(host, port, command, timeout);
    const rtt = Date.now() - startTime;

    // Parse structured data
    const parsed = parseInfoResponse(response);

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
