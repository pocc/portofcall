/**
 * Apache Ignite Thin Client Protocol Support for Cloudflare Workers
 *
 * Apache Ignite is a distributed in-memory computing platform for
 * caching, computing, SQL, and streaming workloads. The thin client
 * protocol provides lightweight binary access over TCP.
 *
 * Thin Client Handshake (Port 10800):
 *   Client -> Server:
 *     [length: 4 bytes LE][version_major: 2 LE][version_minor: 2 LE]
 *     [version_patch: 2 LE][client_code: 1 byte (2 = thin client)]
 *     Optional: [features_count: N][feature_flags...]
 *
 *   Server -> Client (success):
 *     [length: 4 bytes LE][success: 1 byte (1)]
 *     [node_id: 16 bytes UUID][features...]
 *
 *   Server -> Client (failure):
 *     [length: 4 bytes LE][success: 1 byte (0)]
 *     [server_major: 2 LE][server_minor: 2 LE][server_patch: 2 LE]
 *     [error_msg_length: 4 LE][error_msg: UTF-8]
 *
 * Request/Response Format:
 *   Request:  [length: 4 LE][op_code: 2 LE][request_id: 8 LE][data...]
 *   Response: [length: 4 LE][request_id: 8 LE][status: 4 LE][data...]
 *
 * Operation Codes:
 *   1    = OP_CACHE_GET
 *   1000 = OP_GET_BINARY_TYPE_NAME
 *   1    = OP_CACHE_GET
 *   ...many more
 *
 * Default port: 10800 (TCP)
 *
 * Use Cases:
 *   - Ignite cluster health checking
 *   - Version detection and feature negotiation
 *   - Cache topology discovery
 *   - Node UUID identification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Thin client code
const CLIENT_CODE_THIN = 2;

/**
 * Build a thin client handshake packet
 * Protocol version 1.7.0 is widely supported
 */
function buildHandshake(versionMajor: number, versionMinor: number, versionPatch: number): Uint8Array {
  // Payload: major(2) + minor(2) + patch(2) + client_code(1) = 7 bytes
  const payloadLength = 7;
  const packet = new Uint8Array(4 + payloadLength);
  const view = new DataView(packet.buffer);

  view.setInt32(0, payloadLength, true); // length (LE)
  view.setInt16(4, versionMajor, true);  // version major
  view.setInt16(6, versionMinor, true);  // version minor
  view.setInt16(8, versionPatch, true);  // version patch
  packet[10] = CLIENT_CODE_THIN;          // client code

  return packet;
}

/**
 * Read a complete response from the Ignite server
 */
async function readResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number,
): Promise<Uint8Array> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeout)
  );

  const readPromise = (async () => {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    // Read at least 4 bytes for length
    while (totalBytes < 4) {
      const { value, done } = await reader.read();
      if (done || !value) throw new Error('Connection closed before response');
      chunks.push(value);
      totalBytes += value.length;
    }

    // Combine to read length
    const headerBuf = new Uint8Array(totalBytes);
    let off = 0;
    for (const chunk of chunks) {
      headerBuf.set(chunk, off);
      off += chunk.length;
    }

    const view = new DataView(headerBuf.buffer, headerBuf.byteOffset);
    const payloadLength = view.getInt32(0, true); // LE

    if (payloadLength < 0 || payloadLength > 65536) {
      throw new Error(`Invalid payload length: ${payloadLength}`);
    }

    // Read remaining payload bytes
    const totalNeeded = 4 + payloadLength;
    while (totalBytes < totalNeeded) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      totalBytes += value.length;
    }

    // Combine all
    const fullBuf = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      fullBuf.set(chunk, offset);
      offset += chunk.length;
    }

    return fullBuf;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Parse UUID bytes (16 bytes) into string form
 */
function parseUUID(data: Uint8Array, offset: number): string {
  const hex = (i: number) => data[offset + i].toString(16).padStart(2, '0');

  // Ignite UUIDs are stored in a specific byte order
  return `${hex(3)}${hex(2)}${hex(1)}${hex(0)}-${hex(5)}${hex(4)}-${hex(7)}${hex(6)}-${hex(8)}${hex(9)}-${hex(10)}${hex(11)}${hex(12)}${hex(13)}${hex(14)}${hex(15)}`;
}

/**
 * Handle Ignite connection test
 * Performs the thin client handshake and reports server info
 */
