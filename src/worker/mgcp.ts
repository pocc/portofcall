/**
 * MGCP (Media Gateway Control Protocol) Implementation
 *
 * MGCP (RFC 3435) is a VoIP signaling protocol using a centralized
 * architecture where a Call Agent controls "dumb" Media Gateways.
 *
 * NOTE: RFC 3435 specifies UDP as the primary transport (port 2427 for
 * gateways, 2727 for call agents). This implementation uses TCP because
 * Cloudflare Workers' connect() API only supports TCP sockets. Most
 * real-world MGCP gateways also accept TCP connections as an alternative
 * transport per RFC 3435 Appendix A.
 *
 * Protocol Flow:
 * 1. Client connects to gateway on port 2427
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
 * Generate a transaction ID in the RFC 3435 valid range (1 to 999999999).
 */
function generateTransactionId(): string {
  return Math.floor(1 + Math.random() * 999999998).toString();
}

/**
 * Send an MGCP command over TCP and read the response.
 *
 * Per RFC 3435 Section 3.2, responses consist of a response line,
 * optional parameter lines, a blank line, and an optional SDP body.
 * The complete message is terminated by a trailing \r\n\r\n.
 */
async function sendMgcpCommand(
  host: string,
  port: number,
  command: string,
  timeout: number,
): Promise<{ raw: string; responseCode: number; transactionId: string; comment: string; params: Record<string, string>; sdp: string }> {
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

  // Read with timeout - MGCP responses are small but may be multi-line
  const readTimeout = new Promise<{ value: undefined; done: true }>((resolve) => {
    setTimeout(() => resolve({ value: undefined, done: true }), 5000);
  });

  for (let i = 0; i < 10; i++) {
    const result = await Promise.race([reader.read(), readTimeout]);
    if (result.done || !result.value) break;
    response += decoder.decode(result.value, { stream: true });
    // RFC 3435: complete response ends with \r\n\r\n (blank line after
    // headers/SDP). Only break early when we see the end-of-message marker.
    if (response.includes('\r\n\r\n')) break;
  }

  reader.releaseLock();
  socket.close();

  // Parse response: split into header section and optional SDP body.
  // The first \r\n\r\n separates MGCP headers from the SDP body.
  let headerSection = response;
  let sdp = '';
  const blankLineIdx = response.indexOf('\r\n\r\n');
  if (blankLineIdx !== -1) {
    headerSection = response.substring(0, blankLineIdx);
    const afterBlank = response.substring(blankLineIdx + 4);
    // Check if what follows looks like SDP (starts with v=)
    if (afterBlank.trimStart().startsWith('v=')) {
      sdp = afterBlank.trim();
    }
  }

  const lines = headerSection.split('\r\n').filter(l => l.length > 0);
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

  // Parse additional parameters from response header lines
  const params: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const colonIdx = lines[i].indexOf(':');
    if (colonIdx > 0) {
      const key = lines[i].substring(0, colonIdx).trim();
      const value = lines[i].substring(colonIdx + 1).trim();
      params[key] = value;
    }
  }

  return { raw: response, responseCode, transactionId, comment, params, sdp };
}

