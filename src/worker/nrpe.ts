/**
 * NRPE (Nagios Remote Plugin Executor) Protocol Implementation
 *
 * NRPE allows Nagios to execute monitoring plugins on remote Linux/Unix hosts.
 * It uses a fixed-size binary packet format over TCP port 5666.
 *
 * Packet Structure (1036 bytes total):
 * - Bytes 0-1:    Protocol version (int16, network byte order) — 2 or 3
 * - Bytes 2-3:    Packet type (int16) — 1=query, 2=response
 * - Bytes 4-7:    CRC32 checksum (uint32)
 * - Bytes 8-9:    Result code (int16) — 0=OK, 1=WARNING, 2=CRITICAL, 3=UNKNOWN
 * - Bytes 10-1033: Buffer (1024 bytes, null-terminated command or output)
 * - Bytes 1034-1035: Padding (2 bytes)
 *
 * Protocol Flow:
 * 1. Client connects to NRPE daemon on port 5666
 * 2. Client sends a query packet with the check command in the buffer
 * 3. Server executes the command and returns a response packet
 * 4. Connection closes
 *
 * Common check commands:
 * - _NRPE_CHECK: Returns NRPE version (built-in, always available)
 * - check_disk: Disk usage monitoring
 * - check_load: System load check
 * - check_users: Logged-in user count
 *
 * Use Cases:
 * - Test NRPE daemon connectivity
 * - Retrieve NRPE version via _NRPE_CHECK
 * - Execute allowed monitoring commands
 * - Complement to Zabbix monitoring
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// NRPE protocol constants
const NRPE_PACKET_VERSION_2 = 2;
const NRPE_PACKET_VERSION_3 = 3;
const QUERY_PACKET = 1;
const RESPONSE_PACKET = 2;
const NRPE_BUFFER_LEN = 1024;
const NRPE_V2_PACKET_LEN = 1036; // 2+2+4+2+1024+2

// Result codes
const RESULT_CODES: Record<number, string> = {
  0: 'OK',
  1: 'WARNING',
  2: 'CRITICAL',
  3: 'UNKNOWN',
};

interface NRPEQueryRequest {
  host: string;
  port?: number;
  command?: string;
  version?: number;
  timeout?: number;
}

interface NRPEQueryResponse {
  success: boolean;
  host: string;
  port: number;
  command: string;
  protocolVersion: number;
  resultCode: number;
  resultCodeName: string;
  output: string;
  rtt: number;
  error?: string;
  isCloudflare?: boolean;
}

/**
 * Compute CRC32 checksum (same as used by NRPE)
 */
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;

  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Build an NRPE v2 query packet
 */
function buildNRPEQuery(command: string, version: number = NRPE_PACKET_VERSION_2): Uint8Array {
  const packet = new Uint8Array(NRPE_V2_PACKET_LEN);
  const view = new DataView(packet.buffer);

  // Protocol version (big-endian uint16)
  view.setUint16(0, version);

  // Packet type: query (big-endian uint16)
  view.setUint16(2, QUERY_PACKET);

  // CRC32: set to 0 initially (computed over entire packet with CRC field = 0)
  view.setUint32(4, 0);

  // Result code: 0 for queries (big-endian uint16)
  view.setUint16(8, 0);

  // Buffer: null-terminated command string
  const encoder = new TextEncoder();
  const commandBytes = encoder.encode(command);
  const copyLen = Math.min(commandBytes.length, NRPE_BUFFER_LEN - 1);
  packet.set(commandBytes.subarray(0, copyLen), 10);
  // Remaining buffer bytes are already 0 (null terminated)

  // Padding: 0 (big-endian uint16)
  view.setUint16(1034, 0);

  // Compute CRC32 over the entire packet (with CRC field = 0)
  const checksum = crc32(packet);
  view.setUint32(4, checksum);

  return packet;
}

/**
 * Parse an NRPE response packet
 */
