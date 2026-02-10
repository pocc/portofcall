/**
 * VNC (RFB) Protocol Implementation
 *
 * Implements connectivity testing for VNC servers using the
 * Remote Framebuffer (RFB) Protocol (RFC 6143).
 *
 * Protocol Flow:
 * 1. Server sends protocol version string: "RFB 003.008\n" (12 bytes)
 * 2. Client sends matching version string: "RFB 003.008\n"
 * 3. Server sends security types (count + type list)
 * 4. We report version and available security types
 *
 * Security Types:
 *   0 = Invalid (connection failed)
 *   1 = None (no authentication)
 *   2 = VNC Authentication (DES challenge-response)
 *   5-16 = RealVNC extensions
 *   18 = TLS
 *   19 = VeNCrypt
 *   30-35 = Apple Remote Desktop
 *
 * Use Cases:
 * - VNC server connectivity testing
 * - RFB protocol version detection
 * - Security type enumeration
 * - Remote desktop server discovery
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Human-readable names for VNC security types
 */
function getSecurityTypeName(type: number): string {
  const names: Record<number, string> = {
    0: 'Invalid',
    1: 'None',
    2: 'VNC Authentication',
    5: 'RA2',
    6: 'RA2ne',
    16: 'Tight',
    17: 'Ultra',
    18: 'TLS',
    19: 'VeNCrypt',
    20: 'GTK-VNC SASL',
    21: 'MD5 hash',
    22: 'Colin Dean xvp',
    30: 'Apple Remote Desktop (ARD30)',
    35: 'Apple Remote Desktop (ARD35)',
  };
  return names[type] || `Unknown(${type})`;
}

/**
 * Read exactly `length` bytes from a reader, accumulating chunks
 */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  length: number,
): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let offset = 0;

  while (offset < length) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed while reading');

    const toCopy = Math.min(length - offset, value.length);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
  }

  return buffer;
}

/**
 * Handle VNC connection test
 * Performs RFB version exchange and security type discovery
 */
export async function handleVNCConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 5900, timeout = 10000 } = body;

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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: Read server's RFB version string (12 bytes: "RFB XXX.YYY\n")
        const serverVersionBytes = await readExact(reader, 12);
        const serverVersionStr = new TextDecoder().decode(serverVersionBytes).trim();

        // Validate it looks like an RFB version string
        if (!serverVersionStr.startsWith('RFB ')) {
          throw new Error(`Not a VNC server: received "${serverVersionStr}"`);
        }

        // Parse version numbers
        const versionMatch = serverVersionStr.match(/RFB (\d{3})\.(\d{3})/);
        if (!versionMatch) {
          throw new Error(`Invalid RFB version format: "${serverVersionStr}"`);
        }

        const serverMajor = parseInt(versionMatch[1], 10);
        const serverMinor = parseInt(versionMatch[2], 10);

        // Step 2: Send our version string (we support up to 3.8)
        const clientMajor = Math.min(serverMajor, 3);
        const clientMinor = serverMajor >= 3 ? Math.min(serverMinor, 8) : serverMinor;
        const clientVersion = `RFB ${String(clientMajor).padStart(3, '0')}.${String(clientMinor).padStart(3, '0')}\n`;
        await writer.write(new TextEncoder().encode(clientVersion));

        // Step 3: Read security types
        let securityTypes: number[] = [];
        let securityError = '';

        if (serverMajor >= 3 && serverMinor >= 7) {
          // RFB 3.7+: server sends count(1 byte) + type list
          const countBytes = await readExact(reader, 1);
          const count = countBytes[0];

          if (count === 0) {
            // Server is refusing connection - read error message
            const reasonLenBytes = await readExact(reader, 4);
            const reasonLen = new DataView(reasonLenBytes.buffer).getUint32(0, false);
            const reasonBytes = await readExact(reader, Math.min(reasonLen, 256));
            securityError = new TextDecoder().decode(reasonBytes);
          } else {
            const typesBytes = await readExact(reader, count);
            securityTypes = Array.from(typesBytes);
          }
        } else {
          // RFB 3.3: server sends a single uint32 security type
          const typeBytes = await readExact(reader, 4);
          const type = new DataView(typeBytes.buffer).getUint32(0, false);
          if (type === 0) {
            // Connection failed - read error message
            const reasonLenBytes = await readExact(reader, 4);
            const reasonLen = new DataView(reasonLenBytes.buffer).getUint32(0, false);
            const reasonBytes = await readExact(reader, Math.min(reasonLen, 256));
            securityError = new TextDecoder().decode(reasonBytes);
          } else {
            securityTypes = [type];
          }
        }

        const rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const authRequired = !securityTypes.includes(1); // Type 1 = None

        return {
          success: true,
          host,
          port,
          connectTime,
          rtt,
          serverVersion: serverVersionStr,
          serverMajor,
          serverMinor,
          negotiatedVersion: clientVersion.trim(),
          securityTypes: securityTypes.map(t => ({
            id: t,
            name: getSecurityTypeName(t),
          })),
          authRequired,
          securityError: securityError || undefined,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([connectionPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
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
