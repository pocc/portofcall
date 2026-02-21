/**
 * GELF (Graylog Extended Log Format) TCP Protocol Support
 * Implements GELF over TCP (null-byte delimited JSON)
 *
 * Default port: 12201
 * Format: JSON messages delimited by null bytes (\0)
 *
 * Spec: https://go2docs.graylog.org/5-0/getting_in_log_data/gelf.html
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();

/** GELF message severity levels (syslog compatible) */
export enum GelfLevel {
  EMERGENCY = 0,
  ALERT = 1,
  CRITICAL = 2,
  ERROR = 3,
  WARNING = 4,
  NOTICE = 5,
  INFO = 6,
  DEBUG = 7,
}

/** GELF message interface */
export interface GelfMessage {
  version: '1.1';
  host: string;
  short_message: string;
  full_message?: string;
  timestamp?: number;
  level?: GelfLevel;
  facility?: string;
  line?: number;
  file?: string;
  [key: `_${string}`]: string | number | boolean | null | undefined; // Custom fields
}

/** Validate a GELF message has required fields */
function validateGelfMessage(msg: unknown): msg is GelfMessage {
  if (!msg || typeof msg !== 'object') {
    return false;
  }

  const obj = msg as Record<string, unknown>;

  // Required fields
  if (obj.version !== '1.1') {
    return false;
  }

  if (typeof obj.host !== 'string' || obj.host.length === 0 || obj.host.length > 255) {
    return false;
  }

  if (typeof obj.short_message !== 'string' || obj.short_message.length === 0) {
    return false;
  }

  // Optional fields validation
  if (obj.full_message !== undefined && typeof obj.full_message !== 'string') {
    return false;
  }

  if (obj.timestamp !== undefined && (typeof obj.timestamp !== 'number' || !isFinite(obj.timestamp))) {
    return false;
  }

  if (obj.level !== undefined && (typeof obj.level !== 'number' || obj.level < 0 || obj.level > 7)) {
    return false;
  }

  // Validate custom fields start with underscore
  for (const key of Object.keys(obj)) {
    if (!['version', 'host', 'short_message', 'full_message', 'timestamp', 'level', 'facility', 'line', 'file'].includes(key)) {
      if (!key.startsWith('_')) {
        return false; // Custom fields must start with _
      }

      // Reserved fields that cannot be used
      if (key === '_id') {
        return false;
      }
    }
  }

  return true;
}

/**
 * Send GELF log messages to a Graylog server
 * POST /api/gelf/send
 *
 * Body: {
 *   host: string,
 *   port?: number,
 *   messages: GelfMessage[],
 *   timeout?: number
 * }
 */
export async function handleGelfSend(request: Request): Promise<Response> {
  try {
    const { host, port = 12201, messages, timeout = 10000 } = await request.json<{
      host: string;
      port?: number;
      messages: GelfMessage[];
      timeout?: number;
    }>();

    // Validate parameters
    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: messages (array of GELF messages)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Limit batch size
    if (messages.length > 100) {
      return new Response(JSON.stringify({
        error: 'Maximum 100 messages per batch',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate timeout parameter
    if (timeout < 100 || timeout > 300000) {
      return new Response(JSON.stringify({
        error: 'Timeout must be between 100ms and 300000ms (5 minutes)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate port parameter
    if (isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        error: 'Invalid port number. Must be 1-65535.',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate all messages
    for (let i = 0; i < messages.length; i++) {
      const original = messages[i];
      const msg = { ...original }; // Shallow copy to avoid mutating caller's objects

      // Auto-populate timestamp if missing
      if (msg.timestamp === undefined) {
        msg.timestamp = Date.now() / 1000;
      }

      // Auto-populate version if missing
      if (!msg.version) {
        msg.version = '1.1';
      }

      if (!validateGelfMessage(msg)) {
        return new Response(JSON.stringify({
          error: `Invalid GELF message at index ${i}. Required: version='1.1', host (string), short_message (string). Custom fields must start with '_'.`,
          message: msg,
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      messages[i] = msg; // Replace with validated copy
    }

    // Check for Cloudflare protection
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

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      const connectionPromise = (async () => {
        const socket = connect(`${host}:${port}`);
        await socket.opened;

        const writer = socket.writable.getWriter();

        try {
          // Send each message as null-terminated JSON
          for (const msg of messages) {
            const json = JSON.stringify(msg);
            const payload = json + '\0'; // Null-byte terminator
            await writer.write(encoder.encode(payload));
          }

          return {
            success: true,
            message: `Sent ${messages.length} GELF message(s)`,
            host,
            port,
            messagesCount: messages.length,
          };
        } finally {
          writer.releaseLock();
          await socket.close();
        }
      })();

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
      });

      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Send failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Probe a GELF TCP server to verify connectivity
 * GET /api/gelf/probe?host=graylog.example.com&port=12201
 */
export async function handleGelfProbe(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const host = url.searchParams.get('host');
    const port = parseInt(url.searchParams.get('port') || '12201', 10);
    const timeout = parseInt(url.searchParams.get('timeout') || '5000', 10);

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate port parameter
    if (isNaN(port) || port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        error: 'Invalid port number. Must be 1-65535.',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate timeout parameter
    if (timeout < 100 || timeout > 300000) {
      return new Response(JSON.stringify({
        error: 'Timeout must be between 100ms and 300000ms (5 minutes)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for Cloudflare protection
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
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      const connectionPromise = (async () => {
        const socket = connect(`${host}:${port}`);
        await socket.opened;

        const connectTime = Date.now() - startTime;

        // Send a minimal test message
        const testMessage: GelfMessage = {
          version: '1.1',
          host: 'portofcall-probe',
          short_message: 'GELF TCP connectivity test',
          level: GelfLevel.DEBUG,
          _probe: true,
        };

        const writer = socket.writable.getWriter();
        try {
          const payload = JSON.stringify(testMessage) + '\0';
          await writer.write(encoder.encode(payload));

          const sendTime = Date.now() - startTime - connectTime;

          return {
            success: true,
            host,
            port,
            connectTimeMs: connectTime,
            sendTimeMs: sendTime,
            totalTimeMs: Date.now() - startTime,
            message: 'GELF server is reachable',
          };
        } finally {
          writer.releaseLock();
          await socket.close();
        }
      })();

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
      });

      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Probe failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