/**
 * Generate a random call ID (hex string).
 * Per RFC 3435 Section 3.2.2.2, the call ID is a hex string.
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
 *
 * Per RFC 3435 Section 2.3.9, AUEP may include an F: (RequestedInfo) parameter
 * to specify which information to return. Without it, the gateway returns
 * only the response code.
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

    const txId = generateTransactionId();
    const fqEndpoint = endpoint.includes('@') ? endpoint : `${endpoint}@${host}`;

    // Include F: (RequestedInfo) to ask for capabilities, requested events,
    // digit map, signal requests, request identifier, notified entity,
    // connection identifiers, bearer information, and restart info.
    const command =
      `AUEP ${txId} ${fqEndpoint} MGCP 1.0\r\n` +
      `F: A, R, D, S, X, N, I, T, O, ES\r\n` +
      `\r\n`;

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
      sdp: result.sdp || undefined,
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
 *
 * Valid Call Agent -> Gateway commands per RFC 3435:
 *   EPCF, CRCX, MDCX, DLCX, RQNT, AUEP, AUCX
 *
 * NTFY and RSIP are Gateway -> Call Agent commands and are therefore
 * not included in the valid verbs since we are acting as a Call Agent.
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

    // Validate command verb — CA-to-GW commands only per RFC 3435 Section 2.3.
    // NTFY (Section 2.3.6) and RSIP (Section 2.3.7) are GW-to-CA commands.
    const validVerbs = ['AUEP', 'AUCX', 'CRCX', 'MDCX', 'DLCX', 'RQNT', 'EPCF'];
    const upperVerb = verb.toUpperCase();
    if (!validVerbs.includes(upperVerb)) {
      return new Response(JSON.stringify({
        success: false,
        error: `Invalid MGCP command: ${verb}. Valid CA-to-GW verbs: ${validVerbs.join(', ')}`,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const txId = generateTransactionId();
    const fqEndpoint = endpoint.includes('@') ? endpoint : `${endpoint}@${host}`;

    // Build MGCP command
    let mgcpCommand = `${upperVerb} ${txId} ${fqEndpoint} MGCP 1.0\r\n`;

    // Add parameters
    if (cmdParams) {
      for (const [key, value] of Object.entries(cmdParams)) {
        mgcpCommand += `${key}: ${value}\r\n`;
      }
    }

    // Add call ID for commands that require it (RFC 3435 Section 3.2.2.2)
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
      sdp: result.sdp || undefined,
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

interface MGCPCallSetupRequest {
  host: string;
  port?: number;
  timeout?: number;
  endpoint: string;
  callId?: string;
  connectionMode?: string;
}

/**
 * Handle MGCP call setup: CRCX (create connection) followed by DLCX (delete connection).
 * Returns connection details parsed from the 200 OK SDP response, plus DLCX status.
 */
