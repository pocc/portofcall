/**
 * Discard Protocol Implementation (RFC 863)
 *
 * The Discard protocol is a network testing protocol that accepts data
 * and immediately discards it without any response.
 *
 * Protocol Flow:
 * 1. Client connects to server port 9
 * 2. Client sends data
 * 3. Server silently discards all data (no response)
 * 4. Connection can be closed by either party
 *
 * Use Cases:
 * - Network connectivity testing
 * - TCP throughput testing (fire-and-forget)
 * - Data sink for debugging
 * - Testing network buffering behavior
 * - Educational protocol demonstration
 *
 * Security Warning:
 * - No authentication or encryption
 * - Can be used for connection exhaustion attacks
 * - Most modern systems have Discard disabled
 * - Educational use only
 */

import { connect } from 'cloudflare:sockets';

interface DiscardRequest {
  host: string;
  port?: number;
  data: string;
  timeout?: number;
}

interface DiscardResponse {
  success: boolean;
  bytesSent?: number;
  duration?: number;
  throughput?: string;
  error?: string;
}

/**
 * Calculate throughput from bytes and duration
 */
function calculateThroughput(bytes: number, durationMs: number): string {
  const bps = (bytes * 8) / (durationMs / 1000);

  if (bps < 1024) {
    return `${bps.toFixed(2)} bps`;
  } else if (bps < 1024 * 1024) {
    return `${(bps / 1024).toFixed(2)} Kbps`;
  } else {
    return `${(bps / (1024 * 1024)).toFixed(2)} Mbps`;
  }
}

/**
 * Send data to Discard server
 * Server will accept and discard data without responding
 */
export async function handleDiscardSend(request: Request): Promise<Response> {
  try {
    const body = await request.json() as DiscardRequest;
    const { host, port = 9, data, timeout = 10000 } = body;

    // Validation
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

    if (!data || data.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Data is required (cannot be empty)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Enforce safety limit - max 1MB of data
    if (data.length > 1048576) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Data exceeds maximum size (1MB)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();

    // Connect to Discard server
    const socket = connect(`${host}:${port}`);

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      // Wait for connection with timeout
      await Promise.race([
        socket.opened,
        timeoutPromise,
      ]);

      // Send data to server
      const writer = socket.writable.getWriter();
      const encoder = new TextEncoder();
      const dataBytes = encoder.encode(data);

      await writer.write(dataBytes);
      await writer.close();

      const duration = Date.now() - startTime;
      const throughput = calculateThroughput(dataBytes.length, duration);

      // Close socket
      socket.close();

      const result: DiscardResponse = {
        success: true,
        bytesSent: dataBytes.length,
        duration,
        throughput,
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      // Connection or write error
      socket.close();
      throw error;
    }

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
