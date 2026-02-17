/**
 * SAP MaxDB Database Protocol Implementation
 *
 * MaxDB (formerly SAP DB) is a relational database management system from SAP.
 * It uses a proprietary binary protocol for client-server communication.
 *
 * Port: 7200 (legacy/X Server), 7210 (modern sql6)
 * Protocol: NI (Network Interface) or NISSL (NI over SSL)
 *
 * Protocol Flow:
 * 1. Client connects to Global Listener (typically port 7200 or 7210)
 * 2. Listener responds with database X Server port number
 * 3. Client connects to X Server port
 * 4. X Server connects client to database instance
 * 5. Client sends authentication and SQL commands
 *
 * Use Cases:
 * - SAP database connectivity testing
 * - MaxDB health checking
 * - Database version detection
 * - Connection availability monitoring
 *
 * References:
 * - https://maxdb.sap.com/doc/7_8/44/bf820566fa5e91e10000000a422035/content.htm
 * - https://maxdb.sap.com/doc/7_8/44/d7c3e72e6338d3e10000000a1553f7/content.htm
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface MaxDBRequest {
  host: string;
  port?: number;
  database?: string;
  timeout?: number;
}

interface MaxDBResponse {
  success: boolean;
  error?: string;
  latencyMs?: number;
  serverInfo?: {
    responded: boolean;
    dataReceived: boolean;
    byteCount?: number;
    hexDump?: string;
    isMaxDB?: boolean;
  };
}

/**
 * Handle MaxDB connection test
 * Attempts to connect to MaxDB X Server and read initial response
 */
export async function handleMaxDBConnect(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await request.json() as MaxDBRequest;
    const { host, port = 7200, database = 'MAXDB', timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
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

    // Connect to MaxDB X Server
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);

    // MaxDB connection protocol:
    // 1. Send a connection request packet
    // 2. Read server response

    // Build a basic MaxDB connect packet (simplified)
    // MaxDB uses a binary protocol with packet headers
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Send a minimal connect request
      // MaxDB packets typically start with a header containing packet length
      // This is a probe - we'll see what the server responds with
      const connectPacket = new Uint8Array([
        0x00, 0x00, 0x00, 0x40, // Packet length (64 bytes)
        0x00, 0x00, 0x00, 0x01, // Packet type (connect)
        0x00, 0x00, 0x00, 0x00, // Sequence number
        ...new TextEncoder().encode(database.padEnd(32, '\0').substring(0, 32)), // Database name
        ...new Array(20).fill(0), // Padding
      ]);

      await writer.write(connectPacket);
      writer.releaseLock();

      // Try to read response (with timeout)
      const decoder = new TextDecoder();
      let responseData = new Uint8Array();
      let bytesRead = 0;
      const maxBytes = 4096;

      const readStart = Date.now();
      while (bytesRead < maxBytes && (Date.now() - readStart) < 5000) {
        const readPromise = reader.read();
        const readTimeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Read timeout')), 2000);
        });

        try {
          const { value, done } = await Promise.race([readPromise, readTimeout]) as ReadableStreamReadResult<Uint8Array>;
          if (done) break;
          if (value) {
            // Append to response data
            const combined = new Uint8Array(responseData.length + value.length);
            combined.set(responseData);
            combined.set(value, responseData.length);
            responseData = combined;
            bytesRead += value.length;

            // If we got some data, that's good enough
            if (bytesRead > 0) break;
          }
        } catch (readError) {
          // Read timeout - that's okay, we might have gotten some data
          break;
        }
      }

      reader.releaseLock();
      socket.close();

      const latencyMs = Date.now() - start;

      // Analyze the response
      const hexDump = Array.from(responseData.slice(0, 64))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');

      // Check if response looks like MaxDB
      const isMaxDB = responseData.length > 4 && (
        // MaxDB responses typically have structured binary headers
        responseData[0] === 0x00 ||
        // Or may contain ASCII "MAXDB" or "SAPDB" markers
        decoder.decode(responseData).includes('MAXDB') ||
        decoder.decode(responseData).includes('SAPDB') ||
        decoder.decode(responseData).includes('SAP')
      );

      const result: MaxDBResponse = {
        success: bytesRead > 0,
        latencyMs,
        serverInfo: {
          responded: bytesRead > 0,
          dataReceived: bytesRead > 0,
          byteCount: bytesRead,
          hexDump: hexDump || undefined,
          isMaxDB: isMaxDB || undefined,
        },
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      reader.releaseLock();
      writer.releaseLock();
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
      latencyMs: Date.now() - start,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