function parseNRPEResponse(data: Uint8Array): {
  version: number;
  packetType: number;
  crc: number;
  resultCode: number;
  output: string;
  valid: boolean;
} {
  if (data.length < NRPE_V2_PACKET_LEN) {
    return {
      version: 0,
      packetType: 0,
      crc: 0,
      resultCode: 3,
      output: `Incomplete response: received ${data.length} bytes, expected ${NRPE_V2_PACKET_LEN}`,
      valid: false,
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const version = view.getUint16(0);
  const packetType = view.getUint16(2);
  const receivedCrc = view.getUint32(4);
  const resultCode = view.getUint16(8);

  // Extract null-terminated string from buffer (UTF-8 decode for proper character handling)
  let endPos = 10;
  while (endPos < 10 + NRPE_BUFFER_LEN && data[endPos] !== 0) {
    endPos++;
  }
  const decoder = new TextDecoder('utf-8');
  const output = decoder.decode(data.subarray(10, endPos));

  // Verify CRC32
  const checkPacket = new Uint8Array(data);
  const checkView = new DataView(checkPacket.buffer, checkPacket.byteOffset, checkPacket.byteLength);
  checkView.setUint32(4, 0); // Zero out CRC field
  const computedCrc = crc32(checkPacket.subarray(0, NRPE_V2_PACKET_LEN));

  const valid = packetType === RESPONSE_PACKET && receivedCrc === computedCrc;

  return { version, packetType, crc: receivedCrc, resultCode, output, valid };
}

/**
 * Handle NRPE query — send a check command and receive the result.
 * Default command is _NRPE_CHECK which returns the NRPE version.
 */
export async function handleNRPEQuery(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as NRPEQueryRequest;
    const {
      host,
      port = 5666,
      command = '_NRPE_CHECK',
      version = NRPE_PACKET_VERSION_2,
      timeout = 10000,
    } = body;

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

    if (version !== NRPE_PACKET_VERSION_2 && version !== NRPE_PACKET_VERSION_3) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Protocol version must be 2 or 3',
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

    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout) as unknown as number;
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Build and send NRPE query
        const queryPacket = buildNRPEQuery(command, version);
        await writer.write(queryPacket);

        // Read response (fixed 1036 bytes)
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        while (totalBytes < NRPE_V2_PACKET_LEN) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);

          if (done || !value) break;

          chunks.push(value);
          totalBytes += value.length;
        }

        const rtt = Date.now() - startTime;

        // Combine chunks
        const responseData = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          responseData.set(chunk, offset);
          offset += chunk.length;
        }

        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

      if (totalBytes === 0) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          command,
          error: 'No response received — NRPE daemon may require TLS (check_nrpe -n for non-TLS)',
          rtt,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

        const parsed = parseNRPEResponse(responseData);

        // Validate response version matches request
        if (parsed.version !== version) {
          return new Response(JSON.stringify({
            success: false,
            host,
            port,
            command,
            error: `Protocol version mismatch: sent v${version}, received v${parsed.version}`,
            rtt,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const result: NRPEQueryResponse = {
          success: true,
          host,
          port,
          command,
          protocolVersion: parsed.version,
          resultCode: parsed.resultCode,
          resultCodeName: RESULT_CODES[parsed.resultCode] || `UNKNOWN(${parsed.resultCode})`,
          output: parsed.output,
          rtt,
        };

        if (!parsed.valid) {
          result.error = 'Response CRC32 mismatch or unexpected packet type — response may be corrupted';
        }

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } finally {
        // Ensure locks are released even on error
        try {
          writer.releaseLock();
        } catch { /* ignored */ }
        try {
          reader.releaseLock();
        } catch { /* ignored */ }
      }
    } catch (error) {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      socket.close();
      throw error;
    } finally {
      socket.close();
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
 * Handle NRPE query over TLS — same as handleNRPEQuery but uses secureTransport: 'on'.
 *
 * Most production NRPE deployments require SSL/TLS (the default). Use this handler
 * when the NRPE daemon is configured with ssl=yes (the upstream default).
 */
export async function handleNRPETLS(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as NRPEQueryRequest;
    const {
      host,
      port = 5666,
      command = '_NRPE_CHECK',
      version = NRPE_PACKET_VERSION_2,
      timeout = 10000,
    } = body;

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

    if (version !== NRPE_PACKET_VERSION_2 && version !== NRPE_PACKET_VERSION_3) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Protocol version must be 2 or 3',
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

    // Use secureTransport: 'on' for TLS — the key difference from handleNRPEQuery
    const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });

    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout) as unknown as number;
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Build and send NRPE query packet (same format as plain-text)
        const queryPacket = buildNRPEQuery(command, version);
        await writer.write(queryPacket);

        // Read response (fixed 1036 bytes)
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        while (totalBytes < NRPE_V2_PACKET_LEN) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);

          if (done || !value) break;

          chunks.push(value);
          totalBytes += value.length;
        }

        const rtt = Date.now() - startTime;

        // Combine chunks
        const responseData = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          responseData.set(chunk, offset);
          offset += chunk.length;
        }

        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

      if (totalBytes === 0) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          command,
          tls: true,
          error: 'No response received from NRPE daemon over TLS',
          rtt,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

        const parsed = parseNRPEResponse(responseData);

        // Validate response version matches request
        if (parsed.version !== version) {
          return new Response(JSON.stringify({
            success: false,
            host,
            port,
            command,
            tls: true,
            error: `Protocol version mismatch: sent v${version}, received v${parsed.version}`,
            rtt,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const result: NRPEQueryResponse & { tls: boolean } = {
          success: true,
          tls: true,
          host,
          port,
          command,
          protocolVersion: parsed.version,
          resultCode: parsed.resultCode,
          resultCodeName: RESULT_CODES[parsed.resultCode] || `UNKNOWN(${parsed.resultCode})`,
          output: parsed.output,
          rtt,
        };

        if (!parsed.valid) {
          result.error = 'Response CRC32 mismatch or unexpected packet type — response may be corrupted';
        }

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } finally {
        // Ensure locks are released even on error
        try {
          writer.releaseLock();
        } catch { /* ignored */ }
        try {
          reader.releaseLock();
        } catch { /* ignored */ }
      }
    } catch (error) {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      socket.close();
      throw error;
    } finally {
      socket.close();
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
 * Handle NRPE version check — convenience endpoint for _NRPE_CHECK command.
 */
export async function handleNRPEVersion(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = 5666, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
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

    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout) as unknown as number;
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Send _NRPE_CHECK query (v2)
        const queryPacket = buildNRPEQuery('_NRPE_CHECK', NRPE_PACKET_VERSION_2);
        await writer.write(queryPacket);

        // Read response
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        while (totalBytes < NRPE_V2_PACKET_LEN) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);

          if (done || !value) break;

          chunks.push(value);
          totalBytes += value.length;
        }

        const rtt = Date.now() - startTime;

        const responseData = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          responseData.set(chunk, offset);
          offset += chunk.length;
        }

        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

      if (totalBytes === 0) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response — NRPE daemon may require TLS',
          rtt,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

        const parsed = parseNRPEResponse(responseData);

        // Extract version from output (format: "NRPE v4.1.0" or "NRPE v3.2.1")
        const versionMatch = parsed.output.match(/NRPE\s+v?([\d.]+)/i);

        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          nrpeVersion: versionMatch ? versionMatch[1] : null,
          output: parsed.output,
          protocolVersion: parsed.version,
          resultCode: parsed.resultCode,
          resultCodeName: RESULT_CODES[parsed.resultCode] || 'UNKNOWN',
          valid: parsed.valid,
          rtt,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } finally {
        // Ensure locks are released even on error
        try {
          writer.releaseLock();
        } catch { /* ignored */ }
        try {
          reader.releaseLock();
        } catch { /* ignored */ }
      }
    } catch (error) {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      socket.close();
      throw error;
    } finally {
      socket.close();
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
