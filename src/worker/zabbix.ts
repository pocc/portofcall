/**
 * Zabbix Protocol Implementation
 *
 * Zabbix uses a simple binary protocol over TCP for communication between
 * server, proxy, and agent components.
 *
 * Protocol Format (Zabbix Header Protocol):
 *   Bytes 0-3:  "ZBXD" (magic header)
 *   Byte 4:     Protocol flags (0x01 = standard, 0x03 = compressed)
 *   Bytes 5-12: Data length (8 bytes, little-endian uint64)
 *   Bytes 13+:  Data payload (JSON string)
 *
 * Port Assignments:
 *   10050 - Zabbix Agent (passive checks; agent listens)
 *   10051 - Zabbix Server/Proxy (active checks; server listens)
 *
 * This implementation connects to a Zabbix server/proxy on port 10051
 * and probes it for active check configuration, or connects to an agent
 * on port 10050 and queries for supported items.
 *
 * Use Cases:
 * - Verify Zabbix server/proxy reachability
 * - Test agent connectivity and item availability
 * - Network monitoring infrastructure validation
 */

import { connect } from 'cloudflare:sockets';

// Zabbix header magic bytes
const ZBXD_HEADER = new Uint8Array([0x5A, 0x42, 0x58, 0x44]); // "ZBXD"
const ZBXD_FLAGS_STANDARD = 0x01;

interface ZabbixConnectRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface ZabbixAgentRequest {
  host: string;
  port?: number;
  key: string;
  timeout?: number;
}

interface ZabbixConnectResponse {
  success: boolean;
  host?: string;
  port?: number;
  version?: string;
  response?: string;
  data?: string;
  rtt?: number;
  error?: string;
}

interface ZabbixAgentResponse {
  success: boolean;
  host?: string;
  port?: number;
  key?: string;
  value?: string;
  rtt?: number;
  error?: string;
}

/**
 * Encode a JSON payload into Zabbix protocol format
 */
function encodeZabbixMessage(data: string): Uint8Array {
  const dataBytes = new TextEncoder().encode(data);
  const dataLength = dataBytes.length;

  // Header: "ZBXD" (4) + flags (1) + data length (8) + data
  const message = new Uint8Array(4 + 1 + 8 + dataLength);

  // Magic header "ZBXD"
  message.set(ZBXD_HEADER, 0);

  // Protocol flags (standard = 0x01)
  message[4] = ZBXD_FLAGS_STANDARD;

  // Data length as 8-byte little-endian
  const view = new DataView(message.buffer);
  // Use two 32-bit writes for the 64-bit length (JS doesn't have native u64)
  view.setUint32(5, dataLength, true);  // low 32 bits
  view.setUint32(9, 0, true);           // high 32 bits (always 0 for our payloads)

  // Data payload
  message.set(dataBytes, 13);

  return message;
}

/**
 * Decode a Zabbix protocol response
 */
function decodeZabbixMessage(data: Uint8Array): { valid: boolean; payload: string; dataLength: number } {
  if (data.length < 13) {
    return { valid: false, payload: '', dataLength: 0 };
  }

  // Check magic header "ZBXD"
  if (data[0] !== 0x5A || data[1] !== 0x42 || data[2] !== 0x58 || data[3] !== 0x44) {
    // Not a ZBXD header — might be a plain text response (older agents)
    return {
      valid: true,
      payload: new TextDecoder().decode(data),
      dataLength: data.length,
    };
  }

  // Read data length (little-endian 64-bit, but we only use low 32 bits)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const dataLength = view.getUint32(5, true);

  // Extract payload
  const payloadBytes = data.slice(13, 13 + dataLength);
  const payload = new TextDecoder().decode(payloadBytes);

  return { valid: true, payload, dataLength };
}

/**
 * Read complete response from socket with accumulation
 */
async function readZabbixResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxBytes = 65536; // 64KB safety limit

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Read timeout')), timeout);
  });

  try {
    while (totalBytes < maxBytes) {
      const { value, done } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (done) break;

      if (value) {
        chunks.push(value);
        totalBytes += value.length;

        // If we have the header, check if we've received enough data
        if (totalBytes >= 13) {
          const combined = combineChunks(chunks, totalBytes);
          if (combined[0] === 0x5A && combined[1] === 0x42 &&
              combined[2] === 0x58 && combined[3] === 0x44) {
            const view = new DataView(combined.buffer, combined.byteOffset, combined.byteLength);
            const expectedLength = view.getUint32(5, true) + 13;
            if (totalBytes >= expectedLength) break;
          } else {
            // Plain text response — read one chunk and return
            break;
          }
        }
      }
    }
  } catch (error) {
    if (chunks.length === 0) throw error;
    // Return what we have
  }

  return combineChunks(chunks, totalBytes);
}

function combineChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

/**
 * Probe a Zabbix server/proxy for active check configuration
 *
 * Sends an "active checks" request which asks the server what items
 * should be actively monitored for a given hostname.
 */
export async function handleZabbixConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as ZabbixConnectRequest;
    const { host, port = 10051, timeout = 10000 } = body;

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

    const startTime = Date.now();

    // Connect to Zabbix server
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send an "active checks" request
      // This is the standard request an agent makes to the server
      const requestPayload = JSON.stringify({
        request: 'active checks',
        host: 'portofcall-probe',
      });

      const message = encodeZabbixMessage(requestPayload);
      await writer.write(message);

      // Read response
      const responseData = await readZabbixResponse(reader, timeout);
      const rtt = Date.now() - startTime;

      // Decode response
      const decoded = decodeZabbixMessage(responseData);

      // Clean up
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Try to parse the JSON response
      let parsedResponse: Record<string, unknown> = {};
      let responseStr = decoded.payload;
      try {
        parsedResponse = JSON.parse(decoded.payload);
        responseStr = JSON.stringify(parsedResponse, null, 2);
      } catch {
        // Response isn't JSON — use raw string
      }

      const result: ZabbixConnectResponse = {
        success: true,
        host,
        port,
        response: (parsedResponse.response as string) || 'connected',
        data: responseStr,
        rtt,
      };

      // Try to detect version from response info
      if (parsedResponse.info) {
        result.version = String(parsedResponse.info);
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
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

/**
 * Query a Zabbix Agent for a specific item value
 *
 * Connects to a Zabbix agent (port 10050) and requests the value
 * of a specific monitoring item key.
 */
export async function handleZabbixAgent(request: Request): Promise<Response> {
  try {
    const body = await request.json() as ZabbixAgentRequest;
    const { host, port = 10050, key, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!key) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Item key is required',
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

    // Validate key format — prevent injection
    if (key.length > 255 || /[\x00-\x1f]/.test(key)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid item key format',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();

    // Connect to Zabbix agent
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send the item key as a Zabbix protocol message
      // Agents expect the raw key in ZBXD format
      const message = encodeZabbixMessage(key);
      await writer.write(message);

      // Read response
      const responseData = await readZabbixResponse(reader, timeout);
      const rtt = Date.now() - startTime;

      // Decode response
      const decoded = decodeZabbixMessage(responseData);

      // Clean up
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const result: ZabbixAgentResponse = {
        success: true,
        host,
        port,
        key,
        value: decoded.payload,
        rtt,
      };

      // Check for agent error responses
      if (decoded.payload.startsWith('ZBX_NOTSUPPORTED')) {
        result.value = decoded.payload;
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
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
