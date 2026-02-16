/**
 * RELP (Reliable Event Logging Protocol) Implementation
 *
 * RELP is a TCP-based protocol designed for reliable delivery of syslog
 * messages between rsyslog instances. Unlike plain syslog (UDP/TCP),
 * RELP provides application-level acknowledgment ensuring no log loss.
 *
 * Default Port: 20514
 *
 * Frame Format:
 *   TXNR SP COMMAND SP DATALEN [SP DATA] LF
 *
 * Where:
 *   TXNR    - Transaction number (monotonically increasing integer)
 *   COMMAND - "open", "close", "syslog", "rsp"
 *   DATALEN - Length of DATA in bytes (0 if no data)
 *   DATA    - Payload (optional)
 *
 * Session Flow:
 *   1. Client sends "open" with relp_version and commands offers
 *   2. Server responds with "rsp" containing 200 OK and accepted commands
 *   3. Client sends "syslog" frames with log messages
 *   4. Server acknowledges each with "rsp" containing 200 OK
 *   5. Client sends "close" to end session
 *   6. Server responds with "rsp" 200 OK
 *
 * Use Cases:
 *   - Reliable log forwarding between rsyslog instances
 *   - Guaranteed delivery of audit/compliance logs
 *   - High-availability logging pipelines
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/** Build a RELP frame */
function buildRelpFrame(txnr: number, command: string, data: string): Uint8Array {
  const dataBytes = new TextEncoder().encode(data);
  const header = `${txnr} ${command} ${dataBytes.length}`;
  const frame = data.length > 0
    ? `${header} ${data}\n`
    : `${header}\n`;
  return new TextEncoder().encode(frame);
}

/** Parse a RELP response frame */
function parseRelpResponse(raw: string): {
  txnr: number;
  command: string;
  dataLen: number;
  data: string;
  statusCode?: number;
  statusMessage?: string;
} {
  // Frame: TXNR SP COMMAND SP DATALEN [SP DATA] LF
  const trimmed = raw.trim();
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace === -1) throw new Error('Invalid RELP frame: no command');

  const txnr = parseInt(trimmed.substring(0, firstSpace), 10);
  const rest = trimmed.substring(firstSpace + 1);

  const secondSpace = rest.indexOf(' ');
  if (secondSpace === -1) throw new Error('Invalid RELP frame: no datalen');

  const command = rest.substring(0, secondSpace);
  const afterCommand = rest.substring(secondSpace + 1);

  const thirdSpace = afterCommand.indexOf(' ');
  let dataLen: number;
  let data: string;

  if (thirdSpace === -1) {
    dataLen = parseInt(afterCommand, 10);
    data = '';
  } else {
    dataLen = parseInt(afterCommand.substring(0, thirdSpace), 10);
    data = afterCommand.substring(thirdSpace + 1);
  }

  // Parse status code from data (e.g., "200 OK\nrelp_version=0\n...")
  let statusCode: number | undefined;
  let statusMessage: string | undefined;
  if (data.length > 0) {
    const statusMatch = data.match(/^(\d{3})\s*(.*?)(?:\n|$)/);
    if (statusMatch) {
      statusCode = parseInt(statusMatch[1], 10);
      statusMessage = statusMatch[2] || undefined;
    }
  }

  return { txnr, command, dataLen, data, statusCode, statusMessage };
}