export async function handleMGCPCallSetup(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MGCPCallSetupRequest;
    const {
      host,
      port = 2427,
      timeout = 15000,
      endpoint,
      connectionMode = 'recvonly',
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

    if (!endpoint) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Endpoint is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const callId = body.callId || generateCallId();
    const fqEndpoint = endpoint.includes('@') ? endpoint : `${endpoint}@${host}`;

    // Generate two independent transaction IDs
    const txIdCrcx = generateTransactionId();
    const txIdDlcx = generateTransactionId();

    // Build CRCX command
    // L: p:20 = packetization 20ms, a:PCMU = G.711 mu-law
    const crcxCommand =
      `CRCX ${txIdCrcx} ${fqEndpoint} MGCP 1.0\r\n` +
      `C: ${callId}\r\n` +
      `L: p:20, a:PCMU\r\n` +
      `M: ${connectionMode}\r\n` +
      `\r\n`;

    const start = Date.now();
    const crcxResult = await sendMgcpCommand(host, port, crcxCommand, timeout);
    const crcxCode = crcxResult.responseCode;

    // Parse connection ID from MGCP header parameters.
    // RFC 3435 Section 2.3.5: CRCX response includes I: (connectionId).
    let connectionId = crcxResult.params['I'] ?? crcxResult.params['i'] ?? '';

    // Also scan raw lines for connection ID in case the parser missed it
    if (!connectionId) {
      const rawLines = crcxResult.raw.split('\r\n');
      for (const line of rawLines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('I:') || trimmed.startsWith('i:')) {
          connectionId = trimmed.substring(2).trim();
          break;
        }
      }
    }

    // Parse SDP from the separated SDP body, or fall back to raw line scanning
    let sdpIp = '';
    let sdpPort = 0;
    let sdpCodec = '';

    const sdpSource = crcxResult.sdp || crcxResult.raw;
    const sdpLines = sdpSource.split('\r\n');
    for (const line of sdpLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('c=IN IP4 ') || trimmed.startsWith('c=IN IP6 ')) {
        // SDP connection line: "c=IN IP4 192.168.1.1"
        sdpIp = trimmed.split(' ').pop() ?? '';
      } else if (trimmed.startsWith('m=audio ')) {
        // SDP media line: "m=audio 49152 RTP/AVP 0"
        const parts = trimmed.split(' ');
        sdpPort = parseInt(parts[1] ?? '0', 10);
        // payload type is parts[3] -- map 0=PCMU, 8=PCMA, etc.
        const pt = parts[3] ?? '';
        sdpCodec = pt === '0' ? 'PCMU' : pt === '8' ? 'PCMA' : pt ? `PT${pt}` : 'PCMU';
      }
    }

    let dlcxCode = 0;

    // Only attempt DLCX if CRCX succeeded and we have a connection ID.
    // RFC 3435: CRCX success is 200; DLCX may return 200 or 250.
    if (crcxCode >= 200 && crcxCode < 300 && connectionId) {
      const dlcxCommand =
        `DLCX ${txIdDlcx} ${fqEndpoint} MGCP 1.0\r\n` +
        `C: ${callId}\r\n` +
        `I: ${connectionId}\r\n` +
        `\r\n`;

      const dlcxResult = await sendMgcpCommand(host, port, dlcxCommand, timeout);
      dlcxCode = dlcxResult.responseCode;
    }

    const rtt = Date.now() - start;

    return new Response(JSON.stringify({
      success: true,
      crcxCode,
      connectionId,
      localSdp: {
        ip: sdpIp,
        port: sdpPort,
        codec: sdpCodec,
      },
      dlcxCode,
      rtt,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'MGCP call setup failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Map MGCP response codes to human-readable text.
 * Per RFC 3435 Section 2.4, the complete set of return codes.
 */
function getMgcpStatusText(code: number): string {
  const statusMap: Record<number, string> = {
    // Provisional (1xx)
    100: 'Transaction being executed (provisional)',
    101: 'Transaction has been queued',
    // Success (2xx)
    200: 'Transaction executed normally',
    250: 'Connection was deleted',
    // Transient errors (4xx)
    400: 'Transient error — unspecified',
    401: 'Phone is already off-hook',
    402: 'Phone is already on-hook',
    403: 'Transaction could not be executed (endpoint not ready)',
    404: 'Insufficient bandwidth',
    405: 'Endpoint is restarting',
    406: 'Transaction timed out',
    407: 'Aborted transaction',
    409: 'Overlapping transaction',
    410: 'No such transaction',
    // Permanent errors (5xx)
    500: 'Endpoint unknown',
    501: 'Endpoint is not ready',
    502: 'Endpoint does not have sufficient resources',
    503: 'Wildcard too complicated',
    504: 'Unknown or unsupported command',
    505: 'Unsupported RemoteConnectionDescriptor',
    506: 'Unable to satisfy both local and remote connection options',
    507: 'Unsupported functionality',
    508: 'Unknown or unsupported quarantine handling',
    509: 'Error in RemoteConnectionDescriptor',
    510: 'Protocol error',
    511: 'Unrecognized extension',
    512: 'Can not detect requested event',
    513: 'Can not generate requested signal',
    514: 'Can not send announcement',
    515: 'Incorrect connection ID',
    516: 'Unknown call ID',
    517: 'Unsupported or invalid mode',
    518: 'Unsupported or unknown package',
    519: 'Endpoint does not have a digit map',
    520: 'Endpoint is restarting',
    521: 'Endpoint redirected',
    522: 'No such event or signal',
    523: 'Unknown action',
    524: 'Internal inconsistency in LocalConnectionOptions',
    525: 'Unknown extension in LocalConnectionOptions',
    526: 'Insufficient bandwidth',
    527: 'Missing RemoteConnectionDescriptor',
    528: 'Incompatible protocol version',
    529: 'Internal hardware failure',
    530: 'CAS signaling protocol error',
    531: 'Failure of a grouping of trunks',
    532: 'Unsupported value(s) in LocalConnectionOptions',
    533: 'Response too large',
    534: 'Codec negotiation failure',
    535: 'Packetization period not supported',
    536: 'Unknown or unsupported RestartMethod',
    537: 'Unknown or unsupported digit map extension',
    538: 'Event/signal parameter error',
  };
  return statusMap[code] || `Unknown status (${code})`;
}
