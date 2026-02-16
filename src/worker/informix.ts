/**
 * Informix Protocol Implementation
 *
 * IBM Informix Dynamic Server (IDS) is a relational database management system
 * developed by Informix Corporation (now part of IBM). It's known for its
 * performance, scalability, and support for complex data types.
 *
 * Protocol Overview:
 * - Port: 1526 (sqlexec), 9088, 9090 (configurable)
 * - Transport: TCP
 * - Format: Binary protocol with network abstraction layer
 * - Products: IDS (Informix Dynamic Server), SE (Standard Engine)
 *
 * Protocol Structure:
 * - Message-based binary protocol
 * - Connection handshake with version negotiation
 * - Server info exchange
 * - Authentication (username/password or trusted)
 *
 * Connection Flow:
 * 1. Client → Server: Connection request with client info
 * 2. Server → Client: Server info (version, capabilities)
 * 3. Client → Server: Authentication credentials
 * 4. Server → Client: Authentication result
 * 5. Query/response cycle begins
 *
 * Server Info Packet:
 * - Server version string
 * - Protocol version
 * - Server capabilities
 * - Character set
 * - Environment variables
 *
 * Common Ports:
 * - 1526: sqlexec service (default)
 * - 9088: onsoctcp service
 * - 9090: alternative service
 *
 * Use Cases:
 * - Enterprise Informix database detection
 * - Database server inventory
 * - Legacy system analysis
 * - Banking/financial system mapping
 * - Retail/ERP infrastructure
 *
 * Modern Usage:
 * - Still used in enterprise environments
 * - Banking and financial systems
 * - Retail point-of-sale systems
 * - Legacy application support
 * - Embedded database systems
 *
 * Reference:
 * - IBM Informix documentation
 * - Informix Client SDK
 */

import { connect } from 'cloudflare:sockets';

interface InformixRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface InformixResponse {
  success: boolean;
  host: string;
  port: number;
  serverInfo?: string;
  version?: string;
  isInformix?: boolean;
  dataLength?: number;
  rtt?: number;
  error?: string;
}

/**
 * Build simple Informix connection request
 * This is a minimal handshake for detection purposes
 */
function buildInformixConnect(): Buffer {
  // Informix connection packet (simplified)
  // Real Informix protocol is more complex with:
  // - Client version
  // - Username
  // - Database name
  // - Application name
  // - Environment variables

  // Simplified connection message
  const message = Buffer.allocUnsafe(64);
  message.fill(0);

  // Magic bytes / header (simplified)
  // Real Informix has specific protocol identifiers
  message.write('sqlexec', 0, 'ascii'); // Service name
  message.write('probe', 8, 'ascii'); // Client name

  return message;
}

/**
 * Parse Informix server response
 */
function parseInformixResponse(data: Buffer): {
  hasResponse: boolean;
  isInformix: boolean;
  serverInfo?: string;
} {
  const result: {
    hasResponse: boolean;
    isInformix: boolean;
    serverInfo?: string;
  } = {
    hasResponse: data.length > 0,
    isInformix: false,
  };

  if (data.length === 0) {
    return result;
  }

  // Check for Informix-specific patterns
  const dataStr = data.toString('utf8', 0, Math.min(256, data.length));

  // Informix servers often respond with version info
  if (dataStr.includes('Informix') ||
      dataStr.includes('IDS') ||
      dataStr.includes('sqlexec') ||
      dataStr.includes('onsoc')) {
    result.isInformix = true;
    result.serverInfo = dataStr;
  }

  // Binary protocol patterns (check for non-text data)
  // Informix uses binary protocol with specific markers
  if (data.length >= 4 && !result.isInformix) {
    // Check for binary protocol patterns
    const firstBytes = data.subarray(0, 4);
    const hasNullBytes = firstBytes.includes(0);
    const hasBinaryPattern = data.length >= 8 &&
      data.readUInt32BE(0) > 0 &&
      data.readUInt32BE(0) < 65536;

    if (hasNullBytes && hasBinaryPattern) {
      result.isInformix = true;
      result.serverInfo = 'Informix binary protocol detected';
    }
  }

  return result;
}

/**
 * Probe Informix server by attempting connection.
 * Detects IBM Informix Dynamic Server.
 */
export async function handleInformixProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as InformixRequest;
    const { host, port = 1526, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies InformixResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Port must be between 1 and 65535',
      } satisfies InformixResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Send Informix connection request
      const connectRequest = buildInformixConnect();

      const writer = socket.writable.getWriter();
      await writer.write(connectRequest);
      writer.releaseLock();

      // Read server response
      const reader = socket.readable.getReader();

      const { value, done } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (done || !value) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response from Informix server',
        } satisfies InformixResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parseInformixResponse(Buffer.from(value));

      if (!parsed.hasResponse) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid Informix response',
        } satisfies InformixResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      if (parsed.isInformix) {
        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          isInformix: true,
          serverInfo: parsed.serverInfo,
          dataLength: value.length,
          rtt,
        } satisfies InformixResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          isInformix: false,
          error: 'Server does not appear to be Informix',
          dataLength: value.length,
          rtt,
        } satisfies InformixResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: 1526,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies InformixResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Get Informix server version information.
 * Same as probe but with focus on version extraction.
 */
export async function handleInformixVersion(request: Request): Promise<Response> {
  // Reuse probe logic
  return handleInformixProbe(request);
}
