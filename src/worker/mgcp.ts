/**
 * MGCP (Media Gateway Control Protocol) Implementation
 *
 * MGCP (RFC 3435) is a VoIP signaling protocol using a centralized
 * architecture where a Call Agent controls "dumb" Media Gateways.
 *
 * Protocol Flow:
 * 1. Client connects to gateway on TCP port 2427
 * 2. Client sends text-based commands (AUEP, CRCX, etc.)
 * 3. Gateway responds with numeric status codes
 *
 * Message Format:
 * Command: VERB transactionId endpoint@gateway MGCP 1.0\r\n
 * Response: statusCode transactionId comment\r\n
 */

import { connect } from 'cloudflare:sockets';

interface MGCPRequest {
  host: string;
  port?: number;
  endpoint?: string;
  timeout?: number;
}

interface MGCPCommandRequest extends MGCPRequest {
  command: string;
  params?: Record<string, string>;
}

/**
 * Send an MGCP command over TCP and read the response.
 */
async function sendMgcpCommand(
  host: string,
  port: number,
  command: string,
  timeout: number,
): Promise<{ raw: string; responseCode: number; transactionId: string; comment: string; params: Record<string, string> }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(command));
  writer.releaseLock();

  // Read response
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let response = '';

  // Read with timeout - MGCP responses are small
  const readTimeout = new Promise<{ value: undefined; done: true }>((resolve) => {
    setTimeout(() => resolve({ value: undefined, done: true }), 5000);
  });

  for (let i = 0; i < 5; i++) {
    const result = await Promise.race([reader.read(), readTimeout]);
    if (result.done || !result.value) break;
    response += decoder.decode(result.value, { stream: true });
    // Check if we got a complete response (ends with \r\n\r\n or just \r\n after status)
    if (response.includes('\r\n')) break;
  }

  reader.releaseLock();
  socket.close();

  // Parse response
  const lines = response.split('\r\n').filter(l => l.length > 0);
  const firstLine = lines[0] || '';

  // Response format: "statusCode transactionId comment"
  const match = firstLine.match(/^(\d{3})\s+(\S+)(?:\s+(.+))?$/);

  let responseCode = 0;
  let transactionId = '';
  let comment = '';

  if (match) {
    responseCode = parseInt(match[1], 10);
    transactionId = match[2];
    comment = match[3] || '';
  }

  // Parse additional parameters from response lines
  const params: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const colonIdx = lines[i].indexOf(':');
    if (colonIdx > 0) {
      const key = lines[i].substring(0, colonIdx).trim();
      const value = lines[i].substring(colonIdx + 1).trim();
      params[key] = value;
    }
  }

  return { raw: response, responseCode, transactionId, comment, params };
}

/**
 * Generate a random call ID (hex string).
 */
function generateCallId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Handle MGCP Audit Endpoint (AUEP) - query endpoint state.
 * This is the lightest MGCP probe: asks the gateway about an endpoint's capabilities.
 */
export async function handleMGCPAudit(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MGCPRequest;
    const {
      host,
      port = 2427,
      endpoint = 'aaln/1',
      timeout = 10000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const txId = Math.floor(1000 + Math.random() * 8999).toString();
    const fqEndpoint = endpoint.includes('@') ? endpoint : `${endpoint}@${host}`;

    const command = `AUEP ${txId} ${fqEndpoint} MGCP 1.0\r\n\r\n`;

    const start = Date.now();
    const result = await sendMgcpCommand(host, port, command, timeout);
    const latencyMs = Date.now() - start;

    const statusText = getMgcpStatusText(result.responseCode);

    return new Response(JSON.stringify({
      success: true,
      command: 'AUEP',
      endpoint: fqEndpoint,
      responseCode: result.responseCode,
      statusText,
      transactionId: result.transactionId,
      comment: result.comment,
      params: result.params,
      raw: result.raw,
      latencyMs,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'MGCP audit failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle MGCP generic command - send any MGCP command.
 */
export async function handleMGCPCommand(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MGCPCommandRequest;
    const {
      host,
      port = 2427,
      endpoint = 'aaln/1',
      command: verb,
      params: cmdParams,
      timeout = 10000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!verb) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Command verb is required (AUEP, CRCX, DLCX, RQNT, etc.)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate command verb
    const validVerbs = ['AUEP', 'AUCX', 'CRCX', 'MDCX', 'DLCX', 'RQNT', 'EPCF', 'RSIP'];
    const upperVerb = verb.toUpperCase();
    if (!validVerbs.includes(upperVerb)) {
      return new Response(JSON.stringify({
        success: false,
        error: `Invalid MGCP command: ${verb}. Valid: ${validVerbs.join(', ')}`,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const txId = Math.floor(1000 + Math.random() * 8999).toString();
    const fqEndpoint = endpoint.includes('@') ? endpoint : `${endpoint}@${host}`;

    // Build MGCP command
    let mgcpCommand = `${upperVerb} ${txId} ${fqEndpoint} MGCP 1.0\r\n`;

    // Add parameters
    if (cmdParams) {
      for (const [key, value] of Object.entries(cmdParams)) {
        mgcpCommand += `${key}: ${value}\r\n`;
      }
    }

    // Add call ID for commands that need it
    if (['CRCX', 'MDCX', 'DLCX'].includes(upperVerb) && !cmdParams?.['C']) {
      mgcpCommand += `C: ${generateCallId()}\r\n`;
    }

    mgcpCommand += '\r\n';

    const start = Date.now();
    const result = await sendMgcpCommand(host, port, mgcpCommand, timeout);
    const latencyMs = Date.now() - start;

    const statusText = getMgcpStatusText(result.responseCode);

    return new Response(JSON.stringify({
      success: true,
      command: upperVerb,
      endpoint: fqEndpoint,
      responseCode: result.responseCode,
      statusText,
      transactionId: result.transactionId,
      comment: result.comment,
      params: result.params,
      raw: result.raw,
      sentCommand: mgcpCommand,
      latencyMs,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'MGCP command failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Map MGCP response codes to human-readable text.
 */
function getMgcpStatusText(code: number): string {
  const statusMap: Record<number, string> = {
    100: 'Transaction being executed',
    200: 'Success',
    250: 'Connection deleted',
    400: 'Bad request',
    401: 'Protocol error',
    402: 'Unrecognized extension',
    403: 'Forbidden',
    404: 'Endpoint not found',
    405: 'Connection not found',
    406: 'Wrong command verb',
    407: 'Incompatible protocol version',
    500: 'Endpoint not ready',
    501: 'Not implemented',
    502: 'Gateway overloaded',
    510: 'No endpoint available',
    511: 'No resources available',
    512: 'Gateway out of service',
    520: 'Endpoint redirected',
    521: 'Endpoint offline',
  };
  return statusMap[code] || `Unknown status (${code})`;
}
