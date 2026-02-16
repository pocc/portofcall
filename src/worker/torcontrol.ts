/**
 * Tor Control Protocol Support for Cloudflare Workers
 * Implements the Tor Control Protocol (port 9051)
 *
 * The Tor Control Protocol provides a text-based interface for controlling
 * a running Tor process. Commands and responses are line-oriented (CRLF).
 *
 * Response format:
 *   Single-line: "StatusCode SP ReplyText CRLF"
 *   Multi-line:  "StatusCode-ReplyText CRLF" (continued)
 *                "StatusCode SP ReplyText CRLF" (final line)
 *
 * Key commands:
 *   PROTOCOLINFO - Get auth methods and Tor version (no auth needed)
 *   AUTHENTICATE - Authenticate (password, cookie, or none)
 *   GETINFO      - Query various info keys (version, config, network-status, etc.)
 *   SIGNAL       - Send signals (NEWNYM, RELOAD, SHUTDOWN, etc.)
 *   QUIT         - Close connection
 *
 * Status codes:
 *   250 = OK, 251 = Operation unnecessary, 5xx = Error
 *   515 = Bad authentication
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Read a complete Tor control response (handles multi-line)
 * Responses end when we see a line starting with "StatusCode SP" (not "StatusCode-")
 */
async function readTorResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  let buffer = '';

  const timeoutPromise = new Promise<string>((resolve) =>
    setTimeout(() => resolve(buffer), timeoutMs)
  );

  const readPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Check for complete response: last line has "NNN " pattern (not "NNN-")
      const lines = buffer.split('\r\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.length >= 4 && /^\d{3} /.test(line)) {
          // Found a final response line, check if buffer ends with CRLF after it
          const endOfFinal = buffer.lastIndexOf(line) + line.length;
          if (buffer.substring(endOfFinal).startsWith('\r\n')) {
            return buffer;
          }
        }
      }
    }
    return buffer;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Send a command and read the response
 */
async function sendTorCommand(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  command: string,
  timeoutMs: number
): Promise<string> {
  await writer.write(encoder.encode(command + '\r\n'));
  return readTorResponse(reader, timeoutMs);
}

/**
 * Parse a Tor control response into status code and lines
 */
function parseTorResponse(raw: string): {
  statusCode: number;
  lines: string[];
  isError: boolean;
} {
  const lines = raw.trim().split('\r\n').filter(l => l.length > 0);
  let statusCode = 0;
  const resultLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(\d{3})([ +-])(.*)$/);
    if (match) {
      statusCode = parseInt(match[1]);
      const text = match[3];
      if (text) resultLines.push(text);
    } else {
      resultLines.push(line);
    }
  }

  return {
    statusCode,
    lines: resultLines,
    isError: statusCode >= 400,
  };
}

/**
 * Parse PROTOCOLINFO response
 */
function parseProtocolInfo(raw: string): {
  protocolInfoVersion?: string;
  torVersion?: string;
  authMethods?: string[];
  cookieFile?: string;
} {
  const result: ReturnType<typeof parseProtocolInfo> = {};

  const lines = raw.trim().split('\r\n');
  for (const line of lines) {
    // PROTOCOLINFO line
    const piMatch = line.match(/^250-PROTOCOLINFO\s+(\d+)/);
    if (piMatch) {
      result.protocolInfoVersion = piMatch[1];
    }

    // AUTH line: 250-AUTH METHODS=method1,method2 COOKIEFILE="/path"
    const authMatch = line.match(/^250-AUTH\s+METHODS=([^\s]+)/);
    if (authMatch) {
      result.authMethods = authMatch[1].split(',');
      const cookieMatch = line.match(/COOKIEFILE="([^"]+)"/);
      if (cookieMatch) {
        result.cookieFile = cookieMatch[1];
      }
    }

    // VERSION line: 250-VERSION Tor="0.4.8.12"
    const verMatch = line.match(/^250-VERSION\s+Tor="([^"]+)"/);
    if (verMatch) {
      result.torVersion = verMatch[1];
    }
  }

  return result;
}