/** Read data from socket until we have a complete RELP response */
async function readRelpResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
  );

  const readPromise = (async () => {
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      // RELP frames end with LF
      if (buffer.includes('\n')) {
        return buffer;
      }
    }
    return buffer;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Handle RELP connection test
 * POST /api/relp/connect
 *
 * Performs the RELP "open" handshake to test connectivity and
 * negotiate capabilities with the server.
 */
export async function handleRelpConnect(request: Request): Promise<Response> {
  try {
    const { host, port = 20514, timeout = 10000 } = await request.json<{
      host: string;
      port?: number;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
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

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Build RELP open command
        // Offers: relp_version, relp_software, commands
        const openData = [
          'relp_version=0',
          'relp_software=portofcall/1.0',
          'commands=syslog',
        ].join('\n');

        const openFrame = buildRelpFrame(1, 'open', openData);
        await writer.write(openFrame);

        // Read server response
        const responseRaw = await readRelpResponse(reader, 5000);
        const rtt = Date.now() - startTime;

        // Try to gracefully close
        try {
          const closeFrame = buildRelpFrame(2, 'close', '');
          await writer.write(closeFrame);
          // Read close response (best effort)
          await readRelpResponse(reader, 2000).catch(() => {});
        } catch {
          // Ignore close errors
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        // Parse the open response
        const parsed = parseRelpResponse(responseRaw);

        // Extract server capabilities from response data
        const capabilities: Record<string, string> = {};
        if (parsed.data) {
          const lines = parsed.data.split('\n');
          for (const line of lines) {
            const eqIdx = line.indexOf('=');
            if (eqIdx > 0) {
              capabilities[line.substring(0, eqIdx).trim()] = line.substring(eqIdx + 1).trim();
            }
          }
        }

        return {
          success: true,
          host,
          port,
          rtt,
          statusCode: parsed.statusCode,
          statusMessage: parsed.statusMessage,
          serverVersion: capabilities['relp_version'] || 'unknown',
          serverSoftware: capabilities['relp_software'] || 'unknown',
          supportedCommands: capabilities['commands'] || 'unknown',
          rawResponse: responseRaw.trim(),
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'RELP connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle RELP syslog message send
 * POST /api/relp/send
 *
 * Sends a syslog message via RELP with guaranteed delivery acknowledgment.
 */
export async function handleRelpSend(request: Request): Promise<Response> {
  try {
    const {
      host,
      port = 20514,
      message,
      facility = 1,
      severity = 6,
      hostname = 'portofcall',
      appName = 'test',
      timeout = 10000,
    } = await request.json<{
      host: string;
      port?: number;
      message: string;
      facility?: number;
      severity?: number;
      hostname?: string;
      appName?: string;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!message) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: message' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate facility (0-23) and severity (0-7)
    if (facility < 0 || facility > 23) {
      return new Response(JSON.stringify({ error: 'Facility must be between 0 and 23' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (severity < 0 || severity > 7) {
      return new Response(JSON.stringify({ error: 'Severity must be between 0 and 7' }), {
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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: Open session
        const openData = [
          'relp_version=0',
          'relp_software=portofcall/1.0',
          'commands=syslog',
        ].join('\n');

        const openFrame = buildRelpFrame(1, 'open', openData);
        await writer.write(openFrame);

        const openResponse = await readRelpResponse(reader, 5000);
        const openParsed = parseRelpResponse(openResponse);

        if (openParsed.statusCode !== 200) {
          throw new Error(`RELP open rejected: ${openParsed.statusCode} ${openParsed.statusMessage || ''}`);
        }

        // Step 2: Send syslog message
        // Build RFC 5424 syslog message
        const pri = facility * 8 + severity;
        const timestamp = new Date().toISOString();
        const syslogMsg = `<${pri}>1 ${timestamp} ${hostname} ${appName} - - - ${message}`;

        const syslogFrame = buildRelpFrame(2, 'syslog', syslogMsg);
        await writer.write(syslogFrame);

        const syslogResponse = await readRelpResponse(reader, 5000);
        const syslogParsed = parseRelpResponse(syslogResponse);

        // Step 3: Close session
        const closeFrame = buildRelpFrame(3, 'close', '');
        await writer.write(closeFrame);
        await readRelpResponse(reader, 2000).catch(() => {});

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const acknowledged = syslogParsed.statusCode === 200;

        return {
          success: true,
          host,
          port,
          acknowledged,
          statusCode: syslogParsed.statusCode,
          statusMessage: syslogParsed.statusMessage,
          sentMessage: syslogMsg,
          facility,
          severity,
          facilityName: FACILITY_NAMES[facility] || `facility${facility}`,
          severityName: SEVERITY_NAMES[severity] || `severity${severity}`,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'RELP send failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** Syslog facility names */
const FACILITY_NAMES: Record<number, string> = {
  0: 'kern',
  1: 'user',
  2: 'mail',
  3: 'daemon',
  4: 'auth',
  5: 'syslog',
  6: 'lpr',
  7: 'news',
  8: 'uucp',
  9: 'cron',
  10: 'authpriv',
  11: 'ftp',
  16: 'local0',
  17: 'local1',
  18: 'local2',
  19: 'local3',
  20: 'local4',
  21: 'local5',
  22: 'local6',
  23: 'local7',
};

/** Syslog severity names */
const SEVERITY_NAMES: Record<number, string> = {
  0: 'emerg',
  1: 'alert',
  2: 'crit',
  3: 'err',
  4: 'warning',
  5: 'notice',
  6: 'info',
  7: 'debug',
};
