/**
 * HP JetDirect / Raw Printing Protocol Implementation
 *
 * Implements connectivity testing for network printers via the JetDirect
 * protocol (port 9100). Also supports PJL (Printer Job Language) queries
 * to retrieve printer model, status, and configuration.
 *
 * Protocol:
 * - Connect to port 9100 (raw TCP)
 * - Send PJL commands for status queries
 * - Some printers respond with model/status info
 * - Close connection
 *
 * PJL Commands:
 * - @PJL INFO ID\r\n       - Printer model identification
 * - @PJL INFO STATUS\r\n   - Current printer status
 * - @PJL INFO CONFIG\r\n   - Printer configuration
 *
 * Use Cases:
 * - Network printer discovery
 * - Printer status checking
 * - Model/firmware identification
 * - Port 9100 connectivity testing
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// PJL Universal Exit Language command
const PJL_UEL = '\x1B%-12345X';

/**
 * Handle JetDirect connection test with optional PJL status query
 */
export async function handleJetDirectConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 9100, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if the target is behind Cloudflare
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
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Send PJL info queries
    // UEL + PJL commands to query printer info
    const pjlQuery = PJL_UEL +
      '@PJL\r\n' +
      '@PJL INFO ID\r\n' +
      '@PJL INFO STATUS\r\n' +
      PJL_UEL;

    await writer.write(new TextEncoder().encode(pjlQuery));

    // Try to read any response (some printers respond, some don't)
    let responseText = '';
    const readTimeout = Math.min(timeout, 3000);

    const readTimeoutPromise = new Promise<{ value: undefined; done: true }>((resolve) => {
      setTimeout(() => resolve({ value: undefined, done: true }), readTimeout);
    });

    try {
      const decoder = new TextDecoder();
      let totalBytes = 0;
      const maxSize = 16 * 1024;

      while (totalBytes < maxSize) {
        const result = await Promise.race([reader.read(), readTimeoutPromise]);
        if (result.done || !result.value) break;
        totalBytes += result.value.length;
        responseText += decoder.decode(result.value, { stream: true });
      }
    } catch {
      // Read timeout or connection closed - expected for many printers
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    // Parse PJL response
    const pjlInfo = parsePJLResponse(responseText);

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      portOpen: true,
      pjlSupported: responseText.length > 0,
      rawResponse: responseText.substring(0, 2000) || undefined,
      printerInfo: {
        model: pjlInfo.id || undefined,
        status: pjlInfo.status || undefined,
        statusCode: pjlInfo.statusCode || undefined,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Parse PJL INFO responses
 */
function parsePJLResponse(text: string): {
  id?: string;
  status?: string;
  statusCode?: string;
} {
  const result: { id?: string; status?: string; statusCode?: string } = {};

  if (!text) return result;

  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Parse @PJL INFO ID response
    if (line.startsWith('@PJL INFO ID')) {
      // Next line usually contains the printer model in quotes
      if (i + 1 < lines.length) {
        const idLine = lines[i + 1].trim();
        result.id = idLine.replace(/^"/, '').replace(/"$/, '');
      }
    }

    // Parse @PJL INFO STATUS response
    if (line.startsWith('@PJL INFO STATUS')) {
      // Following lines contain CODE=xxxxx and DISPLAY="message"
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const statusLine = lines[j].trim();
        if (statusLine.startsWith('CODE=')) {
          result.statusCode = statusLine.replace('CODE=', '');
        }
        if (statusLine.startsWith('DISPLAY=')) {
          result.status = statusLine.replace('DISPLAY=', '').replace(/^"/, '').replace(/"$/, '');
        }
      }
    }
  }

  return result;
}
