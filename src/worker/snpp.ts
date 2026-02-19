/**
 * SNPP Protocol Implementation (RFC 1861)
 *
 * Simple Network Paging Protocol is a text-based TCP protocol for sending
 * pages (messages) to pagers/beepers. It uses a command-response model
 * with numeric status codes similar to SMTP and FTP.
 *
 * Protocol Flow:
 * 1. Client connects to SNPP server port 444
 * 2. Server sends a greeting (220 banner)
 * 3. Client sends commands:
 *    - PAGE <pager_id>    → Set the pager ID to receive the message
 *    - MESS <message>     → Set the message content
 *    - SEND               → Transmit the page
 *    - RESE               → Reset/cancel current page
 *    - QUIT               → Disconnect
 *    - HELP               → Request command help
 * 4. Server responds with numeric codes:
 *    - 220 = Service ready
 *    - 250 = Success
 *    - 421 = Service not available
 *    - 550 = Error
 *
 * SNPP Levels:
 * - Level 1: Basic paging (PAGE, MESS, SEND, QUIT, RESE, HELP)
 * - Level 2: Adds LOGIn, LEVEl, COVErage, HOLDuntil, CALLerid
 * - Level 3: Adds 2WAY, MCREsponse, MSTA
 *
 * Use Cases:
 * - Hospital/medical alert systems
 * - Emergency notification
 * - Industrial monitoring alerts
 * - Legacy paging infrastructure
 */

import { connect } from 'cloudflare:sockets';

interface SNPPProbeRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface SNPPProbeResponse {
  success: boolean;
  host: string;
  port: number;
  banner?: string;
  serverInfo?: string;
  rtt?: number;
  error?: string;
}

interface SNPPPageRequest {
  host: string;
  port?: number;
  pagerId: string;
  message: string;
  timeout?: number;
}

interface SNPPPageResponse {
  success: boolean;
  host: string;
  port: number;
  pagerId: string;
  pageResponse?: string;
  sendResponse?: string;
  transcript: string[];
  rtt?: number;
  error?: string;
}

/**
 * Read a complete response line from the SNPP server.
 * SNPP uses \r\n line termination like SMTP.
 */
async function readLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Read timeout')), timeoutMs);
  });

  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);

      if (done) {
        if (buffer.length > 0) return buffer.trim();
        throw new Error('Connection closed by server');
      }

      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lineEnd = buffer.indexOf('\r\n');
        if (lineEnd !== -1) {
          return buffer.substring(0, lineEnd);
        }
        // Also accept just \n
        const nlEnd = buffer.indexOf('\n');
        if (nlEnd !== -1) {
          return buffer.substring(0, nlEnd);
        }
      }
    }
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Send a command to the SNPP server.
 */
async function sendCommand(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  command: string,
): Promise<void> {
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(command + '\r\n'));
}

/**
 * Probe an SNPP server - connect and read the banner.
 */
