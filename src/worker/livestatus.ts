/**
 * MK Livestatus Monitoring Query Protocol Implementation
 *
 * Livestatus is a text-based query protocol for monitoring systems, originally
 * developed for Nagios by Mathias Kettner (now part of Checkmk). It provides
 * a SQL-like query language to retrieve real-time monitoring data.
 *
 * Supported by: Checkmk, Naemon, Icinga 2, Shinken, OP5 Monitor, Thruk
 *
 * Protocol:
 * - Text-based request/response over TCP (port 6557)
 * - Queries are LQL (Livestatus Query Language) — resembles HTTP headers
 * - Request: GET <table>\n[Header: value\n]*\n  (blank line terminates)
 * - With ResponseHeader: fixed16, response starts with 16-byte status line:
 *   "<3-digit status> <12-char padded length>\n" then body
 *
 * Key Tables:
 * - status:    Global monitoring engine status (version, uptime, etc.)
 * - hosts:     All monitored hosts with state, address, etc.
 * - services:  All monitored services with state, output, etc.
 * - contacts:  Configured notification contacts
 * - commands:  Available check/notification commands
 * - columns:   Meta-table listing all available columns per table
 *
 * Query Headers:
 * - Columns: col1 col2 ...    (select specific columns)
 * - Filter: column op value   (filter rows)
 * - Limit: N                  (limit result count)
 * - OutputFormat: json|csv|python  (response format)
 * - ResponseHeader: fixed16   (include 16-byte status header)
 *
 * Status Codes (with ResponseHeader: fixed16):
 * - 200: OK
 * - 400: Bad request (invalid query)
 * - 404: Table not found
 * - 413: Response too large
 * - 451: Incomplete request
 * - 452: Completely invalid request
 *
 * Use Cases:
 * - Query monitoring engine status and version
 * - List monitored hosts and their current states
 * - Retrieve service check results
 * - Build monitoring dashboards (Thruk, Checkmk multisite)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface LivestatusRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface LivestatusQueryRequest extends LivestatusRequest {
  query: string;
}

/**
 * Build a Livestatus LQL query with fixed16 response header and JSON output.
 */
function buildQuery(table: string, columns?: string[], filters?: string[], limit?: number): string {
  let query = `GET ${table}\n`;
  if (columns && columns.length > 0) {
    query += `Columns: ${columns.join(' ')}\n`;
  }
  if (filters) {
    for (const filter of filters) {
      query += `Filter: ${filter}\n`;
    }
  }
  if (limit && limit > 0) {
    query += `Limit: ${limit}\n`;
  }
  query += `OutputFormat: json\n`;
  query += `ResponseHeader: fixed16\n`;
  query += `\n`; // Blank line terminates request
  return query;
}

/**
 * Read all available data from a reader until connection closes or timeout.
 */
async function readAll(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxBytes: number = 1048576, // 1MB safety limit
): Promise<Uint8Array> {
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
  return result;
}

/**
 * Parse a fixed16 response header: "200          123\n"
 * Returns status code and content length.
 */
function parseFixed16Header(data: Uint8Array): { status: number; contentLength: number; headerValid: boolean } {
  if (data.length < 16) {
    return { status: 0, contentLength: 0, headerValid: false };
  }

  const headerStr = new TextDecoder().decode(data.slice(0, 16));
  const statusStr = headerStr.substring(0, 3).trim();
  const lengthStr = headerStr.substring(4, 15).trim();

  const status = parseInt(statusStr, 10);
  const contentLength = parseInt(lengthStr, 10);

  if (isNaN(status) || isNaN(contentLength)) {
    return { status: 0, contentLength: 0, headerValid: false };
  }

  return { status, contentLength, headerValid: true };
}

/**
 * Send a Livestatus query and return the parsed response.
 */
async function sendQuery(
  host: string,
  port: number,
  timeout: number,
  query: string,
): Promise<{ status: number; body: string; rtt: number }> {
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

    // Send query
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(query));

    // Read response
    const responseBytes = await readAll(reader, timeoutPromise);
    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    if (responseBytes.length === 0) {
      throw new Error('Empty response — Livestatus may not be listening on this port');
    }

    // Parse fixed16 header
    const header = parseFixed16Header(responseBytes);
    if (!header.headerValid) {
      // Maybe no fixed16 header — could be raw response or error
      const rawText = new TextDecoder().decode(responseBytes);
      return { status: 0, body: rawText, rtt };
    }

    const body = new TextDecoder().decode(responseBytes.slice(16));
    return { status: header.status, body, rtt };
  } catch (error) {
    socket.close();
    throw error;
  }
}

/**
 * Handle Livestatus status probe — query the monitoring engine status.
 */
