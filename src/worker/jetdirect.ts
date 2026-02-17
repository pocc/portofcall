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
 * Handle raw print job submission to a JetDirect/AppSocket printer.
 *
 * Sends data directly to port 9100. Accepts plain text, PCL, or PostScript.
 * For plain text, wraps in minimal PCL reset/job boundaries so the printer
 * knows where the job starts and ends.
 */
export async function handleJetDirectPrint(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      data: string;
      format?: 'text' | 'pcl' | 'postscript' | 'raw';
      timeout?: number;
    };

    const { host, port = 9100, data, format = 'text', timeout = 30000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!data) {
      return new Response(JSON.stringify({
        success: false,
        error: 'data is required',
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

    // Build the print payload based on format
    let printPayload: string;
    if (format === 'text') {
      // Wrap plain text in PCL/PJL job boundaries
      // UEL (Universal Exit Language) + PJL header + PCL reset + text + PCL reset + UEL
      printPayload =
        PJL_UEL +
        '@PJL\r\n' +
        '@PJL JOB NAME="portofcall"\r\n' +
        '@PJL ENTER LANGUAGE=PCL\r\n' +
        '\x1BE' +          // PCL printer reset
        data +
        '\x0C' +           // form feed (eject page)
        '\x1BE' +          // PCL printer reset
        PJL_UEL +
        '@PJL EOJ\r\n' +
        PJL_UEL;
    } else if (format === 'pcl') {
      // Wrap raw PCL in PJL job boundaries
      printPayload =
        PJL_UEL +
        '@PJL\r\n' +
        '@PJL JOB NAME="portofcall"\r\n' +
        '@PJL ENTER LANGUAGE=PCL\r\n' +
        data +
        PJL_UEL +
        '@PJL EOJ\r\n' +
        PJL_UEL;
    } else if (format === 'postscript') {
      // Wrap PostScript in PJL job boundaries
      printPayload =
        PJL_UEL +
        '@PJL\r\n' +
        '@PJL JOB NAME="portofcall"\r\n' +
        '@PJL ENTER LANGUAGE=POSTSCRIPT\r\n' +
        data +
        '\r\n' + PJL_UEL +
        '@PJL EOJ\r\n' +
        PJL_UEL;
    } else {
      // raw — send as-is
      printPayload = data;
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

    await writer.write(new TextEncoder().encode(printPayload));

    // Wait briefly for any response (some printers send back status)
    let responseText = '';
    const readTimeout = 2000;
    const readTimeoutPromise = new Promise<{ value: undefined; done: true }>((resolve) => {
      setTimeout(() => resolve({ value: undefined, done: true }), readTimeout);
    });

    try {
      const decoder = new TextDecoder();
      while (true) {
        const result = await Promise.race([reader.read(), readTimeoutPromise]);
        if (result.done || !result.value) break;
        responseText += decoder.decode(result.value, { stream: true });
        if (responseText.length > 4096) break;
      }
    } catch {
      // Read timeout — expected for most printers
    }

    const rtt = Date.now() - startTime;
    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      bytesSent: new TextEncoder().encode(printPayload).length,
      format,
      printerResponse: responseText || undefined,
      message: `Print job sent (${format} format, ${new TextEncoder().encode(data).length} bytes of data)`,
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