/**
 * Handle Tor Control probe - sends PROTOCOLINFO (no auth needed)
 * POST /api/torcontrol/probe
 */
export async function handleTorControlProbe(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 9051;
    const timeoutMs = options.timeout || 10000;

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
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send PROTOCOLINFO (does not require authentication)
        const sendTime = Date.now();
        const piResp = await sendTorCommand(writer, reader, 'PROTOCOLINFO 1', 5000);
        const rtt = Date.now() - sendTime;

        // Parse PROTOCOLINFO
        const piParsed = parseProtocolInfo(piResp);
        const parsed = parseTorResponse(piResp);

        // Send QUIT
        await writer.write(encoder.encode('QUIT\r\n'));

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: !parsed.isError,
          message: parsed.isError
            ? `Tor control error: ${parsed.lines[0] || 'unknown'}`
            : 'Tor control port detected',
          host,
          port,
          connectTime,
          rtt,
          isTor: !parsed.isError,
          statusCode: parsed.statusCode,
          torVersion: piParsed.torVersion,
          protocolInfoVersion: piParsed.protocolInfoVersion,
          authMethods: piParsed.authMethods,
          cookieFile: piParsed.cookieFile,
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Request failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Tor Control getinfo - authenticate and query GETINFO
 * POST /api/torcontrol/getinfo
 */
export async function handleTorControlGetInfo(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      password?: string;
      keys?: string[];
      timeout?: number;
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 9051;
    const password = options.password || '';
    const keys = options.keys || ['version', 'config-file', 'traffic/read', 'traffic/written', 'uptime'];
    const timeoutMs = options.timeout || 10000;

    // Validate keys: alphanumeric, hyphens, slashes, dots only
    for (const key of keys) {
      if (!/^[a-zA-Z0-9\-/.]+$/.test(key)) {
        return new Response(JSON.stringify({
          error: `Invalid GETINFO key: ${key}`,
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
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
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Authenticate
        const authCmd = password
          ? `AUTHENTICATE "${password.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
          : 'AUTHENTICATE';
        const authResp = await sendTorCommand(writer, reader, authCmd, 3000);
        const authParsed = parseTorResponse(authResp);

        if (authParsed.isError) {
          // Send QUIT
          await writer.write(encoder.encode('QUIT\r\n'));
          writer.releaseLock();
          reader.releaseLock();
          await socket.close();

          return {
            success: false,
            error: `Authentication failed: ${authParsed.lines[0] || `status ${authParsed.statusCode}`}`,
            host,
            port,
            connectTime,
            authenticated: false,
          };
        }

        // Send GETINFO for each key
        const sendTime = Date.now();
        const getInfoCmd = `GETINFO ${keys.join(' ')}`;
        const getInfoResp = await sendTorCommand(writer, reader, getInfoCmd, 5000);
        const rtt = Date.now() - sendTime;

        const getInfoParsed = parseTorResponse(getInfoResp);

        // Parse the key=value pairs from response
        const info: Record<string, string> = {};
        for (const line of getInfoParsed.lines) {
          if (line === 'OK') continue;
          const eqIdx = line.indexOf('=');
          if (eqIdx > 0) {
            info[line.substring(0, eqIdx)] = line.substring(eqIdx + 1);
          }
        }

        // Send QUIT
        await writer.write(encoder.encode('QUIT\r\n'));

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: !getInfoParsed.isError,
          message: getInfoParsed.isError
            ? `GETINFO error: ${getInfoParsed.lines[0] || 'unknown'}`
            : `Retrieved ${Object.keys(info).length} info key(s)`,
          host,
          port,
          connectTime,
          rtt,
          authenticated: true,
          statusCode: getInfoParsed.statusCode,
          info,
          keys: Object.keys(info),
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Request failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
