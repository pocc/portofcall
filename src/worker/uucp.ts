/**
 * UUCP Protocol Implementation (Port 540/TCP)
 *
 * Unix-to-Unix Copy — a historical store-and-forward network protocol
 * used before widespread internet adoption to transfer files and email
 * between systems via serial lines or dial-up modems.
 *
 * Protocol Flow (traditional UUCP / Taylor UUCP):
 * 1. Client connects to uucpd on port 540
 * 2. Client sends wakeup sequence: \r\0
 * 3. Server responds with its system name: Shere\0 or Shere-{hostname}\0
 * 4. Client identifies itself: S{client-name}\0
 * 5. Server accepts or rejects: ROK\0 or RLOGIN\0 or RLOCKED\0
 * 6. If accepted: protocol negotiation follows (P{protocols}\0)
 *
 * Default Port: 540/TCP
 *
 * Security: NONE — transmits in plaintext. Completely replaced by SSH/SFTP.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface UUCPProbeRequest {
  host: string;
  port?: number;
  systemName?: string;
  timeout?: number;
}

function validateUUCPInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) return 'Host is required';
  if (!/^[a-zA-Z0-9._-]+$/.test(host)) return 'Host contains invalid characters';
  if (port < 1 || port > 65535) return 'Port must be between 1 and 65535';
  return null;
}

/**
 * Probe a UUCP daemon — connects, sends the wakeup sequence,
 * reads the server greeting, and attempts the initial handshake.
 *
 * POST /api/uucp/probe
 * Body: { host, port?, systemName?, timeout? }
 */
export async function handleUUCPProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as UUCPProbeRequest;
    const {
      host,
      port = 540,
      systemName = 'probe',
      timeout = 10000,
    } = body;

    const validationError = validateUUCPInput(host, port);
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

      // Send traditional UUCP wakeup sequence: \r\0
      await writer.write(new Uint8Array([0x0D, 0x00]));

      let serverGreeting = '';
      let serverSystem = '';
      let isUUCPServer = false;
      let handshakeResult = '';

      // Read server greeting (up to 3 seconds)
      try {
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read_timeout')), 3000),
        );
        const { value, done } = await Promise.race([reader.read(), readTimeout]);

        if (!done && value && value.length > 0) {
          const raw = new TextDecoder('utf-8', { fatal: false }).decode(value);
          // Strip null bytes for display
          serverGreeting = raw.replace(/\0/g, '\x00').replace(/[^\x20-\x7E\x00]/g, '?');

          // Traditional UUCP server greeting starts with 'S' (for "System name")
          // e.g. "Shere\0" or "Shere-hostname\0"
          if (raw.startsWith('S')) {
            isUUCPServer = true;
            const nullIdx = raw.indexOf('\0');
            const nameField = nullIdx > 0 ? raw.slice(1, nullIdx) : raw.slice(1);
            // Strip "here" or "here-" prefix
            serverSystem = nameField.replace(/^here-?/, '') || nameField;

            // Respond with our system name: S<name>\0
            const clientName = systemName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'probe';
            await writer.write(new TextEncoder().encode(`S${clientName}\0`));

            // Read accept/reject response
            try {
              const ackTimeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('ack_timeout')), 2000),
              );
              const { value: ackVal, done: ackDone } = await Promise.race([reader.read(), ackTimeout]);
              if (!ackDone && ackVal) {
                const ack = new TextDecoder('utf-8', { fatal: false }).decode(ackVal);
                handshakeResult = ack.replace(/\0/g, ' ').trim();
              }
            } catch {
              // No ack within timeout
            }
          }
        }
      } catch {
        // No data from server or read timed out
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
          isUUCPServer,
          serverSystem: serverSystem || undefined,
          serverGreeting: serverGreeting || undefined,
          handshakeResult: handshakeResult || undefined,
          note: 'UUCP (Unix-to-Unix Copy) is a historical file transfer protocol from the pre-internet era (1970s–1990s).',
          security: 'NONE — UUCP transmits in plaintext with trust-based authentication. Use SFTP or SCP instead.',
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