export async function handleSNPPProbe(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as SNPPProbeRequest;
    const { host, port = 444, timeout = 10000 } = body;

    if (!host) {
      return new Response(
        JSON.stringify({
          success: false,
          host: '',
          port,
          error: 'Host is required',
        } satisfies SNPPProbeResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          error: 'Port must be between 1 and 65535',
        } satisfies SNPPProbeResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (timeout < 1 || timeout > 300000) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          error: 'Timeout must be between 1 and 300000ms',
        } satisfies SNPPProbeResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read the server banner (expect 220)
        const banner = await readLine(reader, timeout);

        // Send QUIT to be polite
        await sendCommand(writer, 'QUIT');

        // Try to read QUIT response
        let serverInfo = banner;
        try {
          const quitResp = await readLine(reader, 3000);
          if (quitResp) {
            serverInfo = `${banner} | QUIT: ${quitResp}`;
          }
        } catch {
          // Server may close immediately
        }

        const rtt = Date.now() - start;

        const is220 = banner.startsWith('220');

        return new Response(
          JSON.stringify({
            success: is220,
            host,
            port,
            banner,
            serverInfo,
            rtt,
            error: is220 ? undefined : `Unexpected response: ${banner}`,
          } satisfies SNPPProbeResponse),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      } finally {
        try {
          writer.releaseLock();
        } catch {
          // Already released
        }
        try {
          reader.releaseLock();
        } catch {
          // Already released
        }
      }
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      try {
        socket.close();
      } catch {
        // Already closed
      }
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        host: '',
        port: 444,
        error: error instanceof Error ? error.message : 'Unknown error',
      } satisfies SNPPProbeResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Send a page via SNPP.
 * Executes: PAGE <id> → MESS <message> → SEND → QUIT
 */
export async function handleSNPPPage(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as SNPPPageRequest;
    const { host, port = 444, pagerId, message, timeout = 15000 } = body;

    if (!host) {
      return new Response(
        JSON.stringify({
          success: false,
          host: '',
          port,
          pagerId: '',
          transcript: [],
          error: 'Host is required',
        } satisfies SNPPPageResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!pagerId) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          pagerId: '',
          transcript: [],
          error: 'Pager ID is required',
        } satisfies SNPPPageResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!message) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          pagerId,
          transcript: [],
          error: 'Message is required',
        } satisfies SNPPPageResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          pagerId,
          transcript: [],
          error: 'Port must be between 1 and 65535',
        } satisfies SNPPPageResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (timeout < 1 || timeout > 300000) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          pagerId,
          transcript: [],
          error: 'Timeout must be between 1 and 300000ms',
        } satisfies SNPPPageResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Validate pager ID - prevent command injection
    if (/[\r\n]/.test(pagerId)) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          pagerId,
          transcript: [],
          error: 'Pager ID cannot contain CR or LF characters',
        } satisfies SNPPPageResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Validate message - prevent command injection
    if (/[\r\n]/.test(message)) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          pagerId,
          transcript: [],
          error: 'Message cannot contain CR or LF characters',
        } satisfies SNPPPageResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // SNPP message length limit (typical is 240-256 chars)
    if (message.length > 256) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          pagerId,
          transcript: [],
          error: 'Message exceeds 256 character limit',
        } satisfies SNPPPageResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);
    const transcript: string[] = [];

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read banner
        const banner = await readLine(reader, timeout);
        transcript.push(`S: ${banner}`);

        if (!banner.startsWith('220')) {
          return new Response(
            JSON.stringify({
              success: false,
              host,
              port,
              pagerId,
              transcript,
              error: `Server not ready: ${banner}`,
            } satisfies SNPPPageResponse),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        // Send PAGE command
        transcript.push(`C: PAGE ${pagerId}`);
        await sendCommand(writer, `PAGE ${pagerId}`);
        const pageResponse = await readLine(reader, timeout);
        transcript.push(`S: ${pageResponse}`);

        if (!pageResponse.startsWith('250')) {
          // Try to QUIT gracefully
          try {
            await sendCommand(writer, 'QUIT');
          } catch {
            // Best effort
          }
          return new Response(
            JSON.stringify({
              success: false,
              host,
              port,
              pagerId,
              pageResponse,
              transcript,
              error: `PAGE command failed: ${pageResponse}`,
            } satisfies SNPPPageResponse),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        // Send MESS command
        transcript.push(`C: MESS ${message}`);
        await sendCommand(writer, `MESS ${message}`);
        const messResponse = await readLine(reader, timeout);
        transcript.push(`S: ${messResponse}`);

        if (!messResponse.startsWith('250')) {
          try {
            await sendCommand(writer, 'QUIT');
          } catch {
            // Best effort
          }
          return new Response(
            JSON.stringify({
              success: false,
              host,
              port,
              pagerId,
              pageResponse,
              transcript,
              error: `MESS command failed: ${messResponse}`,
            } satisfies SNPPPageResponse),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        // Send SEND command
        transcript.push(`C: SEND`);
        await sendCommand(writer, 'SEND');
        const sendResponse = await readLine(reader, timeout);
        transcript.push(`S: ${sendResponse}`);

        // Send QUIT
        transcript.push(`C: QUIT`);
        try {
          await sendCommand(writer, 'QUIT');
        } catch {
          // Best effort
        }
        try {
          const quitResp = await readLine(reader, 3000);
          transcript.push(`S: ${quitResp}`);
        } catch {
          // Server may close connection
        }

        const rtt = Date.now() - start;

        const success = sendResponse.startsWith('250') || sendResponse.startsWith('860');

        return new Response(
          JSON.stringify({
            success,
            host,
            port,
            pagerId,
            pageResponse,
            sendResponse,
            transcript,
            rtt,
            error: success ? undefined : `SEND failed: ${sendResponse}`,
          } satisfies SNPPPageResponse),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      } finally {
        try {
          writer.releaseLock();
        } catch {
          // Already released
        }
        try {
          reader.releaseLock();
        } catch {
          // Already released
        }
      }
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      try {
        socket.close();
      } catch {
        // Already closed
      }
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        host: '',
        port: 444,
        pagerId: '',
        transcript: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      } satisfies SNPPPageResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
