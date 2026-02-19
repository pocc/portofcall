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

    // Validate timeout bounds
    if (timeout < 1000 || timeout > 300000) {
      return new Response(
        JSON.stringify({ success: false, error: 'Timeout must be between 1000 and 300000 ms' }),
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

    let timeoutHandle: number | undefined;
    const socket = connect(`${host}:${port}`);

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          socket.close();
          reject(new Error('Connection timeout'));
        }, timeout) as unknown as number;
      });

      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const tcpLatency = Date.now() - startTime;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Send traditional UUCP wakeup sequence: \r\0
        await writer.write(new Uint8Array([0x0D, 0x00]));

        let serverGreeting = '';
        let serverSystem = '';
        let isUUCPServer = false;
        let handshakeResult = '';

        // Read server greeting (up to 3 seconds)
        try {
          let readTimeoutHandle: number | undefined;
          const readTimeout = new Promise<never>((_, reject) => {
            readTimeoutHandle = setTimeout(() => reject(new Error('read_timeout')), 3000) as unknown as number;
          });
          const { value, done } = await Promise.race([reader.read(), readTimeout]);
          clearTimeout(readTimeoutHandle);

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
              // UUCP system names: alphanumeric and hyphen only (not underscore)
              const clientName = systemName.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 32) || 'probe';
              await writer.write(new TextEncoder().encode(`S${clientName}\0`));

              // Read accept/reject response
              try {
                let ackTimeoutHandle: number | undefined;
                const ackTimeout = new Promise<never>((_, reject) => {
                  ackTimeoutHandle = setTimeout(() => reject(new Error('ack_timeout')), 2000) as unknown as number;
                });
                const { value: ackVal, done: ackDone } = await Promise.race([reader.read(), ackTimeout]);
                clearTimeout(ackTimeoutHandle);
                if (!ackDone && ackVal) {
                  const ack = new TextDecoder('utf-8', { fatal: false }).decode(ackVal);
                  handshakeResult = ack.replace(/\0/g, ' ').trim();
                }
              } catch (ackErr) {
                // No ack within timeout
                if (ackErr instanceof Error && ackErr.message !== 'ack_timeout') {
                  throw ackErr;
                }
              }
            }
          }
        } catch (readErr) {
          // No data from server or read timed out
          if (readErr instanceof Error && readErr.message !== 'read_timeout') {
            throw readErr;
          }
        }

        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
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
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        throw error;
      }
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      socket.close();
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
 * Perform UUCP handshake detection over TCP (port 540).
 * Detects raw UUCP (DLE+S markers) vs login-gated service.
 * Request body: { host, port=540, timeout=10000 }
 */
export async function handleUUCPHandshake(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = 540, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, banner: '', loginRequired: false, latencyMs: 0, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate port range
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, banner: '', loginRequired: false, latencyMs: 0, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate timeout bounds
    if (timeout < 1000 || timeout > 300000) {
      return new Response(JSON.stringify({ success: false, banner: '', loginRequired: false, latencyMs: 0, error: 'Timeout must be between 1000 and 300000 ms' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, banner: '', loginRequired: false, latencyMs: 0, error: getCloudflareErrorMessage(host, cfCheck.ip) }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    let timeoutHandle: number | undefined;
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        socket.close();
        reject(new Error('Connection timeout'));
      }, timeout) as unknown as number;
    });

    const work = (async () => {
      const start = Date.now();
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        // Send UUCP wakeup
        await writer.write(new Uint8Array([0x0d, 0x00]));

        // Read initial banner (3s)
        let readTimeoutHandle: number | undefined;
        const readTimeout = new Promise<{ value: undefined; done: true }>(r => {
          readTimeoutHandle = setTimeout(() => r({ value: undefined, done: true }), 3000) as unknown as number;
        });
        const { value, done } = await Promise.race([reader.read(), readTimeout]);
        clearTimeout(readTimeoutHandle);

        const latencyMs = Date.now() - start;
        const rawBytes = (!done && value) ? value : new Uint8Array(0);
        const rawText = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes);
        const displayBanner = rawText.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, c => `<0x${c.charCodeAt(0).toString(16).padStart(2,'0')}>`);

        let remoteSite: string | undefined;
        let loginRequired = false;
        let protocolVersion: string | undefined;
        let exchangeResult: string | undefined;

        // Check if response starts with DLE+S (0x10 0x53) for UUCP 'g' protocol
        if (rawBytes.length >= 2 && rawBytes[0] === 0x10 && rawBytes[1] === 0x53) {
          // Raw UUCP DLE+S here-is message (g protocol)
          const nullIdx = rawText.indexOf('\0');
          const field = nullIdx > 1 ? rawText.slice(2, nullIdx) : rawText.slice(2);
          remoteSite = field.replace(/^here-?/, '') || field;
          protocolVersion = 'UUCP-g';

          // Send DLE + Sprobe\0 response for g protocol
          const response = new Uint8Array([0x10]);
          await writer.write(response);
          await writer.write(new TextEncoder().encode('Sprobe\0'));

          let ackTimeoutHandle: number | undefined;
          const ackTimeout = new Promise<{ value: undefined; done: true }>(r => {
            ackTimeoutHandle = setTimeout(() => r({ value: undefined, done: true }), 2000) as unknown as number;
          });
          const ack = await Promise.race([reader.read(), ackTimeout]);
          clearTimeout(ackTimeoutHandle);

          if (!ack.done && ack.value?.length) {
            exchangeResult = new TextDecoder('utf-8', { fatal: false }).decode(ack.value).replace(/\0/g, ' ').trim();
          }
        } else if (/login:/i.test(displayBanner) || /password:/i.test(displayBanner)) {
          // Login prompt detected (run regex on displayBanner, not rawText with potential binary)
          loginRequired = true;
          await writer.write(new TextEncoder().encode('uucp\n'));

          let respTimeoutHandle: number | undefined;
          const respTimeout = new Promise<{ value: undefined; done: true }>(r => {
            respTimeoutHandle = setTimeout(() => r({ value: undefined, done: true }), 2000) as unknown as number;
          });
          const resp = await Promise.race([reader.read(), respTimeout]);
          clearTimeout(respTimeoutHandle);

          if (!resp.done && resp.value?.length) {
            exchangeResult = new TextDecoder('utf-8', { fatal: false }).decode(resp.value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
          }
        }

        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();

        return {
          success: true,
          banner: (exchangeResult ? `${displayBanner} → ${exchangeResult}` : displayBanner) || '(no banner)',
          loginRequired, latencyMs,
          ...(remoteSite ? { remoteSite } : {}),
          ...(protocolVersion ? { protocolVersion } : {}),
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    try {
      const result = await Promise.race([work, timeoutPromise]);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, banner: '', loginRequired: false, latencyMs: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