export async function handleLivestatusStatus(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as LivestatusRequest;
    const { host, port = 6557, timeout = 10000 } = body;

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

    const query = buildQuery('status', [
      'program_version',
      'program_start',
      'nagios_pid',
      'num_hosts',
      'num_services',
      'connections',
      'requests',
      'livestatus_version',
    ]);

    const result = await sendQuery(host, port, timeout, query);

    if (result.status === 200) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(result.body);
      } catch {
        // Not JSON — return raw
      }

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        statusCode: result.status,
        data: parsed || result.body,
        rtt: result.rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        statusCode: result.status,
        error: result.body || `Livestatus error (status ${result.status})`,
        rtt: result.rtt,
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
 * Handle Livestatus hosts query — list monitored hosts.
 */
export async function handleLivestatusHosts(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as LivestatusRequest;
    const { host, port = 6557, timeout = 10000 } = body;

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

    const query = buildQuery(
      'hosts',
      ['name', 'state', 'address', 'plugin_output', 'last_check', 'num_services'],
      undefined,
      50,
    );

    const result = await sendQuery(host, port, timeout, query);

    if (result.status === 200) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(result.body);
      } catch {
        // Not JSON
      }

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        statusCode: result.status,
        data: parsed || result.body,
        rtt: result.rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        statusCode: result.status,
        error: result.body || `Livestatus error (status ${result.status})`,
        rtt: result.rtt,
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
 * Handle custom Livestatus query — send arbitrary LQL.
 */
export async function handleLivestatusQuery(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as LivestatusQueryRequest;
    const { host, port = 6557, timeout = 10000, query: userQuery } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!userQuery) {
      return new Response(JSON.stringify({ success: false, error: 'Query is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Ensure the user query has OutputFormat and ResponseHeader
    let fullQuery = userQuery.trim();
    if (!fullQuery.includes('OutputFormat:')) {
      fullQuery += '\nOutputFormat: json';
    }
    if (!fullQuery.includes('ResponseHeader:')) {
      fullQuery += '\nResponseHeader: fixed16';
    }
    fullQuery += '\n\n';

    const result = await sendQuery(host, port, timeout, fullQuery);

    if (result.status === 200 || result.status === 0) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(result.body);
      } catch {
        // Not JSON
      }

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        statusCode: result.status,
        data: parsed || result.body,
        rtt: result.rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        statusCode: result.status,
        error: result.body || `Livestatus error (status ${result.status})`,
        rtt: result.rtt,
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
 * POST /api/livestatus/services
 * Query the services table with optional host/service filters.
 * Body: { host, port?, timeout?, filter?, limit? }
 * Response: { success, services: [{host_name, description, state, output, ...}], rtt }
 */
export async function handleLivestatusServices(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    interface ServicesRequest extends LivestatusRequest { filter?: string; limit?: number; }
    const body = await request.json() as ServicesRequest;
    const { host, port = 6557, timeout = 10000, filter, limit = 100 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const filters = filter ? [filter] : undefined;
    const query = buildQuery(
      'services',
      ['host_name', 'description', 'state', 'state_type', 'plugin_output',
       'last_check', 'next_check', 'acknowledged', 'notifications_enabled'],
      filters,
      limit,
    );
    const result = await sendQuery(host, port, timeout, query);

    if (result.status === 200 || result.status === 0) {
      let data: unknown = result.body;
      try { data = JSON.parse(result.body); } catch { /* leave as string */ }
      return new Response(JSON.stringify({
        success: true, host, port, services: data, rtt: result.rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: false, error: `Livestatus error ${result.status}`, rawBody: result.body, rtt: result.rtt,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * POST /api/livestatus/command
 * Send a Nagios/Checkmk external COMMAND via Livestatus.
 * Supports: ACKNOWLEDGE_SVC_PROBLEM, SCHEDULE_SVC_DOWNTIME, SCHEDULE_HOST_CHECK,
 *           ACKNOWLEDGE_HOST_PROBLEM, SCHEDULE_HOST_DOWNTIME, PROCESS_SERVICE_CHECK_RESULT
 *
 * Body: { host, port?, timeout?, command, args? }
 *   command: Nagios external command name (e.g. "ACKNOWLEDGE_SVC_PROBLEM")
 *   args: array of args (e.g. ["web01", "HTTP", "1", "1", "0", "admin", "ack"])
 * Response: { success, command, sent, rtt }
 */
export async function handleLivestatusCommand(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    interface CommandRequest extends LivestatusRequest { command: string; args?: string[]; }
    const body = await request.json() as CommandRequest;
    const { host, port = 6557, timeout = 10000, command, args = [] } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!command) {
      return new Response(JSON.stringify({ success: false, error: 'command is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Nagios external command format: COMMAND [timestamp] COMMAND_NAME;arg1;arg2...
    const timestamp = Math.floor(Date.now() / 1000);
    const argsStr = args.length > 0 ? ';' + args.join(';') : '';
    const cmdLine = `COMMAND [${timestamp}] ${command.toUpperCase()}${argsStr}`;

    // COMMAND write: no response header, no blank line (Livestatus just reads and exits)
    const cmdText = `${cmdLine}\n`;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
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

      await writer.write(new TextEncoder().encode(cmdText));
      // COMMAND writes don't return a response; wait briefly for connection close
      const rtt = Date.now() - startTime;
      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true, host, port, command: cmdLine, sent: true, rtt,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      socket.close();
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