export async function handleIgniteConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 10800, timeout = 10000 } = body;

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send handshake (protocol version 1.7.0)
        const handshake = buildHandshake(1, 7, 0);
        await writer.write(handshake);

        // Read response
        const response = await readResponse(reader, 5000);

        if (response.length < 5) {
          throw new Error('Response too short');
        }

        const view = new DataView(response.buffer, response.byteOffset);
        const payloadLength = view.getInt32(0, true);
        const success = response[4];

        const result: Record<string, unknown> = {
          success: true,
          host,
          port,
          rtt: Date.now() - startTime,
        };

        if (success === 1) {
          // Successful handshake
          result.handshake = 'accepted';
          result.requestedVersion = '1.7.0';

          // Node UUID (16 bytes starting at offset 5)
          if (response.length >= 21) {
            result.nodeId = parseUUID(response, 5);
          }

          // Check for additional feature flags
          if (payloadLength > 17) {
            result.featuresPresent = true;
            result.payloadSize = payloadLength;
          }
        } else {
          // Failed handshake - server returns its supported version
          result.handshake = 'rejected';

          if (response.length >= 11) {
            const serverMajor = view.getInt16(5, true);
            const serverMinor = view.getInt16(7, true);
            const serverPatch = view.getInt16(9, true);
            result.serverVersion = `${serverMajor}.${serverMinor}.${serverPatch}`;

            // Error message
            if (response.length >= 15) {
              const errorMsgLen = view.getInt32(11, true);
              if (errorMsgLen > 0 && response.length >= 15 + errorMsgLen) {
                result.errorMessage = new TextDecoder().decode(
                  response.slice(15, 15 + errorMsgLen)
                );
              }
            }
          }
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return result;
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
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
 * Handle Ignite version probe
 * Tests multiple protocol versions to find what the server supports
 */
export async function handleIgniteProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port || 10800;
    const timeout = body.timeout || 10000;

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

    // Probe versions from newest to oldest
    const versionsToProbe = [
      { major: 1, minor: 7, patch: 0 },
      { major: 1, minor: 6, patch: 0 },
      { major: 1, minor: 4, patch: 0 },
      { major: 1, minor: 1, patch: 0 },
      { major: 1, minor: 0, patch: 0 },
    ];

    const results: Array<{
      version: string;
      accepted: boolean;
      nodeId?: string;
      serverVersion?: string;
      error?: string;
    }> = [];

    for (const ver of versionsToProbe) {
      try {
        const socket = connect(`${host}:${port}`);
        await socket.opened;

        const reader = socket.readable.getReader();
        const writer = socket.writable.getWriter();

        try {
          const handshake = buildHandshake(ver.major, ver.minor, ver.patch);
          await writer.write(handshake);

          const probeTimeout = Math.min(3000, timeout);
          const response = await readResponse(reader, probeTimeout);

          if (response.length >= 5) {
            const view = new DataView(response.buffer, response.byteOffset);
            const success = response[4];

            if (success === 1) {
              const entry: typeof results[0] = {
                version: `${ver.major}.${ver.minor}.${ver.patch}`,
                accepted: true,
              };
              if (response.length >= 21) {
                entry.nodeId = parseUUID(response, 5);
              }
              results.push(entry);
            } else {
              const entry: typeof results[0] = {
                version: `${ver.major}.${ver.minor}.${ver.patch}`,
                accepted: false,
              };
              if (response.length >= 11) {
                const sMajor = view.getInt16(5, true);
                const sMinor = view.getInt16(7, true);
                const sPatch = view.getInt16(9, true);
                entry.serverVersion = `${sMajor}.${sMinor}.${sPatch}`;
              }
              results.push(entry);
            }
          }

          writer.releaseLock();
          reader.releaseLock();
          await socket.close();
        } catch (err) {
          writer.releaseLock();
          reader.releaseLock();
          await socket.close();

          results.push({
            version: `${ver.major}.${ver.minor}.${ver.patch}`,
            accepted: false,
            error: err instanceof Error ? err.message : 'Probe failed',
          });
        }
      } catch {
        results.push({
          version: `${ver.major}.${ver.minor}.${ver.patch}`,
          accepted: false,
          error: 'Connection failed',
        });
      }
    }

    const rtt = Date.now() - startTime;
    const accepted = results.filter(r => r.accepted);

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      acceptedVersions: accepted.length,
      totalProbed: results.length,
      highestAccepted: accepted.length > 0 ? accepted[0].version : null,
      nodeId: accepted.length > 0 ? accepted[0].nodeId : undefined,
      versions: results,
    }), {
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
