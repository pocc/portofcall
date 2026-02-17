/**
 * Perforce (Helix Core) Protocol Implementation (Port 1666/TCP)
 *
 * Perforce is a proprietary version control system (VCS) widely used in game
 * development and large enterprises. The p4d server listens on port 1666 and
 * uses a binary tagged wire protocol for client-server communication.
 *
 * Wire Protocol Overview:
 * - The client initiates all communication (server sends nothing on connect)
 * - Messages consist of null-terminated key=value pairs
 * - The "func" key specifies the RPC function to invoke
 * - A message is terminated by two consecutive null bytes
 *
 * Initial Client → Server Message:
 *   func\0protocol\0\0  (negotiates protocol version)
 *
 * Server → Client Response:
 *   server2\0<version>\0  (server version info)
 *   xfiles\0<n>\0         (max xfiles)
 *   ... more key-value pairs ...
 *   \0\0                  (end of message)
 *
 * Default Port: 1666/TCP
 *
 * Note: The Perforce protocol is proprietary and not publicly documented.
 * This implementation is based on protocol analysis and community research.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface PerforceProbeRequest {
  host: string;
  port?: number;
  timeout?: number;
}

function validatePerforceInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) return 'Host is required';
  if (!/^[a-zA-Z0-9._-]+$/.test(host)) return 'Host contains invalid characters';
  if (port < 1 || port > 65535) return 'Port must be between 1 and 65535';
  return null;
}

/**
 * Parse a Perforce tagged wire protocol message into key-value pairs.
 * Messages are sequences of null-terminated strings forming key-value pairs,
 * terminated by a double-null.
 */
function parsePerforceMessage(data: Uint8Array): Record<string, string> {
  const result: Record<string, string> = {};
  const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
  const parts = text.split('\0').filter((p) => p.length > 0);

  for (let i = 0; i + 1 < parts.length; i += 2) {
    result[parts[i]] = parts[i + 1];
  }
  return result;
}

/**
 * Build a Perforce tagged wire protocol message.
 * Each argument is a null-terminated string; the message ends with \0\0.
 */
function buildPerforceMessage(pairs: Record<string, string>): Uint8Array {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(pairs)) {
    parts.push(key, value);
  }
  // Join with null separators and add terminating double-null
  const message = parts.join('\0') + '\0\0';
  return new TextEncoder().encode(message);
}

/**
 * Probe a Perforce server — initiates the protocol handshake to
 * retrieve server version and configuration information.
 *
 * POST /api/perforce/probe
 * Body: { host, port?, timeout? }
 */
export async function handlePerforceProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as PerforceProbeRequest;
    const {
      host,
      port = 1666,
      timeout = 10000,
    } = body;

    const validationError = validatePerforceInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`);

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const tcpLatency = Date.now() - startTime;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Perforce client initiates with a "protocol" function call.
      // This negotiates supported features and requests server info.
      const probeMsg = buildPerforceMessage({
        func: 'protocol',
        xfiles: '3',
        server: '2',
        api: '99999',  // high version to get all info
        enableStreams: '',
        enableGraph: '',
        expandAndmaps: '',
      });
      await writer.write(probeMsg);

      // Read server response
      let serverInfo: Record<string, string> = {};
      let rawResponse = '';
      let isPerforceServer = false;

      try {
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read_timeout')), 5000),
        );

        // Collect all response data
        const chunks: Uint8Array[] = [];
        let totalLen = 0;

        // First chunk
        const { value, done } = await Promise.race([reader.read(), readTimeout]);
        if (!done && value) {
          chunks.push(value);
          totalLen += value.length;

          // Try to read more
          try {
            const shortTimeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('done')), 500),
            );
            while (true) {
              const { value: next, done: nextDone } = await Promise.race([reader.read(), shortTimeout]);
              if (nextDone || !next) break;
              chunks.push(next);
              totalLen += next.length;
            }
          } catch {
            // Short timeout — we have all available data
          }

          // Combine chunks
          const combined = new Uint8Array(totalLen);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }

          rawResponse = new TextDecoder('utf-8', { fatal: false }).decode(combined);
          serverInfo = parsePerforceMessage(combined);

          // Perforce servers typically respond with 'server2', 'xfiles', or 'security' keys
          isPerforceServer = 'server2' in serverInfo || 'xfiles' in serverInfo ||
            'security' in serverInfo || 'maxcommitsperfile' in serverInfo ||
            rawResponse.includes('Perforce') || rawResponse.includes('p4d');
        }
      } catch {
        // No response data
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          tcpLatency,
          isPerforceServer,
          serverVersion: serverInfo.server2 || serverInfo.server || undefined,
          serverInfo: Object.keys(serverInfo).length > 0 ? serverInfo : undefined,
          note: 'Perforce Helix Core is a proprietary VCS popular in game development. ' +
            'Full client operations require authentication and a licensed p4 client.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Query server info from a Perforce server.
 *
 * POST /api/perforce/info
 * Body: { host, port?, timeout? }
 */
export async function handlePerforceInfo(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as PerforceProbeRequest;
    const {
      host,
      port = 1666,
      timeout = 10000,
    } = body;

    const validationError = validatePerforceInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`);

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const tcpLatency = Date.now() - startTime;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send protocol negotiation first
      const protoMsg = buildPerforceMessage({
        func: 'protocol',
        xfiles: '3',
        server: '2',
        api: '99999',
      });
      await writer.write(protoMsg);

      // Wait briefly for any immediate response
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send the "info" command — requests server information
      // This does not require authentication
      const infoMsg = buildPerforceMessage({
        func: 'user-info',
        tag: '',
      });
      await writer.write(infoMsg);

      // Collect response
      let serverInfo: Record<string, string> = {};
      let isPerforceServer = false;

      try {
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read_timeout')), 5000),
        );

        const chunks: Uint8Array[] = [];
        let totalLen = 0;

        const { value, done } = await Promise.race([reader.read(), readTimeout]);
        if (!done && value) {
          chunks.push(value);
          totalLen += value.length;

          try {
            const shortTimeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('done')), 800),
            );
            while (true) {
              const { value: next, done: nextDone } = await Promise.race([reader.read(), shortTimeout]);
              if (nextDone || !next) break;
              chunks.push(next);
              totalLen += next.length;
            }
          } catch {
            // Done reading
          }

          const combined = new Uint8Array(totalLen);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }

          const rawText = new TextDecoder('utf-8', { fatal: false }).decode(combined);
          serverInfo = parsePerforceMessage(combined);
          isPerforceServer = Object.keys(serverInfo).length > 0 ||
            rawText.includes('Perforce') || rawText.includes('p4d');
        }
      } catch {
        // No response
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          tcpLatency,
          isPerforceServer,
          serverVersion: serverInfo.server2 || serverInfo.server || undefined,
          serverAddress: serverInfo.serverAddress || undefined,
          serverDate: serverInfo.serverDate || undefined,
          serverLicense: serverInfo.serverLicense || undefined,
          serverRoot: serverInfo.serverRoot || undefined,
          caseHandling: serverInfo.caseHandling || undefined,
          rawInfo: Object.keys(serverInfo).length > 0 ? serverInfo : undefined,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
